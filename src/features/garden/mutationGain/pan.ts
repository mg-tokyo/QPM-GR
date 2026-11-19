// ALR-6.3: Show/Next cuts the 2D camera to the crop's tile through the seated camera override. The engine drops its
// smoothing while the override is set (live 2036), so the cut is instant both ways. The avatar never moves.
import { readSync, subscribe, writeSync } from '../../../core/gameState';
import type { GridPosition } from '../../../types/gameAtoms';
import { sameGrid, stepAsideReason } from '../../spectator';
import { getMapSnapshot, type MapSnapshot } from '../bridge';

const HOLD_MS = 30_000;

export type PanSkip = 'no-tile' | 'not-seated' | 'cutscene' | 'tram' | 'foreign' | 'refused';

let written: GridPosition | null = null;
let movedFrom: GridPosition | null = null;
let unsubMove: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSkip: PanSkip | null = null;

function globalIdxOf(map: MapSnapshot, mySlotIdx: number, kind: string, idx: number): number | null {
  if (kind === 'g') {
    for (const [g, e] of Object.entries(map.globalTileIdxToDirtTile ?? {})) {
      if (Number(e.dirtTileIdx) === idx && e.userSlotIdx === mySlotIdx) return Number(g);
    }
  } else if (kind === 'b') {
    for (const [g, e] of Object.entries(map.globalTileIdxToBoardwalk ?? {})) {
      if (Number(e.boardwalkTileIdx) === idx && e.userSlotIdx === mySlotIdx) return Number(g);
    }
  }
  return null;
}

/** `g:<dirtTileIdx>` / `b:<boardwalkTileIdx>` in my garden → its grid point; null for another player's tile. */
export function tileKeyToGrid(map: MapSnapshot | null, mySlotIdx: number | null, tileKey: string): GridPosition | null {
  if (!map || mySlotIdx === null || !(map.cols > 0)) return null;
  const sep = tileKey.indexOf(':');
  const idx = Number(tileKey.slice(sep + 1));
  if (sep < 0 || !Number.isInteger(idx)) return null;
  const g = globalIdxOf(map, mySlotIdx, tileKey.slice(0, sep), idx);
  return g === null ? null : { x: g % map.cols, y: Math.floor(g / map.cols) };
}

function skipReason(): PanSkip | null {
  if (readSync('localPresence') !== 'seated') return 'not-seated';
  const r = stepAsideReason({
    cutsceneActive: readSync('activeCutscene') !== null,
    tramActive: readSync('tramJourney') !== null,
    targetKey: 'cutsceneCameraTarget',
    targetValue: readSync('cutsceneCameraTarget'),
    lastWritten: written,
    uiOwnsInput: false,
  });
  return r === 'cutscene' || r === 'tram' || r === 'foreign' ? r : null;
}

function watchMove(): void {
  if (unsubMove) return;
  const at = readSync('position');
  movedFrom = at ? { x: at.x, y: at.y } : null;
  const unsub = subscribe('position', (p) => {
    if (!p) return;
    if (!movedFrom) { movedFrom = { x: p.x, y: p.y }; return; }
    if (!sameGrid(p, movedFrom)) releasePan();
  });
  if (written) unsubMove = unsub;
  else unsub();
}

/** Writes the camera override to the tile; false (with `lastSkip`) when a guard or the map stops it. */
export function panToTile(tileKey: string): boolean {
  const point = tileKeyToGrid(getMapSnapshot(), readSync('myUserSlotIdx'), tileKey);
  lastSkip = point ? skipReason() : 'no-tile';
  if (!point || lastSkip) return false;
  if (!writeSync('cutsceneCameraTarget', point)) { lastSkip = 'refused'; return false; }
  written = point;
  watchMove();
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; releasePan(); }, HOLD_MS);
  return true;
}

/** Nulls the override only while it still holds QPM's point: a cutscene or NPC pan that took it over is left alone. */
export function releasePan(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  unsubMove?.();
  unsubMove = null;
  movedFrom = null;
  if (written && sameGrid(readSync('cutsceneCameraTarget'), written)) writeSync('cutsceneCameraTarget', null);
  written = null;
}

export function getPanState(): { active: boolean; point: GridPosition | null; lastSkip: PanSkip | null } {
  return { active: written !== null, point: written, lastSkip };
}
