import { readAtomValueSync, subscribeAtomValue } from '../../../core/atomRegistry';
import { getMatchSnapshot, onMatchChange } from '../state';
import { worldTileToPlotTile } from '../render/stage';
import { cancelPlacement, confirmPlacement, selectTower, updatePlacementTile } from './tower';
import type { MatchSnapshot, Point } from '../types';

// Player-driven placement: subscribe to the `position` atom (reactive tier
// 'client', battleship pattern from placementPreview.ts), translate world tile
// → plot-local via stage.worldTileToPlotTile, then commit on Space / cancel on
// Escape. No mouse hover, no polling.

let cleanups: Array<() => void> = [];
let lastPendingKind: string | null = null;

// Force a position re-evaluation using the current position atom. Fires the
// same code path as a real position update; safe to call at any time.
function refreshFromCurrentPosition(): void {
  const cur = readAtomValueSync('position') ?? readAtomValueSync('localPosition');
  onPosition(cur);
}

// Pending placement is driven by button clicks, not the position atom. Without
// this, the ghost preview only appears after the player next moves, and
// selection stays stale after confirm/cancel until the player next moves.
function onSnapshotChange(snap: MatchSnapshot): void {
  const kind = snap.pendingPlacement?.kind ?? null;
  if (kind === lastPendingKind) return;
  lastPendingKind = kind;
  refreshFromCurrentPosition();
}

function tileFromPositionValue(v: unknown): Point | null {
  if (!v || typeof v !== 'object') return null;
  const rec = v as Record<string, unknown>;
  const x = rec.x;
  const y = rec.y;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return worldTileToPlotTile({ x: Math.round(x), y: Math.round(y) });
}

function updateSelectionFromTile(snap: MatchSnapshot, tile: Point | null): void {
  const currentId = snap.selectedTowerId;
  if (!tile) {
    if (currentId !== null) selectTower(null);
    return;
  }
  const hit = snap.towers.find((t) => t.tile.x === tile.x && t.tile.y === tile.y);
  const nextId = hit ? hit.id : null;
  if (nextId !== currentId) selectTower(nextId);
}

function onPosition(v: unknown): void {
  const snap = getMatchSnapshot();
  const tile = tileFromPositionValue(v);
  if (snap.pendingPlacement) {
    updatePlacementTile(tile);
    return;
  }
  updateSelectionFromTile(snap, tile);
}

function onKey(e: KeyboardEvent): void {
  const snap = getMatchSnapshot();
  if (!snap.pendingPlacement) return;
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    confirmPlacement();
    return;
  }
  if (e.code === 'Escape' || e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    cancelPlacement();
  }
}

export function initPlayerInput(): void {
  if (cleanups.length > 0) return;

  lastPendingKind = getMatchSnapshot().pendingPlacement?.kind ?? null;

  // Seed hover with current position so first-frame preview is accurate.
  refreshFromCurrentPosition();

  void subscribeAtomValue('position', onPosition).then((stop) => {
    if (stop) cleanups.push(stop);
  });

  cleanups.push(onMatchChange(onSnapshotChange));

  window.addEventListener('keydown', onKey, true);
  cleanups.push(() => window.removeEventListener('keydown', onKey, true));
}

export function stopPlayerInput(): void {
  for (const c of cleanups.splice(0)) {
    try { c(); } catch { /* ignore */ }
  }
  lastPendingKind = null;
}
