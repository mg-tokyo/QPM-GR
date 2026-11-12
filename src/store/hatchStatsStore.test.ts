import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerScopedLayout, PlayerScopedSpec } from './playerScoped';
import type { HatchStatsState } from './hatchStatsStore';

const captured: { spec: PlayerScopedSpec<HatchStatsState> | null; layout: PlayerScopedLayout<HatchStatsState> | null } = { spec: null, layout: null };
let ready = false;
const handle = {
  start: vi.fn(),
  stop: vi.fn(),
  write: vi.fn((_value: HatchStatsState) => true),
  read: vi.fn(),
  isReady: vi.fn(() => ready),
  scopedKey: vi.fn(() => (ready ? 'qpm.hatchStats.v1.p1' : null)),
};
const createPlayerScoped = vi.fn((spec: PlayerScopedSpec<HatchStatsState>, layout: PlayerScopedLayout<HatchStatsState>) => {
  captured.spec = spec;
  captured.layout = layout;
  return handle;
});

vi.mock('./playerScoped', () => ({ createPlayerScoped }));
vi.mock('../catalogs/gameCatalogs', () => ({
  areCatalogsReady: () => true,
  getAllPetSpecies: () => ['Turtle', 'Bee'],
  onCatalogsReady: () => () => {},
}));

const store = await import('./hatchStatsStore');

function saved(turtles: number): HatchStatsState {
  return {
    lifetime: { totalHatched: turtles, bySpecies: { Turtle: { total: turtles, normal: turtles, gold: 0, rainbow: 0 } }, byAbility: { A: 1 } },
    session: { totalHatched: 7, bySpecies: {}, byAbility: {}, start: 1 },
    recentEvents: [{ species: 'Turtle', rarity: 'normal', abilities: ['A'], timestamp: 1 }],
    seededPetIds: ['p0'],
    meta: { version: 1, updatedAt: 1, cleanedAt: 1 },
  };
}

function bind(value: HatchStatsState): void {
  ready = true;
  captured.spec?.onReady(value, 'p1');
}

describe('hatch stats on the player-scoped helper', () => {
  beforeEach(() => {
    store.stopHatchStatsStore();
    ready = false;
    vi.clearAllMocks();
    store.initHatchStatsStore();
  });

  it('starts one handle, validates stored copies, and stops idempotently', () => {
    store.initHatchStatsStore();
    expect(createPlayerScoped).toHaveBeenCalledTimes(1);
    expect(handle.start).toHaveBeenCalledTimes(1);
    expect(captured.layout?.parts).toEqual(['qpm.hatchStats.v1']);
    expect(captured.layout?.join([{ meta: { version: 2 } }])).toBeUndefined();
    store.stopHatchStatsStore();
    store.stopHatchStatsStore();
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it('replays hatches seen before the bind onto the player copy and writes once', () => {
    store.recordDetailedHatch('Bee', 'gold', ['B'], 50);
    expect(handle.write).not.toHaveBeenCalled();
    bind(saved(4));
    const s = store.getHatchStatsSnapshot();
    expect(s.lifetime.totalHatched).toBe(5);
    expect(s.lifetime.bySpecies.Bee).toEqual({ total: 1, normal: 0, gold: 1, rainbow: 0 });
    expect(s.session.totalHatched).toBe(1);
    expect(s.recentEvents[0]?.species).toBe('Bee');
    expect(handle.write).toHaveBeenCalledTimes(1);
    store.recordDetailedHatch('Turtle', 'normal', [], 60);
    expect(store.getHatchStatsSnapshot().lifetime.totalHatched).toBe(6);
  });

  it('does not write on a plain bind and restarts the session bucket', () => {
    bind(saved(4));
    expect(handle.write).not.toHaveBeenCalled();
    expect(store.getHatchStatsSnapshot().session.totalHatched).toBe(0);
  });

  it('never mutates the shared fallback', () => {
    const fallback = captured.spec?.fallback;
    if (!fallback) throw new Error('no spec');
    bind(fallback);
    store.recordDetailedHatch('Turtle', 'normal', [], 1);
    expect(fallback.lifetime.totalHatched).toBe(0);
  });

  it('keeps a pre-bind hatch when the bound copy is new and the one-time cleanup runs', () => {
    store.recordDetailedHatch('Bee', 'normal', ['B'], 9);
    const fallback = captured.spec?.fallback;
    if (!fallback) throw new Error('no spec');
    bind(fallback);
    const s = store.getHatchStatsSnapshot();
    expect(s.meta.cleanedAt).toBeDefined();
    expect(s.recentEvents).toHaveLength(1);
    expect(s.lifetime.byAbility).toEqual({ B: 1 });
  });

  it('refuses to seed before the bind', () => {
    expect(store.seedLifetimeFromPets([{ id: 'x', species: 'Turtle' }])).toEqual({ added: 0 });
    bind(saved(0));
    expect(store.seedLifetimeFromPets([{ id: 'x', species: 'Turtle' }])).toEqual({ added: 1 });
  });
});
