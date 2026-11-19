import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = new Map<string, unknown>();
const listeners = new Map<string, Set<(v: unknown) => void>>();
let refuseWrites = false;
vi.mock('../../../core/gameState', () => ({
  readSync: (k: string) => state.get(k) ?? null,
  writeSync: (k: string, v: unknown) => {
    if (refuseWrites) return false;
    state.set(k, v);
    return true;
  },
  subscribe: (k: string, cb: (v: unknown) => void) => {
    const set = listeners.get(k) ?? new Set();
    set.add(cb);
    listeners.set(k, set);
    return () => { set.delete(cb); };
  },
}));
vi.mock('../../spectator', async () => await import('../../spectator/stepAside'));
const map = {
  cols: 10,
  rows: 10,
  globalTileIdxToDirtTile: { 23: { dirtTileIdx: 5, userSlotIdx: 1 }, 24: { dirtTileIdx: 5, userSlotIdx: 0 } },
  globalTileIdxToBoardwalk: { 47: { boardwalkTileIdx: 2, userSlotIdx: 1 } },
};
vi.mock('../bridge', () => ({ getMapSnapshot: () => map }));

const { tileKeyToGrid, panToTile, releasePan, getPanState } = await import('./pan');

const move = (x: number, y: number): void => {
  state.set('position', { x, y });
  for (const cb of listeners.get('position') ?? []) cb({ x, y });
};
const target = (): unknown => state.get('cutsceneCameraTarget') ?? null;

describe('mutation gain camera pan (ALR-6.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.clear();
    listeners.clear();
    refuseWrites = false;
    state.set('localPresence', 'seated');
    state.set('myUserSlotIdx', 1);
    state.set('position', { x: 3, y: 3 });
  });
  afterEach(() => {
    releasePan();
    vi.useRealTimers();
  });

  it('turns my dirt and boardwalk tile keys into grid points; another player tile or a bad key is null', () => {
    expect(tileKeyToGrid(map, 1, 'g:5')).toEqual({ x: 3, y: 2 });
    expect(tileKeyToGrid(map, 0, 'g:5')).toEqual({ x: 4, y: 2 });
    expect(tileKeyToGrid(map, 1, 'b:2')).toEqual({ x: 7, y: 4 });
    expect(tileKeyToGrid(map, 1, 'g:9')).toBeNull();
    expect(tileKeyToGrid(map, null, 'g:5')).toBeNull();
    expect(tileKeyToGrid(map, 1, 'x:5')).toBeNull();
    expect(tileKeyToGrid(null, 1, 'g:5')).toBeNull();
  });

  it('writes the tile point; Next re-targets over its own write', () => {
    expect(panToTile('g:5')).toBe(true);
    expect(target()).toEqual({ x: 3, y: 2 });
    expect(panToTile('b:2')).toBe(true);
    expect(target()).toEqual({ x: 7, y: 4 });
    expect(getPanState()).toEqual({ active: true, point: { x: 7, y: 4 }, lastSkip: null });
  });

  it.each([
    ['not-seated', () => { state.set('localPresence', 'spectating'); }],
    ['cutscene', () => { state.set('activeCutscene', { id: 'npcVisitArrival' }); }],
    ['tram', () => { state.set('tramJourney', { stage: 'departing' }); }],
    ['foreign', () => { state.set('cutsceneCameraTarget', { x: 50, y: 30 }); }],
    ['refused', () => { refuseWrites = true; }],
  ])('skips when %s and never touches a foreign target', (reason, arrange) => {
    arrange();
    const before = target();
    expect(panToTile('g:5')).toBe(false);
    expect(getPanState().lastSkip).toBe(reason);
    expect(target()).toEqual(before);
  });

  it('a tile outside my garden is skipped', () => {
    expect(panToTile('g:9')).toBe(false);
    expect(getPanState().lastSkip).toBe('no-tile');
  });

  it('walking releases; standing on the same tile does not', () => {
    panToTile('g:5');
    move(3, 3);
    expect(target()).toEqual({ x: 3, y: 2 });
    move(4, 3);
    expect(target()).toBeNull();
    expect(getPanState().active).toBe(false);
    expect(listeners.get('position')?.size).toBe(0);
  });

  it('releases 30 s after the last Show/Next', () => {
    panToTile('g:5');
    vi.advanceTimersByTime(20_000);
    panToTile('b:2');
    vi.advanceTimersByTime(20_000);
    expect(target()).toEqual({ x: 7, y: 4 });
    vi.advanceTimersByTime(10_000);
    expect(target()).toBeNull();
  });

  it('release leaves a target the game took over (cutscene, NPC pan)', () => {
    panToTile('g:5');
    state.set('cutsceneCameraTarget', { x: 50, y: 30 });
    releasePan();
    expect(target()).toEqual({ x: 50, y: 30 });
    expect(getPanState().active).toBe(false);
  });
});
