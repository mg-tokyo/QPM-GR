import type { Coord, FleetLayout } from './types';
import { BOARD_SIZE, FLEET_SPECS } from './constants.ts';
import { coordKey } from './board.ts';
import {
  enterPatchStage,
  exitPatchStage,
  dispatchSynthetic,
  updateStageDoctor,
  isPatchStageActive,
  isPatchStageAvailable,
} from '../../core/patchStage';
import { getRoomConnection } from '../../websocket/api';
import { getPlayerIdSync } from '../../core/playerContext';
import { getPlantSpeciesSafe, isValidPlantSpecies } from '../../utils/game/catalogHelpers';
import { createNamedLogger } from '../../diagnostics/logger';
import { initFlameOverlay, markFlameAt, clearAllFlames, destroyFlameOverlay } from './flameOverlay';
import { initPreviewOverlay, destroyPreviewOverlay } from './previewOverlay';

const log = createNamedLogger('battleship');

// Plot origins (first dirt cell per slot) from the Tiled map:
// scraped-data/BetaGameSourceFiles/Dawn Shop, Dawn Capsules, & More!/
// preview.magicgarden.gg/common/games/Quinoa/world/Tiled/map.json, parsed per
// generateMap() (map/utils.ts:335-374). Live-verified anchor 2026-08-04:
// slot0 localIdx10 -> Tile (25, 14). Each plot: two 10x10 grids, 1-col gap.
const PLOT_ORIGINS: ReadonlyArray<{ col: number; row: number }> = [
  { col: 14, row: 14 },
  { col: 40, row: 14 },
  { col: 66, row: 14 },
  { col: 14, row: 36 },
  { col: 40, row: 36 },
  { col: 66, row: 36 },
];

export type GridSide = 0 | 1; // 0 = left grid, 1 = right grid

// localIdx ordering is row-major across BOTH grids (spike findings §6).
export function boardToLocalIdx(grid: GridSide, c: Coord): number {
  return c.row * 20 + grid * 10 + c.col;
}

export function tileWorldPosition(slotIdx: number, grid: GridSide, c: Coord): { col: number; row: number } | null {
  const origin = PLOT_ORIGINS[slotIdx];
  if (!origin) return null;
  return { col: origin.col + grid * 11 + c.col, row: origin.row + c.row };
}

/** Which plot+grid+board-cell does a world (x, y) tile fall into? Null when off-board. */
export function worldToBoard(
  slotIdx: number,
  worldX: number,
  worldY: number,
): { grid: GridSide; coord: Coord } | null {
  const origin = PLOT_ORIGINS[slotIdx];
  if (!origin) return null;
  const row = worldY - origin.row;
  if (row < 0 || row >= BOARD_SIZE) return null;
  const leftCol = worldX - origin.col;
  if (leftCol >= 0 && leftCol < BOARD_SIZE) return { grid: 0, coord: { col: leftCol, row } };
  const rightCol = worldX - (origin.col + 11);
  if (rightCol >= 0 && rightCol < BOARD_SIZE) return { grid: 1, coord: { col: rightCol, row } };
  return null;
}

/** Convert a HarvestCrop/WaterPlant/etc. `slot` (localIdx) to (grid, coord). */
export function localIdxToBoard(localIdx: number): { grid: GridSide; coord: Coord } | null {
  if (localIdx < 0 || localIdx >= 200) return null;
  const row = Math.floor(localIdx / 20);
  const col20 = localIdx % 20;
  const grid: GridSide = col20 < 10 ? 0 : 1;
  const col = col20 - grid * 10;
  return { grid, coord: { col, row } };
}

type StateShape = {
  child?: { data?: { userSlots?: Array<{ playerId?: string; data?: { garden?: { tileObjects?: Record<string, unknown> } } } | null> } };
};

export function resolveSlotIdx(playerId: string): number {
  const state = getRoomConnection()?.lastRoomStateJsonable as StateShape | undefined;
  const slots = state?.child?.data?.userSlots;
  if (!Array.isArray(slots)) return -1;
  return slots.findIndex(s => s != null && s.playerId === playerId);
}

export function resolveMySlotIdx(): number {
  const pid = getPlayerIdSync();
  if (!pid) return -1;
  return resolveSlotIdx(pid);
}

/** Deterministic shipId -> species mapping, identical on every client. */
export function pickFleetSpecies(): Map<string, string> {
  const preferred = ['Cattail', 'Tomato', 'Corn', 'Strawberry', 'Blueberry'];
  const available = preferred.filter(s => isValidPlantSpecies(s));
  const all = getPlantSpeciesSafe().slice().sort();
  for (const s of all) {
    if (available.length >= FLEET_SPECS.length) break;
    if (!available.includes(s)) available.push(s);
  }
  const map = new Map<string, string>();
  FLEET_SPECS.forEach((spec, i) => {
    map.set(spec.id, available[i] ?? available[0] ?? 'Tomato');
  });
  return map;
}

function makePlantTile(species: string, mutations: readonly string[] = []): Record<string, unknown> {
  const now = Date.now();
  // Shape verified from a live planted tile (spike findings §5). Times in the
  // past so the plant renders fully mature.
  return {
    objectType: 'plant',
    species,
    slots: [
      {
        species,
        startTime: now - 7_200_000,
        endTime: now - 3_600_000,
        targetScale: 2,
        mutations: [...mutations],
        slotId: 0,
      },
    ],
    plantedAt: now - 10_800_000,
    maturedAt: now - 7_200_000,
  };
}

// Miss marker: bare Cabbage plant (species verified live 2026-08-04, catalog key
// is 'Cabbage' — 'CabbagePlant' would crash the coinMultiplier reducer per tick).
const MISS_SPECIES = 'Cabbage';

function makeMissTile(): Record<string, unknown> {
  return makePlantTile(MISS_SPECIES);
}

interface BoardView {
  slotIdx: number;
  grid: GridSide;
  /** localIdx -> fake tile (null = force-empty). Cells absent = cleared dirt. */
  tiles: Map<number, Record<string, unknown> | null>;
}

let myView: BoardView | null = null;
let oppView: BoardView | null = null;

function tilePath(slotIdx: number, localIdx: number): string {
  return `/child/data/userSlots/${slotIdx}/data/garden/tileObjects/${localIdx}`;
}

function gridLocalIndices(grid: GridSide): number[] {
  const out: number[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      out.push(boardToLocalIdx(grid, { col, row }));
    }
  }
  return out;
}

function applyViewToState(state: StateShape, view: BoardView): void {
  const slot = state.child?.data?.userSlots?.[view.slotIdx];
  const tiles = slot?.data?.garden?.tileObjects;
  if (!tiles) return;
  for (const localIdx of gridLocalIndices(view.grid)) {
    const key = String(localIdx);
    const fake = view.tiles.get(localIdx);
    if (fake != null) tiles[key] = fake;
    else delete tiles[key];
  }
}

function doctor(state: unknown): unknown {
  const s = state as StateShape;
  if (myView) applyViewToState(s, myView);
  if (oppView) applyViewToState(s, oppView);
  return state;
}

function localIdxInGrid(localIdx: number, grid: GridSide): boolean {
  if (localIdx < 0 || localIdx >= 200) return false;
  const col20 = localIdx % 20;
  return grid === 0 ? col20 < 10 : col20 >= 10;
}

function suppress(path: string): boolean {
  const m = /^\/child\/data\/userSlots\/(\d+)\/data\/garden\/tileObjects\/(\d+)/.exec(path);
  if (!m || m[1] === undefined || m[2] === undefined) return false;
  const slotIdx = Number(m[1]);
  const localIdx = Number(m[2]);
  for (const view of [myView, oppView]) {
    if (view && view.slotIdx === slotIdx && localIdxInGrid(localIdx, view.grid)) return true;
  }
  return false;
}

export function isGardenStageActive(): boolean {
  return myView !== null && isPatchStageActive();
}

export function enterBattleStage(myGrid: GridSide): { ok: boolean; mySlotIdx: number } {
  if (myView) return { ok: true, mySlotIdx: myView.slotIdx };
  if (!isPatchStageAvailable()) {
    log.warn('QPM-BS-001', { reason: 'patch_stage_unavailable' });
    return { ok: false, mySlotIdx: -1 };
  }
  const mySlotIdx = resolveMySlotIdx();
  if (mySlotIdx < 0 || !PLOT_ORIGINS[mySlotIdx]) {
    log.warn('QPM-BS-001', { reason: 'slot_not_resolved', mySlotIdx });
    return { ok: false, mySlotIdx };
  }
  myView = { slotIdx: mySlotIdx, grid: myGrid, tiles: new Map() };
  oppView = null;
  if (!enterPatchStage(doctor, suppress)) {
    myView = null;
    return { ok: false, mySlotIdx };
  }
  // Flame overlay is a nice-to-have visual; missing it doesn't abort the match.
  // Log-only if PIXI ctors aren't reachable — hits fall back to bare dirt.
  if (!initFlameOverlay()) {
    log.warn('QPM-BS-003', { reason: 'flame_overlay_init_failed' });
  }
  if (!initPreviewOverlay()) {
    log.warn('QPM-BS-004', { reason: 'preview_overlay_init_failed' });
  }
  dispatchSynthetic(gridLocalIndices(myGrid).map(i => tilePath(mySlotIdx, i)));
  return { ok: true, mySlotIdx };
}

/**
 * Stage the opponent board on a specific slot+grid (cleared; reveals appear
 * later). Solo mode points this at MY slot's other grid — the AI's hidden
 * garden lives there.
 */
export function setOpponentStageAt(slotIdx: number, oppGrid: GridSide): boolean {
  if (!myView) return false;
  if (slotIdx < 0 || !PLOT_ORIGINS[slotIdx]) {
    log.warn('QPM-BS-002', { reason: 'opp_slot_not_resolved', slotIdx });
    return false;
  }
  oppView = { slotIdx, grid: oppGrid, tiles: new Map() };
  updateStageDoctor(doctor);
  dispatchSynthetic(gridLocalIndices(oppGrid).map(i => tilePath(slotIdx, i)));
  return true;
}

/** MP: stage the opponent's chosen grid on THEIR plot. */
export function setOpponentStage(oppPlayerId: string, oppGrid: GridSide): boolean {
  return setOpponentStageAt(resolveSlotIdx(oppPlayerId), oppGrid);
}

/** Replace my staged fleet wholesale (placement editing + final layout). */
export function setMyFleet(layout: FleetLayout): void {
  if (!myView) return;
  const view = myView;
  const previous = new Set(view.tiles.keys());
  view.tiles.clear();
  for (const ship of layout) {
    for (const cell of ship.cells) {
      view.tiles.set(boardToLocalIdx(view.grid, cell), makePlantTile(ship.species));
    }
  }
  updateStageDoctor(doctor);
  const dirty = new Set([...previous, ...view.tiles.keys()]);
  dispatchSynthetic([...dirty].map(i => tilePath(view.slotIdx, i)));
}

/** Mark a shot on my board (AI's shot at me): hit or miss. */
export function markShotOnMyBoard(c: Coord, kind: 'miss' | 'hit'): void {
  if (!myView) return;
  const view = myView;
  const localIdx = boardToLocalIdx(view.grid, c);
  if (kind === 'hit') {
    // Keep my ship crop visible; overlay a flame on top so hit tiles read as
    // "burning" rather than removed.
    markFlameAt(view.slotIdx, view.grid, c);
    return;
  }
  view.tiles.set(localIdx, makeMissTile());
  updateStageDoctor(doctor);
  dispatchSynthetic([tilePath(view.slotIdx, localIdx)]);
}

/** Mark a shot on the opponent's board: hit or miss. `species` reveals the
 * enemy crop on hits so the burning-crop treatment matches my-board hits. */
export function markShotOnOppBoard(c: Coord, kind: 'miss' | 'hit', species?: string): void {
  if (!oppView) return;
  const view = oppView;
  const localIdx = boardToLocalIdx(view.grid, c);
  if (kind === 'hit') {
    if (species) view.tiles.set(localIdx, makePlantTile(species));
    updateStageDoctor(doctor);
    dispatchSynthetic([tilePath(view.slotIdx, localIdx)]);
    markFlameAt(view.slotIdx, view.grid, c);
    return;
  }
  view.tiles.set(localIdx, makeMissTile());
  updateStageDoctor(doctor);
  dispatchSynthetic([tilePath(view.slotIdx, localIdx)]);
}

export function getMySlotAndGrid(): { slotIdx: number; grid: GridSide } | null {
  return myView ? { slotIdx: myView.slotIdx, grid: myView.grid } : null;
}

export function getOppSlotAndGrid(): { slotIdx: number; grid: GridSide } | null {
  return oppView ? { slotIdx: oppView.slotIdx, grid: oppView.grid } : null;
}

export function exitBattleStage(): void {
  if (!myView) return;
  const paths: string[] = [];
  for (const view of [myView, oppView]) {
    if (!view) continue;
    for (const localIdx of gridLocalIndices(view.grid)) {
      paths.push(tilePath(view.slotIdx, localIdx));
    }
  }
  myView = null;
  oppView = null;
  destroyFlameOverlay();
  destroyPreviewOverlay();
  exitPatchStage(paths);
}

export { clearAllFlames };

export { coordKey };
