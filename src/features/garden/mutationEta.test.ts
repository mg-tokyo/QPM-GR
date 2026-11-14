import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivePetInfo } from '../../store/pets';

// literal-list-justified: test fixture standing in for the live ability catalog's grantedMutations
const CATALOG: Record<string, { baseParameters: Record<string, unknown> }> = {
  RainbowGranter: { baseParameters: { grantedMutations: ['Rainbow'] } },
  GoldGranter: { baseParameters: { grantedMutations: ['Gold'] } },
  SnowGranter: { baseParameters: { grantedMutations: ['Frozen'] } },
  WetGranter: { baseParameters: { grantedMutations: ['Wet'], requiredWeather: 'Rain' } },
  ProduceScaleBoost: { baseParameters: {} },
};

let dayAverageParsed = true;
let activeWeather: string | null = null;
const subs = { active: 0, total: 0 };
function sub(): () => void {
  subs.active += 1;
  subs.total += 1;
  return () => { subs.active -= 1; };
}

vi.mock('../../catalogs/gameCatalogs', () => ({
  getAbilityDef: (id: string) => CATALOG[id] ?? null,
}));
vi.mock('../pets/data/petAbilities', () => ({
  getAbilityRateContext: () => ({}),
  getAbilityDefinition: (raw: string) => ({
    id: raw,
    trigger: 'continuous',
    baseProbability: 1,
    requiredWeather: raw === 'WetGranter' ? 'rain' : null,
  }),
  // procsPerHour = strength (live) and strength / 2 (day average) keeps the sums readable.
  computeAbilityStats: (_def: unknown, strength: number | null) => ({
    procsPerHour: strength ?? 0,
    ...(dayAverageParsed ? { dayAverage: { procsPerHour: (strength ?? 0) / 2 } } : {}),
  }),
}));
vi.mock('../pets/abilityWeatherGate', () => ({
  isRequiredWeatherActive: (req: string | null) => req === null || req === activeWeather,
}));
vi.mock('./bridge', () => ({ getGardenSnapshot: () => null, onGardenSnapshot: sub }));
vi.mock('./gardenTiles', () => ({ extractTiles: () => [], countActionableFruits: () => 0 }));
vi.mock('../../store/pets', () => ({ getActivePetInfos: () => [], onActivePetInfos: sub }));
vi.mock('../../store/weatherHub', () => ({ onWeatherSnapshot: sub }));
vi.mock('../../catalogs/logic/mutationRulesCatalog', () => ({ onMutationRulesChange: sub }));
vi.mock('../../catalogs/logic/dayCycleCatalog', () => ({ onDayCycleChange: sub, onDayStageChange: sub }));

const { computeMutationEta, getMutationEtaSnapshot, startMutationEta, stopMutationEta } = await import('./mutationEta');

function pet(slotIndex: number, abilities: string[], strength: number, hungerValue: number | null = 100): ActivePetInfo {
  return {
    slotIndex, slotId: `slot-${slotIndex}`, petId: `pet-${slotIndex}`,
    hungerPct: null, hungerValue, hungerMax: null, hungerRaw: null,
    name: null, species: 'Turtle', targetScale: null, mutations: [], abilities,
    xp: null, level: null, levelRaw: null, strength, chargedAbilityId: null,
    position: null, updatedAt: 0, raw: null,
  };
}

const remaining = (table: Record<string, number>) => (m: string): number => table[m] ?? 0;

beforeEach(() => {
  dayAverageParsed = true;
  activeWeather = null;
});

describe('computeMutationEta', () => {
  it('sums two granters of the same mutation on the day-average rate', () => {
    const [entry] = computeMutationEta([pet(0, ['RainbowGranter'], 10), pet(1, ['RainbowGranter'], 30)], remaining({ Rainbow: 40 }));
    expect(entry).toMatchObject({ mutation: 'Rainbow', remaining: 40, procsPerHour: 20, etaHours: 2 });
    expect(entry?.granters.map((g) => g.slotIndex)).toEqual([0, 1]);
  });

  it('uses the live rate while the day cycle is not parsed', () => {
    dayAverageParsed = false;
    const [entry] = computeMutationEta([pet(0, ['GoldGranter'], 8)], remaining({ Gold: 4 }));
    expect(entry).toMatchObject({ procsPerHour: 8, etaHours: 0.5 });
  });

  it('drops a pet at 0 hunger and keeps one with unknown hunger', () => {
    const entries = computeMutationEta(
      [pet(0, ['RainbowGranter'], 10, 0), pet(1, ['RainbowGranter'], 10, null)],
      remaining({ Rainbow: 5 }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.granters.map((g) => g.slotIndex)).toEqual([1]);
    expect(entries[0]?.procsPerHour).toBe(5);
  });

  it('gives no entry when every granter is hungry', () => {
    expect(computeMutationEta([pet(0, ['RainbowGranter'], 10, 0)], remaining({ Rainbow: 5 }))).toEqual([]);
  });

  it('gives etaHours null when the granters have no rate', () => {
    const [entry] = computeMutationEta([pet(0, ['GoldGranter'], 0)], remaining({ Gold: 3 }));
    expect(entry).toMatchObject({ procsPerHour: 0, etaHours: null });
  });

  it('gives etaHours 0 when nothing is left', () => {
    const [entry] = computeMutationEta([pet(0, ['GoldGranter'], 10)], remaining({}));
    expect(entry).toMatchObject({ remaining: 0, etaHours: 0 });
  });

  it('reads the granted mutation from the catalog, not the ability name', () => {
    const entries = computeMutationEta([pet(0, ['SnowGranter', 'ProduceScaleBoost', 'Unknown'], 10)], remaining({ Frozen: 1 }));
    expect(entries.map((e) => e.mutation)).toEqual(['Frozen']);
  });

  it('skips a weather-gated granter while its weather is inactive', () => {
    expect(computeMutationEta([pet(0, ['WetGranter'], 10)], remaining({ Wet: 1 }))).toEqual([]);
    activeWeather = 'rain';
    expect(computeMutationEta([pet(0, ['WetGranter'], 10)], remaining({ Wet: 1 }))).toHaveLength(1);
  });
});

describe('mutation ETA service', () => {
  it('start and stop are idempotent and release every subscription', async () => {
    startMutationEta();
    startMutationEta();
    expect(subs.active).toBe(6);
    expect(subs.total).toBe(6);
    await Promise.resolve();
    expect(getMutationEtaSnapshot().computedAt).toBeGreaterThan(0);
    stopMutationEta();
    stopMutationEta();
    expect(subs.active).toBe(0);
    expect(getMutationEtaSnapshot()).toEqual({ computedAt: 0, entries: [] });
  });
});
