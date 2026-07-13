import { DIM_ALPHA } from './constants';
import { getPixiApp } from './pixiStage';

// ── Per-frame alpha guards (PIXI ticker) ────────────────────────────────────
// The game toggles `visible` on Tile containers when the player walks.  When
// visible goes false→true, PIXI may render with stale worldAlpha (1.0) because
// color-update dirty flags are cleared while the node was invisible.
//
// Only the visible false→true transition needs the force-dirty; on all other
// frames the alpha setter is a no-op that still burns dirty-flag churn. Track
// last-known visibility per node and force-dirty only on the transition.

export const guardedNodes = new Set<any>();
const lastKnownVisible = new WeakMap<any, boolean>();
export const guardTickerRef: { cleanup: (() => void) | null } = { cleanup: null };

function guardTick(): void {
  for (const node of guardedNodes) {
    const currentlyVisible = node.visible !== false;
    const wasVisible = lastKnownVisible.get(node);
    if (wasVisible === false && currentlyVisible) {
      // false → true transition: PIXI cleared dirty flags while invisible.
      // Toggle to force the alpha setter's change-detection to re-mark dirty.
      node.alpha = 1;
      node.alpha = DIM_ALPHA;
    }
    lastKnownVisible.set(node, currentlyVisible);
  }
}

/** Start the guard on the PIXI ticker. Called lazily when the first node is guarded. */
export function startGuardTicker(): void {
  if (guardTickerRef.cleanup) return;
  const app = getPixiApp();
  if (!app?.ticker) return;
  app.ticker.add(guardTick);
  guardTickerRef.cleanup = () => {
    app.ticker.remove(guardTick);
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
