import { shareGlobal } from '../../../core/pageContext';
import { DIM_ALPHA } from './constants';
import { guardedNodes, guardTickerRef, startGuardTicker, stopGuardTicker } from './alphaGuard';
import { getPixiApp, buildTileNodeCache } from './pixiStage';
import { applyFilters } from './controller';
import { isNodeAttached } from './diagnostics';

/**
 * Node-identity & property monitor — determines exactly what the game changes
 * on tile PIXI nodes when the player walks.
 *
 * IMPORTANT: Disables the rAF alpha guard during monitoring so we see what the
 * game actually does, unmasked.  Re-enables the guard on stop.
 *
 * Call QPM_GARDEN_NODES() in the console with filters active, then walk around.
 * Runs per-frame via rAF — catches single-frame changes.
 * Returns a stop function (also exposed as QPM_GARDEN_NODES_STOP).
 */
export function watchNodeIdentity(): () => void {
  const app = getPixiApp();
  if (!app?.stage) {
    console.warn('[QPM-NODES] No PIXI app/stage');
    return () => {};
  }

  // ── Pause the ticker guard so it doesn't mask changes ──
  const hadGuardTicker = guardTickerRef.cleanup !== null;
  stopGuardTicker();
  console.log('[QPM-NODES] Ticker alpha guard PAUSED for clean observation');

  let stampCounter = 0;
  const STAMP_KEY = '__qpmNodeId';

  interface NodeSnapshot {
    stamp: number;
    node: any;
    alpha: number;
    visible: boolean;
    renderable: boolean;
    parentRef: any;
    worldAlpha: number;
    childCount: number;
    childLabel: string;
    childAlpha: number;
    childVisible: boolean;
  }

  const knownNodes = new Map<string, NodeSnapshot>();
  const eventLog: Array<Record<string, unknown>> = [];
  let frameCount = 0;
  let monitorRafId: number | null = null;
  let stopped = false;

  function snap(node: any, stamp: number): NodeSnapshot {
    const child = node.children?.[0];
    return {
      stamp,
      node,
      alpha: node.alpha ?? 1,
      visible: node.visible ?? true,
      renderable: node.renderable ?? true,
      parentRef: node.parent ?? null,
      worldAlpha: node.worldAlpha ?? node.groupAlpha ?? -1,
      childCount: node.children?.length ?? 0,
      childLabel: child?.label ?? 'none',
      childAlpha: child?.alpha ?? 1,
      childVisible: child?.visible ?? true,
    };
  }

  function stampAll(): void {
    const tiles = buildTileNodeCache(app.stage);
    knownNodes.clear();
    for (const { node, x, y } of tiles) {
      const key = `${x},${y}`;
      const stamp = stampCounter++;
      node[STAMP_KEY] = stamp;
      knownNodes.set(key, snap(node, stamp));
    }
  }

  function logEvent(event: string, key: string, data: Record<string, unknown>): void {
    if (eventLog.length < 100) {
      eventLog.push({ frame: frameCount, event, tile: key, ...data });
    }
    // Also log live for immediate feedback
    console.warn(`[QPM-NODES] ${event} @ frame ${frameCount}: tile ${key}`, data);
  }

  function checkFrame(): void {
    if (stopped) return;
    frameCount++;
    const tiles = buildTileNodeCache(app.stage);

    for (const { node, x, y } of tiles) {
      const key = `${x},${y}`;
      const prev = knownNodes.get(key);

      if (!prev) {
        const stamp = stampCounter++;
        node[STAMP_KEY] = stamp;
        knownNodes.set(key, snap(node, stamp));
        continue;
      }

      // ── Node identity check ──
      if (node !== prev.node || node[STAMP_KEY] !== prev.stamp) {
        logEvent('NODE_REPLACED', key, {
          oldAlpha: prev.alpha,
          newAlpha: node.alpha,
          oldVisible: prev.visible,
          newVisible: node.visible,
          oldChildLabel: prev.childLabel,
          newChildLabel: node.children?.[0]?.label ?? 'none',
          oldAttached: isNodeAttached(prev.node, app.stage),
        });
        const stamp = stampCounter++;
        node[STAMP_KEY] = stamp;
        knownNodes.set(key, snap(node, stamp));
        continue;
      }

      // ── Same node — check every property ──
      const cur = snap(node, prev.stamp);

      // Alpha on tile container
      if (Math.abs(cur.alpha - prev.alpha) > 0.001) {
        logEvent('TILE_ALPHA', key, {
          from: prev.alpha.toFixed(3),
          to: cur.alpha.toFixed(3),
        });
      }

      // Visible on tile container
      if (cur.visible !== prev.visible) {
        logEvent('TILE_VISIBLE', key, {
          from: prev.visible,
          to: cur.visible,
        });
      }

      // Renderable on tile container
      if (cur.renderable !== prev.renderable) {
        logEvent('TILE_RENDERABLE', key, {
          from: prev.renderable,
          to: cur.renderable,
        });
      }

      // Parent changed (reparented)
      if (cur.parentRef !== prev.parentRef) {
        logEvent('TILE_REPARENTED', key, {
          oldParentLabel: prev.parentRef?.label ?? 'null',
          newParentLabel: cur.parentRef?.label ?? 'null',
        });
      }

      // World alpha (computed for rendering)
      if (Math.abs(cur.worldAlpha - prev.worldAlpha) > 0.001 && prev.worldAlpha >= 0) {
        logEvent('WORLD_ALPHA', key, {
          from: prev.worldAlpha.toFixed(3),
          to: cur.worldAlpha.toFixed(3),
        });
      }

      // Child alpha
      if (Math.abs(cur.childAlpha - prev.childAlpha) > 0.001) {
        logEvent('CHILD_ALPHA', key, {
          childLabel: cur.childLabel,
          from: prev.childAlpha.toFixed(3),
          to: cur.childAlpha.toFixed(3),
        });
      }

      // Child visible
      if (cur.childVisible !== prev.childVisible) {
        logEvent('CHILD_VISIBLE', key, {
          childLabel: cur.childLabel,
          from: prev.childVisible,
          to: cur.childVisible,
        });
      }

      // Child count changed (children added/removed)
      if (cur.childCount !== prev.childCount) {
        logEvent('CHILD_COUNT', key, {
          from: prev.childCount,
          to: cur.childCount,
        });
      }

      // First child changed entirely
      if (cur.childLabel !== prev.childLabel) {
        logEvent('CHILD_SWAPPED', key, {
          from: prev.childLabel,
          to: cur.childLabel,
        });
      }

      knownNodes.set(key, cur);
    }

    monitorRafId = requestAnimationFrame(checkFrame);
  }

  // Dim tiles, then snapshot
  applyFilters();
  stampAll();

  // Start per-frame monitoring
  monitorRafId = requestAnimationFrame(checkFrame);

  const dimmedCount = [...knownNodes.values()].filter(s => Math.abs(s.alpha - DIM_ALPHA) < 0.01).length;
  console.log(`[QPM-NODES] Monitoring ${knownNodes.size} tiles (${dimmedCount} dimmed) — walk around, then call QPM_GARDEN_NODES_STOP()`);

  const stop = () => {
    stopped = true;
    if (monitorRafId !== null) {
      cancelAnimationFrame(monitorRafId);
      monitorRafId = null;
    }
    // Re-enable ticker guard
    if (hadGuardTicker && guardedNodes.size > 0) {
      startGuardTicker();
    }
    console.group(`[QPM-NODES] Results after ${frameCount} frames`);
    const counts: Record<string, number> = {};
    for (const e of eventLog) { counts[e.event as string] = (counts[e.event as string] ?? 0) + 1; }
    console.log('Event counts:', counts);
    if (eventLog.length > 0) {
      console.log('Full event log:');
      console.table(eventLog);
    } else {
      console.log('No property changes detected on any tile node.');
    }
    console.groupEnd();
    return { frameCount, counts, eventLog };
  };

  shareGlobal('QPM_GARDEN_NODES_STOP', stop);
  return stop;
}
