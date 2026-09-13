import { getGardenSnapshot, onGardenSnapshot } from '../bridge';
import { onAnyPixiNodeAdded } from '../../../core/pixiSceneEvents';
import { TILE_LABEL_TEST_RE } from './constants';
import { applyFilters, isFilteringActive } from './controller';
import { getPixiApp, getOrBuildTileNodeCache } from './pixiStage';
import { warnFeature } from './_diagnostics';

// Reactive re-application triggers. Two event sources cover everything the
// old 500 ms poll caught:
//  - onGardenSnapshot: tile data changed (mutation gained, growth, replant).
//  - onAnyPixiNodeAdded under a Tile parent: the game's DEFERRED child-view
//    rebuild (TileObjectContainerView syncChildView) creates the view only
//    when the tile scrolls on-screen — no data event accompanies it.
// Re-apply is debounced; a burst of addChilds costs one full pass (~1.1 ms).

const DEBOUNCE_MS = 100;
let cleanups: Array<() => void> = [];
let debounceTimer: number | null = null;
let warnedNoTileNodes = false;

// Shape self-check: the `Tile (x, y)` label regex is the feature's only node
// identifier — a silent rename in a rebundle would turn filtering into a no-op.
// Warn once per session when the garden has tile data but zero labels match.
function checkSceneShape(): void {
  if (warnedNoTileNodes) return;
  const app = getPixiApp();
  if (!app?.stage) return;
  if (getOrBuildTileNodeCache(app.stage).length > 0) return;
  const snap = getGardenSnapshot();
  const tiles = snap?.tileObjects ? Object.keys(snap.tileObjects).length : 0;
  if (tiles > 0) {
    warnedNoTileNodes = true;
    warnFeature('QPM-FEATURE-004', { what: 'shape:no-tile-nodes', tiles });
  }
}

export function shouldReapplyForAddedNode(child: { parent?: { label?: unknown } | null }): boolean {
  const parentLabel = child?.parent?.label;
  return typeof parentLabel === 'string' && TILE_LABEL_TEST_RE.test(parentLabel);
}

function scheduleApply(): void {
  if (debounceTimer !== null) return;
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    if (isFilteringActive()) {
      applyFilters();
      checkSceneShape();
    }
  }, DEBOUNCE_MS);
}

export function startFilterReapplyTriggers(): void {
  if (cleanups.length > 0) return; // idempotent
  cleanups.push(onGardenSnapshot(() => {
    if (isFilteringActive()) scheduleApply();
  }, false));
  cleanups.push(onAnyPixiNodeAdded((child) => {
    if (!isFilteringActive()) return;
    if (!shouldReapplyForAddedNode(child as { parent?: { label?: unknown } | null })) return;
    scheduleApply();
  }));
}

export function stopFilterReapplyTriggers(): void {
  for (const c of cleanups) {
    try { c(); } catch { /* ignore */ }
  }
  cleanups = [];
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
