import { DIM_ALPHA } from './constants';
import { getPixiApp } from './pixiStage';
import { getCaptureGeneration } from '../../../core/pixiCapture';
import type { TileNode } from './types';

// ── Per-frame alpha guards (PIXI ticker) ────────────────────────────────────
// The game toggles `visible` on Tile containers when the player walks; on the
// false→true transition PIXI may render with stale worldAlpha because dirty
// flags were cleared while invisible. Guards are keyed on the TILE node, but
// the dim lives on its content children (setTileDim), so the force-dirty
// toggles the children's alphas.

export const guardedNodes = new Set<any>();
const lastKnownVisible = new WeakMap<any, boolean>();
export const guardTickerRef: { cleanup: (() => void) | null } = { cleanup: null };
let tickerGeneration = -1;

function guardTick(): void {
  for (const node of guardedNodes) {
    const currentlyVisible = node.visible !== false;
    const wasVisible = lastKnownVisible.get(node);
    if (wasVisible === false && currentlyVisible) {
      // false → true transition: PIXI cleared dirty flags while invisible.
      // The dim lives on the content children — force their setters to re-mark.
      const children = node.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (!child) continue;
          child.alpha = 1;
          child.alpha = DIM_ALPHA;
        }
      }
    }
    lastKnownVisible.set(node, currentlyVisible);
  }
}

/** Start (or re-attach after an app rebuild) the guard on the PIXI ticker. */
export function startGuardTicker(): void {
  const gen = getCaptureGeneration();
  if (guardTickerRef.cleanup && tickerGeneration === gen) return;
  guardTickerRef.cleanup?.(); // app replaced: the old closure points at a dead ticker
  const app = getPixiApp();
  if (!app?.ticker) return;
  app.ticker.add(guardTick);
  tickerGeneration = gen;
  guardTickerRef.cleanup = () => {
    try { app.ticker.remove(guardTick); } catch { /* dead app */ }
    guardTickerRef.cleanup = null;
  };
}

export function stopGuardTicker(): void {
  if (guardTickerRef.cleanup) {
    guardTickerRef.cleanup();
  }
}

export function installVisibleGuard(node: any): void {
  if (guardedNodes.has(node)) return;
  guardedNodes.add(node);
  startGuardTicker();
}

export function removeVisibleGuard(node: any): void {
  guardedNodes.delete(node);
  if (guardedNodes.size === 0) stopGuardTicker();
}

export function removeAllVisibleGuards(): void {
  guardedNodes.clear();
  stopGuardTicker();
}

/**
 * Drop guards whose Tile left the live tile set (destroyed on garden change)
 * or was destroyed in place. Runs once per apply pass with the cache that
 * pass just rebuilt — O(guards), bounded by the dimmed-tile count.
 */
export function pruneStaleGuards(liveTiles: readonly TileNode[]): void {
  if (guardedNodes.size === 0) return;
  const live = new Set<unknown>();
  for (const t of liveTiles) live.add(t.node);
  for (const node of guardedNodes) {
    if (!live.has(node) || node.destroyed === true) guardedNodes.delete(node);
  }
  if (guardedNodes.size === 0) stopGuardTicker();
}
