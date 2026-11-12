import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerScopedLayout, PlayerScopedSpec } from './playerScoped';
import type { XpProcEntry } from './xpTracker';
import type { ActivePetInfo } from './pets';
import type { AbilityDefinition, AbilityRateContext } from '../features/pets/data/petAbilities';
import type { DayCycleData } from '../catalogs/logic/dayCycleCatalog';

const captured: { spec: PlayerScopedSpec<XpProcEntry[]> | null; layout: PlayerScopedLayout<XpProcEntry[]> | null } = { spec: null, layout: null };
let ready = false;
const handle = {
  start: vi.fn(),
  stop: vi.fn(),
  write: vi.fn((_value: XpProcEntry[]) => true),
  read: vi.fn(),
  isReady: vi.fn(() => ready),
  scopedKey: vi.fn(() => (ready ? 'qpm.xpTrackerProcs.v1.p1' : null)),
};
const createPlayerScoped = vi.fn((spec: PlayerScopedSpec<XpProcEntry[]>, layout: PlayerScopedLayout<XpProcEntry[]>) => {
  captured.spec = spec;
  captured.layout = layout;
  return handle;
});

vi.mock('./playerScoped', () => ({ createPlayerScoped }));
vi.mock('../utils/storage', () => ({ storage: { get: vi.fn((_key: string, fallback: unknown) => fallback), set: vi.fn() } }));
vi.mock('../utils/xpInference', () => ({ getAllPetXpEstimates: () => ({}), inferXpPerLevel: () => null }));
vi.mock('../catalogs/gameCatalogs', () => ({ areCatalogsReady: () => false, onCatalogsReady: vi.fn(), getPetMaxScale: () => null }));

const xp = await import('./xpTracker');
const { computeAbilityStats, computeDayAverageEffectPerHour } = await import('../features/pets/data/petAbilities');

const proc = (petId: string, timestamp: number, abilityId = 'PetXpBoost'): XpProcEntry => ({
  petId, petName: petId, species: 'Bee', abilityId, xpAmount: 0, timestamp,
});

beforeEach(() => {
  vi.useFakeTimers();
  xp.stopXpTracker();
  ready = false;
  captured.spec = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('mergeXpProcs', () => {
  it('unions by (petId, abilityId, timestamp) in time order and returns a itself when b adds nothing', () => {
    const a = [proc('p', 1), proc('p', 3)];
    expect(xp.mergeXpProcs(a, [proc('p', 3), proc('p', 2), proc('p', 2), proc('p', 1, 'Other')]).map((e) => [e.timestamp, e.abilityId]))
      .toEqual([[1, 'PetXpBoost'], [1, 'Other'], [2, 'PetXpBoost'], [3, 'PetXpBoost']]);
    expect(xp.mergeXpProcs(a, [proc('p', 1), proc('p', 3)])).toBe(a);
  });

  it('keeps the newest past the cap', () => {
    expect(xp.mergeXpProcs([proc('p', 5)], [proc('p', 1), proc('p', 9)], 2).map((e) => e.timestamp)).toEqual([5, 9]);
  });
});

describe('xpTracker on the player-scoped helper', () => {
  it('starts one handle however often it is initialised, and the layout drops malformed entries', () => {
    xp.initializeXpTracker();
    xp.initializeXpTracker();
    expect(createPlayerScoped).toHaveBeenCalledTimes(1);
    expect(handle.start).toHaveBeenCalledTimes(1);
    expect(captured.layout?.join([{ procs: [proc('p', 1), { petId: 'x' }], savedAt: 1 }])).toEqual([proc('p', 1)]);
    expect(captured.layout?.join([{ nope: 1 }])).toBeUndefined();
  });

  it('keeps procs recorded before the id on the first bind', () => {
    xp.initializeXpTracker();
    vi.setSystemTime(50);
    xp.recordXpProc('early', 'early', 'Bee', 'PetXpBoost', 0);
    ready = true;
    captured.spec?.onReady([proc('stored', 10)], 'p1');
    expect(xp.getXpProcHistory().map((e) => e.petId)).toEqual(['stored', 'early']);
    expect(handle.write).toHaveBeenLastCalledWith([proc('stored', 10), proc('early', 50)]);
  });

  it('replaces the session procs with the new account copy on an id change', () => {
    xp.initializeXpTracker();
    ready = true;
    captured.spec?.onReady([proc('first', 10)], 'p1');
    vi.setSystemTime(60);
    xp.recordXpProc('mine', 'mine', 'Bee', 'PetXpBoost', 0);
    captured.spec?.flush?.();
    expect(handle.write).toHaveBeenLastCalledWith([proc('first', 10), proc('mine', 60)]);
    captured.spec?.onReady([proc('second', 20)], 'p2');
    expect(xp.getXpProcHistory().map((e) => e.petId)).toEqual(['second']);
  });

  it('stop saves pending procs and forgets them', () => {
    xp.initializeXpTracker();
    ready = true;
    captured.spec?.onReady([], 'p1');
    vi.setSystemTime(70);
    xp.recordXpProc('late', 'late', 'Bee', 'PetXpBoost', 0);
    xp.stopXpTracker();
    expect(handle.write).toHaveBeenLastCalledWith([proc('late', 70)]);
    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(xp.getXpProcHistory()).toEqual([]);
  });
});

describe('calculateXpStats on the shared ability maths', () => {
  // 1989 values as test data only (plan: no hardcoded game tables in src).
  const cycle: DayCycleData = {
    stages: [{ id: 'day', minutes: 210 }, { id: 'sunset', minutes: 10 }, { id: 'midnight', minutes: 10 }, { id: 'sunrise', minutes: 10 }],
    nocturnalBonus: { day: 0, sunset: 15, midnight: 20, sunrise: 10 },
    chanceCapPerMinute: 0.99,
    crystalModifiers: null,
  };
  const ctx = (over: Partial<AbilityRateContext> = {}): AbilityRateContext => ({ isNocturnal: false, stage: 'day', strengthBonus: 0, dayCycle: cycle, ...over });
  const def = (over: Partial<AbilityDefinition> = {}): AbilityDefinition => ({
    id: 'PetXpBoost', name: 'XP Boost', category: 'xp', trigger: 'continuous', baseProbability: 30, effectValuePerProc: 300, ...over,
  });
  const pet = { petId: 'p1', name: 'Batty', species: 'Bat', strength: 85, level: null, xp: null } as unknown as ActivePetInfo;

  it('delegates chance, procs and XP/h to computeAbilityStats', () => {
    const context = ctx();
    const row = xp.calculateXpStats(pet, def(), 'XP Boost', 'sunny', context);
    const shared = computeAbilityStats(def(), 85, context);
    expect(row.actualChancePerMinute).toBe(shared.chancePerMinute);
    expect(row.actualChancePerSecond).toBe(shared.chancePerSecond);
    expect(row.expectedProcsPerHour).toBe(shared.procsPerHour);
    expect(row.expectedXpPerHour).toBeCloseTo(shared.procsPerHour * 300 * 0.85, 9);
    expect(row.dayAverageXpPerHour).toBeCloseTo(computeDayAverageEffectPerHour(def(), shared) ?? NaN, 9);
    expect(row.dayAverageXpPerHour).toBeCloseTo(row.expectedXpPerHour, 9);
    expect(row.actualXpPerProc).toBeCloseTo(255, 9);
  });

  it('adds the parsed stage bonus for a nocturnal pet live, and averages it over the day', () => {
    const row = xp.calculateXpStats(pet, def(), 'XP Boost', 'sunny', ctx({ isNocturnal: true, stage: 'midnight' }));
    expect(row).toMatchObject({ stage: 'midnight', stageBonus: 20, isNocturnal: true });
    expect(row.actualXpPerProc).toBeCloseTo(300 * 1.05, 9);
    expect(row.dayAverageXpPerHour).not.toBeNull();
    expect(row.dayAverageXpPerHour ?? Infinity).toBeLessThan(row.expectedXpPerHour);
  });

  it('zeroes both rates off the required weather, and has no average before the cycle parses', () => {
    const gated = xp.calculateXpStats(pet, def({ requiredWeather: 'thunderstorm' }), 'X', 'sunny', ctx());
    expect([gated.expectedXpPerHour, gated.dayAverageXpPerHour]).toEqual([0, 0]);
    const unparsed = xp.calculateXpStats(pet, def(), 'X', 'sunny', ctx({ dayCycle: { ...cycle, stages: null } }));
    expect(unparsed.dayAverageXpPerHour).toBeNull();
    expect(unparsed.expectedXpPerHour).toBeGreaterThan(0);
  });

  it('combines per-minute chance by compounding and nulls the team average when any row lacks one', () => {
    const a = xp.calculateXpStats(pet, def(), 'X', 'sunny', ctx());
    const b = xp.calculateXpStats(pet, def(), 'X', 'sunny', ctx({ dayCycle: { ...cycle, stages: null } }));
    const both = xp.getCombinedXpStats([a, a]);
    const p = a.actualChancePerSecond / 100;
    expect(both.combinedChancePerMinute).toBeCloseTo((1 - Math.pow((1 - p) * (1 - p), 60)) * 100, 9);
    expect(both.totalDayAverageXpPerHour).toBeCloseTo(2 * (a.dayAverageXpPerHour ?? NaN), 9);
    expect(xp.getCombinedXpStats([a, b]).totalDayAverageXpPerHour).toBeNull();
  });
});
