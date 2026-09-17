import { getGardenSnapshot, onGardenSnapshot } from '../bridge';
import { onAnyPixiNodeAdded } from '../../../core/pixiSceneEvents';
import { coalesce } from '../../../utils/scheduling/debounce';
import { TILE_LABEL_TEST_RE } from './constants';
import { applyFilters, isFilteringActive } from './controller';
import { tileCache } from './pixiStage';
import { warnFeature } from './_diagnostics';

// Reactive re-application triggers. Two event sources cover everything the
// 2000 ms reconciliation sweep would otherwise catch late:
//  - onGardenSnapshot: tile data changed (mutation gained, growth, replant).
//  - onAnyPixiNodeAdded under a Tile parent: the game's DEFERRED child-view
//    rebuild (TileObjectContainerView syncChildView) creates the view only
//    when the tile scrolls on-screen — no data event accompanies it.
// A burst of addChilds costs one full pass (~1.1 ms) COALESCE_MS after the first.

const COALESCE_MS = 100;
let cleanups: Array<() => void> = [];
let warnedNoTileNodes = false;

// Shape self-check: `Tile (x, y)` is the feature's only node identifier — a
// silent rename in a rebundle would turn filtering into a no-op. Reads the
// cache the apply pass just rebuilt; never walks the stage itself.
function checkSceneShape(): void {
  if (warnedNoTileNodes) return;
  const nodes = tileCache.nodes;
  if (!nodes || nodes.length > 0) return; // null = no stage this pass
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

const scheduleApply = coalesce(() => {
  if (!isFilteringActive()) return;
  applyFilters();
  checkSceneShape();
}, COALESCE_MS);

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
  scheduleApply.cancel();
}
