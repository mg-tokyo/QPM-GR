import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivePetInfo } from '../../../store/pets';
import type { AbilityDefinition, AbilityRateContext } from '../../../features/pets/data/petAbilities';
import type { DayCycleData } from '../../../catalogs/logic/dayCycleCatalog';

const cycle: DayCycleData = {
  stages: [{ id: 'day', minutes: 210 }, { id: 'sunset', minutes: 10 }, { id: 'midnight', minutes: 10 }, { id: 'sunrise', minutes: 10 }],
  nocturnalBonus: { day: 0, sunset: 15, midnight: 20, sunrise: 10 },
  chanceCapPerMinute: 0.99,
  crystalModifiers: null,
};

const defs = new Map<string, AbilityDefinition>();
let rateContext: AbilityRateContext = { isNocturnal: false, stage: 'day', strengthBonus: 0, dayCycle: cycle };
let strengthScaledEffect = true;
const dynamicEffect = vi.fn((_id: string, _ctx: unknown, strength: number | null | undefined) => ({
  effectPerProc: strengthScaledEffect ? (strength ?? 0) * 1000 : 5e8,
}));

vi.mock('../../../features/pets/data/petAbilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../features/pets/data/petAbilities')>();
  return {
    ...actual,
    getAbilityDefinition: (raw: string) => defs.get(raw) ?? null,
    getAbilityRateContext: () => rateContext,
  };
});
vi.mock('../../../features/pets/abilityValuation', () => ({
  buildAbilityValuationContext: () => ({}),
  resolveDynamicAbilityEffect: dynamicEffect,
}));
vi.mock('../../../features/pets/abilityWeatherGate', () => ({ getInactiveWeatherLabel: () => null }));

const { resolvePetAbilities, getTotals } = await import('./abilities');

function def(over: Partial<AbilityDefinition>): AbilityDefinition {
  return { id: 'X', name: 'X', category: 'misc', trigger: 'continuous', baseProbability: 10, ...over };
}

function pet(abilities: string[], strength = 80): ActivePetInfo {
  return {
    slotIndex: 0, slotId: 's', petId: 'p', hungerPct: null, hungerValue: null, hungerMax: null, hungerRaw: null,
    name: null, species: 'Bat', targetScale: null, mutations: [], abilities, xp: null, level: null, levelRaw: null,
    strength, chargedAbilityId: null, position: null, updatedAt: 0, raw: null,
  };
}

beforeEach(() => {
  defs.clear();
  dynamicEffect.mockClear();
  strengthScaledEffect = true;
  rateContext = { isNocturnal: false, stage: 'day', strengthBonus: 0, dayCycle: cycle };
  defs.set('coin', def({ id: 'coin', category: 'coins', effectUnit: 'coins', effectValuePerProc: 1000 }));
  defs.set('granter', def({ id: 'granter', baseProbability: 0.72 }));
  defs.set('passive', { id: 'passive', name: 'passive', category: 'misc', trigger: 'continuous' });
});

describe('ability tracker rows on the shared maths', () => {
  it('keeps only continuous abilities with a chance, no ID list', () => {
    const rows = resolvePetAbilities(pet(['coin', 'granter', 'passive', 'unknown']), {} as never);
    expect(rows.map((r) => r.def.id)).toEqual(['coin', 'granter']);
  });

  it('day average equals live for a non-nocturnal pet', () => {
    const [coin] = resolvePetAbilities(pet(['coin']));
    expect(coin?.dayAverageProcsPerHour).toBeCloseTo(coin?.procsPerHour ?? -1, 9);
    expect(coin?.dayAverageCoinsPerHour).toBeCloseTo(coin?.coinsPerHour ?? -1, 6);
    expect(coin?.stageBonus).toBe(0);
  });

  it('a nocturnal pet at midnight runs above its day average, coins on effective STR', () => {
    rateContext = { ...rateContext, isNocturnal: true, stage: 'midnight' };
    const [coin, granter] = resolvePetAbilities(pet(['coin', 'granter']), {} as never);
    expect(coin?.stage).toBe('midnight');
    expect(coin?.stageBonus).toBe(20);
    expect(coin?.procsPerHour ?? 0).toBeGreaterThan(coin?.dayAverageProcsPerHour ?? Infinity);
    // live coins = procs/h × 1000 × (80 + 20) / 100
    expect(coin?.coinsPerHour).toBeCloseTo((coin?.procsPerHour ?? 0) * 1000, 6);
    expect(dynamicEffect).toHaveBeenCalledWith('granter', {}, 100);
    expect(granter?.dayAverageCoinsPerHour ?? Infinity).toBeLessThan(granter?.coinsPerHour ?? 0);
  });

  it('linear day average for garden-valued effects matches the per-stage sum', () => {
    rateContext = { ...rateContext, isNocturnal: true, stage: 'sunset' };
    const [granter] = resolvePetAbilities(pet(['granter']), {} as never);
    let expected = 0;
    for (const s of cycle.stages ?? []) {
      rateContext = { ...rateContext, stage: s.id };
      const [row] = resolvePetAbilities(pet(['granter']), {} as never);
      expected += (s.minutes / 240) * (row?.coinsPerHour ?? 0);
    }
    expect(granter?.dayAverageCoinsPerHour).toBeCloseTo(expected, 4);
  });

  it('a garden-valued effect that ignores STR keeps the same day average at every stage', () => {
    strengthScaledEffect = false;
    const averages: number[] = [];
    for (const s of cycle.stages ?? []) {
      rateContext = { ...rateContext, isNocturnal: true, stage: s.id };
      const [row] = resolvePetAbilities(pet(['granter']), {} as never);
      averages.push(row?.dayAverageCoinsPerHour ?? -1);
      expect(row?.dayAverageCoinsPerHour).toBeCloseTo((row?.dayAverageProcsPerHour ?? 0) * 5e8, 0);
    }
    for (const a of averages) expect(a).toBeCloseTo(averages[0] ?? -2, 0);
  });

  it('totals fall back to live when the cycle is unparsed', () => {
    rateContext = { ...rateContext, isNocturnal: true, stage: 'midnight', dayCycle: { ...cycle, stages: null } };
    const totals = getTotals([pet(['coin'])]);
    expect(totals.dayAverageProcsPerHour).toBeCloseTo(totals.procsPerHour, 9);
    expect(totals.dayAverageCoinsPerHour).toBeCloseTo(totals.coinsPerHour, 6);
    expect(totals.abilityCount).toBe(1);
  });
});
