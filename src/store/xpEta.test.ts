import { describe, expect, it, vi } from 'vitest';
import type { ActivePetInfo } from './pets';
import type { XpAbilityStats } from './xpTracker';

const defs: Record<string, { id: string; category: string; trigger: string }> = {
  XpA: { id: 'XpA', category: 'xp', trigger: 'continuous' },
  XpB: { id: 'XpB', category: 'xp', trigger: 'continuous' },
  Coin: { id: 'Coin', category: 'coins', trigger: 'continuous' },
};
const rowRates: Record<string, { live: number; day: number | null }> = { XpA: { live: 100, day: 80 }, XpB: { live: 50, day: 40 } };

vi.mock('../features/pets/data/petAbilities', () => ({ getAbilityDefinition: (id: string) => defs[id] }));
vi.mock('../utils/game/catalogHelpers', () => ({ getAbilityName: (id: string) => id }));
vi.mock('./xpTracker', () => ({
  calculateXpStats: (_pet: unknown, def: { id: string }) => ({
    abilityId: def.id, expectedXpPerHour: rowRates[def.id]?.live ?? 0, dayAverageXpPerHour: rowRates[def.id]?.day ?? null,
    expectedProcsPerHour: 2, procCount: 1,
  }) as unknown as XpAbilityStats,
  getCombinedXpStats: (stats: XpAbilityStats[]) => {
    let day: number | null = 0;
    for (const s of stats) day = s.dayAverageXpPerHour === null || day === null ? null : day + s.dayAverageXpPerHour;
    return {
      totalXpPerHour: stats.reduce((a, s) => a + s.expectedXpPerHour, 0),
      totalDayAverageXpPerHour: day,
      totalProcsPerHour: stats.reduce((a, s) => a + s.expectedProcsPerHour, 0),
      totalProcCount: stats.reduce((a, s) => a + s.procCount, 0),
    };
  },
}));

const { computeTeamXpRates, minutesToMaxStr, xpToMaxStr, PASSIVE_XP_PER_HOUR } = await import('./xpEta');

function oldInlineXpToMax(xp: number, strength: number, maxStr: number, xpPerLevel: number): number {
  const xpToNext = xp % xpPerLevel;
  const levelsLeft = maxStr - strength;
  return (xpPerLevel - xpToNext) + xpPerLevel * (levelsLeft - 1);
}

const pet = (abilities: string[]): ActivePetInfo => ({ abilities } as unknown as ActivePetInfo);

describe('xpEta (ALR-14.1)', () => {
  it('xpToMaxStr equals the old inline formula below max', () => {
    for (const [xp, strength, maxStr, perLevel] of [[0, 70, 100, 3600], [12345, 73, 99, 3600], [999999, 95, 100, 7200], [3599, 80, 81, 3600]] as const) {
      expect(xpToMaxStr({ xp, strength, maxStr, xpPerLevel: perLevel })).toBe(oldInlineXpToMax(xp, strength, maxStr, perLevel));
    }
  });

  it('at or above max, or with an unusable xpPerLevel, there is nothing to reach', () => {
    expect(xpToMaxStr({ xp: 5000, strength: 100, maxStr: 100, xpPerLevel: 3600 })).toBeNull();
    expect(xpToMaxStr({ xp: 5000, strength: 101, maxStr: 100, xpPerLevel: 3600 })).toBeNull();
    expect(xpToMaxStr({ xp: 5000, strength: 80, maxStr: 100, xpPerLevel: 0 })).toBeNull();
    expect(xpToMaxStr({ xp: 5000, strength: 80, maxStr: 100, xpPerLevel: Number.NaN })).toBeNull();
  });

  it('minutesToMaxStr equals the old (xpToMax / rate) * 60 and is null without a positive rate', () => {
    const p = { xp: 12345, strength: 73, maxStr: 99, xpPerLevel: 3600 };
    expect(minutesToMaxStr(p, 5400)).toBe((oldInlineXpToMax(12345, 73, 99, 3600) / 5400) * 60);
    expect(minutesToMaxStr(p, 0)).toBeNull();
    expect(minutesToMaxStr({ ...p, strength: 99 }, 5400)).toBeNull();
  });

  it('a team with no XP ability earns the passive rate only', () => {
    const r = computeTeamXpRates([pet(['Coin']), pet([])], 'sunny');
    expect(PASSIVE_XP_PER_HOUR).toBe(3600);
    expect(r).toMatchObject({ abilityXpPerHour: 0, liveTeamXpPerHour: 3600, planningTeamXpPerHour: 3600, totalProcsPerHour: 0, totalProcCount: 0 });
    expect(r.stats).toEqual([]);
  });

  it('planning uses the day average when every row has one, the live rate otherwise', () => {
    const both = computeTeamXpRates([pet(['XpA', 'Coin']), pet(['XpB'])], 'sunny');
    expect(both).toMatchObject({ abilityXpPerHour: 150, liveTeamXpPerHour: 3750, planningTeamXpPerHour: 3720, totalProcsPerHour: 4, totalProcCount: 2 });
    rowRates.XpB = { live: 50, day: null };
    const partial = computeTeamXpRates([pet(['XpA']), pet(['XpB'])], 'sunny');
    expect(partial.planningTeamXpPerHour).toBe(3750);
  });
});
