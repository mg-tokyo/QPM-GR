import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayCycleData } from '../../../../catalogs/logic/dayCycleCatalog';
import type { AbilityDefinition } from './definitions';

// Test data only: build 1989 values (REL-6 spec F13). Production reads them from bundle text.
const CYCLE_1989: DayCycleData = {
  stages: [
    { id: 'day', minutes: 210 },
    { id: 'sunset', minutes: 10 },
    { id: 'midnight', minutes: 10 },
    { id: 'sunrise', minutes: 10 },
  ],
  nocturnalBonus: { day: 0, sunset: 15, midnight: 20, sunrise: 10 },
  chanceCapPerMinute: 0.99,
  crystalModifiers: {
    xpRateMultiplier: { crystalType: 'XP', active: 1.1, inactive: 1 },
    strengthBonus: { crystalType: 'Strength', active: 10, inactive: 0 },
  },
};

const live = {
  cycle: CYCLE_1989 as DayCycleData,
  stage: 'day' as string | null,
  nocturnal: new Set(['Bat']),
  garden: null as unknown,
};

const crystal = (crystalType: string, remainingActiveSeconds: number): Record<string, unknown> =>
  ({ objectType: 'crystal', crystalType, remainingActiveSeconds });
const plant = { objectType: 'plant', species: 'Carrot', slots: [] };

vi.mock('../../../../catalogs/gameCatalogs', () => ({
  getAbilityDef: (): null => null,
  getPetSpecies: (species: string): unknown =>
    live.nocturnal.has(species) ? { isNocturnal: true, diet: [] } : { diet: [] },
}));
vi.mock('../../../../catalogs/logic/dayCycleCatalog', () => ({ getDayCycle: (): DayCycleData => live.cycle }));
vi.mock('../../../../core/gameState', () => ({
  isGameStateReady: (): boolean => true,
  readSync: (): string | null => live.stage,
}));
vi.mock('../../../garden/bridge', () => ({ getGardenSnapshot: (): unknown => live.garden }));

const { computeAbilityStats, computeEffectPerHour, computeDayAverageEffectPerHour } = await import('./stats');
const {
  getAbilityRateContext,
  compoundingChancePerSecond,
  activeCrystalTypes,
  crystalModifierValue,
  averageOverDayCycle,
} = await import('./dayStage');

const def = (baseProbability: number, effectValuePerProc?: number): AbilityDefinition => ({
  id: 'TestAbility', name: 'Test', category: 'xp', trigger: 'continuous', baseProbability,
  ...(effectValuePerProc !== undefined ? { effectValuePerProc } : {}),
});
const perHour = (chancePerMinute: number): number => 3600 * (1 - Math.pow(1 - chancePerMinute, 1 / 60));

beforeEach(() => {
  live.cycle = CYCLE_1989;
  live.stage = 'day';
  live.garden = null;
});

describe('computeAbilityStats without context', () => {
  it('matches the old card chance below the cap and above the old floor', () => {
    const stats = computeAbilityStats(def(30), 80);
    expect(stats.multiplier).toBeCloseTo(0.8);
    expect(stats.chancePerMinute).toBeCloseTo(24);   // old: min(95, 30 * 0.8)
    expect(stats.procsPerHour).toBeCloseTo(perHour(0.24));
    expect(stats.chancePerSecond).toBeCloseTo(compoundingChancePerSecond(0.24) * 100);
    expect(stats.stage).toBeNull();
    expect(stats.dayAverage).toBeUndefined();
  });

  it('has no 0.25 floor', () => {
    const stats = computeAbilityStats(def(30), 10);
    expect(stats.multiplier).toBeCloseTo(0.1);
    expect(stats.chancePerMinute).toBeCloseTo(3);
  });

  it('caps at the parsed cap, and only at 1 when the cap is not parsed', () => {
    expect(computeAbilityStats(def(200), 100).chancePerMinute).toBeCloseTo(99);
    live.cycle = { ...CYCLE_1989, chanceCapPerMinute: 0.5 };
    expect(computeAbilityStats(def(200), 100).chancePerMinute).toBeCloseTo(50);
    live.cycle = { ...CYCLE_1989, chanceCapPerMinute: null };
    const uncapped = computeAbilityStats(def(200), 100);
    expect(uncapped.chancePerMinute).toBe(100);
    expect(uncapped.procsPerHour).toBe(3600);
  });

  it('treats missing strength as 100', () => {
    expect(computeAbilityStats(def(30), null).multiplier).toBe(1);
  });
});

describe('stage bonus', () => {
  it.each([
    ['day', 0], ['sunset', 15], ['midnight', 20], ['sunrise', 10],
  ])('nocturnal pet at %s gets +%i STR', (stage, bonus) => {
    live.stage = stage;
    const stats = computeAbilityStats(def(30), 80, getAbilityRateContext('Bat'));
    expect(stats.stage).toBe(stage);
    expect(stats.stageBonus).toBe(bonus);
    expect(stats.multiplier).toBeCloseTo((80 + bonus) / 100);
    expect(stats.chancePerMinute).toBeCloseTo(30 * (80 + bonus) / 100);
  });

  it('non-nocturnal pet gets no bonus at midnight', () => {
    live.stage = 'midnight';
    const stats = computeAbilityStats(def(30), 80, getAbilityRateContext('Worm'));
    expect(stats.stageBonus).toBe(0);
    expect(stats.multiplier).toBeCloseTo(0.8);
  });

  it('a species newly flagged nocturnal in the catalog gets the bonus and the day average', () => {
    live.stage = 'midnight';
    expect(computeAbilityStats(def(30), 80, getAbilityRateContext('Owl')).stageBonus).toBe(0);
    live.nocturnal.add('Owl');
    try {
      const stats = computeAbilityStats(def(30), 80, getAbilityRateContext('Owl'));
      expect(stats.stageBonus).toBe(20);
      const expected = (210 * perHour(0.24) + 10 * perHour(0.285) + 10 * perHour(0.3) + 10 * perHour(0.27)) / 240;
      expect(stats.dayAverage?.procsPerHour).toBeCloseTo(expected);
    } finally {
      live.nocturnal.delete('Owl');
    }
  });

  it('a stage the bonus table lacks adds nothing', () => {
    live.stage = 'eclipse';
    expect(computeAbilityStats(def(30), 80, getAbilityRateContext('Bat')).stageBonus).toBe(0);
  });

  it('adds the crystal strength bonus', () => {
    const context = { ...getAbilityRateContext('Worm'), strengthBonus: 10 };
    expect(computeAbilityStats(def(30), 80, context).multiplier).toBeCloseTo(0.9);
  });

  it('the cap binds with the stage bonus', () => {
    live.stage = 'midnight';
    expect(computeAbilityStats(def(90), 100, getAbilityRateContext('Bat')).chancePerMinute).toBeCloseTo(99);
  });
});

describe('day average', () => {
  it('weights stage rates by parsed minutes', () => {
    const stats = computeAbilityStats(def(30), 80, getAbilityRateContext('Bat'));
    const expected = (210 * perHour(0.24) + 10 * perHour(0.285) + 10 * perHour(0.3) + 10 * perHour(0.27)) / 240;
    expect(stats.dayAverage?.procsPerHour).toBeCloseTo(expected);
  });

  it('equals the live rate for a non-nocturnal pet', () => {
    const stats = computeAbilityStats(def(30), 80, getAbilityRateContext('Worm'));
    expect(stats.dayAverage?.procsPerHour).toBeCloseTo(stats.procsPerHour);
  });

  it('an extra stage in the parsed table flows through', () => {
    live.cycle = {
      stages: [...(CYCLE_1989.stages ?? []), { id: 'eclipse', minutes: 60 }],
      nocturnalBonus: { ...CYCLE_1989.nocturnalBonus, eclipse: 50 },
      chanceCapPerMinute: 0.99,
      crystalModifiers: null,
    };
    live.stage = 'eclipse';
    const stats = computeAbilityStats(def(30), 80, getAbilityRateContext('Bat'));
    expect(stats.stageBonus).toBe(50);
    const expected = (210 * perHour(0.24) + 10 * perHour(0.285) + 10 * perHour(0.3) + 10 * perHour(0.27) + 60 * perHour(0.39)) / 300;
    expect(stats.dayAverage?.procsPerHour).toBeCloseTo(expected);
  });

  it('is absent and the live rate has no stage term when day-cycle data is missing', () => {
    live.cycle = { stages: null, nocturnalBonus: null, chanceCapPerMinute: null, crystalModifiers: null };
    live.stage = 'midnight';
    const stats = computeAbilityStats(def(30), 80, getAbilityRateContext('Bat'));
    expect(stats.dayAverage).toBeUndefined();
    expect(stats.stageBonus).toBe(0);
    expect(stats.chancePerMinute).toBeCloseTo(24);
  });
});

describe('crystal strength bonus', () => {
  it('is 0 with no active Strength crystal', () => {
    expect(getAbilityRateContext('Worm').strengthBonus).toBe(0);
    live.garden = { tileObjects: { 3: plant, 4: crystal('XP', 600) }, boardwalkTileObjects: {} };
    expect(getAbilityRateContext('Worm').strengthBonus).toBe(0);
  });

  it('adds the parsed value while a Strength crystal has charge, on dirt or boardwalk', () => {
    live.garden = { tileObjects: { 4: crystal('Strength', 600) }, boardwalkTileObjects: {} };
    const context = getAbilityRateContext('Worm');
    expect(context.strengthBonus).toBe(10);
    expect(computeAbilityStats(def(30), 80, context).multiplier).toBeCloseTo(0.9);
    live.garden = { tileObjects: {}, boardwalkTileObjects: { 7: crystal('Strength', 1) } };
    expect(getAbilityRateContext('Worm').strengthBonus).toBe(10);
  });

  it('ignores an expired crystal and does not stack two of one type', () => {
    live.garden = { tileObjects: { 4: crystal('Strength', 0) }, boardwalkTileObjects: {} };
    expect(getAbilityRateContext('Worm').strengthBonus).toBe(0);
    live.garden = { tileObjects: { 4: crystal('Strength', 9), 5: crystal('Strength', 9) } };
    expect(getAbilityRateContext('Worm').strengthBonus).toBe(10);
  });

  it('stacks with the nocturnal stage bonus', () => {
    live.stage = 'midnight';
    live.garden = { tileObjects: { 4: crystal('Strength', 600) } };
    expect(computeAbilityStats(def(30), 80, getAbilityRateContext('Bat')).multiplier).toBeCloseTo(1.1);
  });

  it('is 0 until the modifier table is parsed', () => {
    live.cycle = { ...CYCLE_1989, crystalModifiers: null };
    live.garden = { tileObjects: { 4: crystal('Strength', 600) } };
    expect(getAbilityRateContext('Worm').strengthBonus).toBe(0);
  });

  it('reads only what the parsed table names', () => {
    const active = activeCrystalTypes({ tileObjects: { 1: crystal('Luck', 5), 2: plant, 3: 'junk' }, boardwalkTileObjects: null });
    expect([...active]).toEqual(['Luck']);
    const table = { luckBonus: { crystalType: 'Luck', active: 4, inactive: 0 } };
    expect(crystalModifierValue(table, 'luckBonus', active)).toBe(4);
    expect(crystalModifierValue(table, 'strengthBonus', active)).toBeNull();
    expect(crystalModifierValue(null, 'luckBonus', active)).toBeNull();
  });
});

describe('effect per hour', () => {
  it('scales by strength as before when no context is given', () => {
    const d = def(30, 300);
    const stats = computeAbilityStats(d, 80);
    expect(computeEffectPerHour(d, stats, 80)).toBeCloseTo(stats.procsPerHour * 300 * 0.8);
    expect(computeEffectPerHour(d, stats)).toBeCloseTo(stats.procsPerHour * 300);
  });

  it('day-average effect weights each stage by its strength', () => {
    const d = def(30, 300);
    const stats = computeAbilityStats(d, 80, getAbilityRateContext('Bat'));
    const expected = 300 * (210 * perHour(0.24) * 0.8 + 10 * perHour(0.285) * 0.95 + 10 * perHour(0.3) + 10 * perHour(0.27) * 0.9) / 240;
    expect(computeDayAverageEffectPerHour(d, stats)).toBeCloseTo(expected);
    expect(computeDayAverageEffectPerHour(d, computeAbilityStats(d, 80))).toBeNull();
  });
});

describe('averageOverDayCycle', () => {
  const procsAndValue = (stageContext: ReturnType<typeof getAbilityRateContext>): { procsPerHour: number; valuePerHour: number } => {
    const stats = computeAbilityStats(def(30), 80, stageContext);
    // A per-proc value that depends on the stage's STR, like a garden-valued effect.
    return { procsPerHour: stats.procsPerHour, valuePerHour: stats.procsPerHour * 100 * stats.multiplier };
  };

  it('averages each field over parsed minutes, products not factors', () => {
    live.stage = 'midnight';
    const avg = averageOverDayCycle(getAbilityRateContext('Bat'), procsAndValue);
    expect(avg?.procsPerHour).toBeCloseTo((210 * perHour(0.24) + 10 * perHour(0.285) + 10 * perHour(0.3) + 10 * perHour(0.27)) / 240);
    expect(avg?.valuePerHour).toBeCloseTo(
      100 * (210 * perHour(0.24) * 0.8 + 10 * perHour(0.285) * 0.95 + 10 * perHour(0.3) + 10 * perHour(0.27) * 0.9) / 240,
    );
  });

  it('does not depend on the current stage', () => {
    live.stage = 'day';
    const atDay = averageOverDayCycle(getAbilityRateContext('Bat'), procsAndValue);
    live.stage = 'sunset';
    expect(averageOverDayCycle(getAbilityRateContext('Bat'), procsAndValue)).toEqual(atDay);
  });

  it('evaluates once and equals live for a non-nocturnal pet', () => {
    let calls = 0;
    const avg = averageOverDayCycle(getAbilityRateContext('Worm'), (c) => {
      calls++;
      return { procsPerHour: computeAbilityStats(def(30), 80, c).procsPerHour };
    });
    expect(calls).toBe(1);
    expect(avg?.procsPerHour).toBeCloseTo(perHour(0.24));
  });

  it('is null until the cycle is parsed', () => {
    live.cycle = { stages: null, nocturnalBonus: null, chanceCapPerMinute: null, crystalModifiers: null };
    expect(averageOverDayCycle(getAbilityRateContext('Bat'), procsAndValue)).toBeNull();
  });
});
