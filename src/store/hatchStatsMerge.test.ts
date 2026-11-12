import { describe, expect, it } from 'vitest';
import { HATCH_MAX_EVENTS, HATCH_MAX_SEEDED_IDS, mergeHatchStats, normalizeHatchStats } from './hatchStatsMerge';
import type { HatchEvent, HatchStatsState, SpeciesCounts } from './hatchStatsStore';

const counts = (total: number, gold = 0, rainbow = 0): SpeciesCounts => ({ total, normal: total - gold - rainbow, gold, rainbow });

function copy(species: Record<string, SpeciesCounts>, extra: Partial<HatchStatsState> = {}): HatchStatsState {
  const totalHatched = Object.values(species).reduce((sum, c) => sum + c.total, 0);
  return {
    lifetime: { totalHatched, bySpecies: species, byAbility: {} },
    session: { totalHatched: 0, bySpecies: {}, byAbility: {}, start: 1 },
    recentEvents: [],
    seededPetIds: [],
    meta: { version: 1, updatedAt: 10, cleanedAt: 5 },
    ...extra,
  };
}

const event = (timestamp: number, species = 'Turtle'): HatchEvent => ({ species, rarity: 'normal', abilities: [], timestamp });

describe('normalizeHatchStats', () => {
  it('rejects a missing or other-version copy', () => {
    expect(normalizeHatchStats(undefined)).toBeUndefined();
    expect(normalizeHatchStats({ meta: { version: 2 } })).toBeUndefined();
  });

  it('coerces counts and drops malformed events and ids', () => {
    const out = normalizeHatchStats({
      meta: { version: 1, updatedAt: 3 },
      lifetime: { totalHatched: 2, bySpecies: { Turtle: { total: 2, normal: 'x', gold: 2, rainbow: -1 } }, byAbility: { A: 4, B: null } },
      recentEvents: [event(1), { species: 'Bee' }],
      seededPetIds: ['p1', 7],
    });
    expect(out?.lifetime.bySpecies.Turtle).toEqual({ total: 2, normal: 0, gold: 2, rainbow: 0 });
    expect(out?.lifetime.byAbility).toEqual({ A: 4, B: 0 });
    expect(out?.recentEvents).toEqual([event(1)]);
    expect(out?.seededPetIds).toEqual(['p1']);
    expect(out?.meta.cleanedAt).toBeUndefined();
  });
});

describe('mergeHatchStats (PD2 per-field max)', () => {
  it('returns a itself when b adds nothing, and is idempotent', () => {
    const a = copy({ Turtle: counts(5, 1) }, { recentEvents: [event(2)], seededPetIds: ['p1'] });
    const b = copy({ Turtle: counts(3) }, { recentEvents: [event(2)], seededPetIds: ['p1'] });
    expect(mergeHatchStats(a, b)).toBe(a);
    expect(mergeHatchStats(a, a)).toBe(a);
  });

  it('keeps hatches each site saw on different species without over-counting', () => {
    const web = copy({ Turtle: counts(100, 3), Bee: counts(10) });
    const discord = copy({ Turtle: counts(60), Bee: counts(50, 0, 1) });
    const merged = mergeHatchStats(web, discord);
    expect(merged.lifetime.bySpecies).toEqual({ Turtle: counts(100, 3), Bee: { total: 50, normal: 49, gold: 0, rainbow: 1 } });
    expect(merged.lifetime.totalHatched).toBe(150);
    expect(mergeHatchStats(merged, discord)).toBe(merged);
  });

  it('takes the larger ability count and total', () => {
    const a = copy({}, { lifetime: { totalHatched: 9, bySpecies: {}, byAbility: { A: 2 } } });
    const b = copy({}, { lifetime: { totalHatched: 4, bySpecies: {}, byAbility: { A: 5, B: 1 } } });
    const merged = mergeHatchStats(a, b);
    expect(merged.lifetime.byAbility).toEqual({ A: 5, B: 1 });
    expect(merged.lifetime.totalHatched).toBe(9);
  });

  it('unions recent events newest first, capped', () => {
    const a = copy({}, { recentEvents: Array.from({ length: HATCH_MAX_EVENTS }, (_, i) => event(1000 - i)) });
    const b = copy({}, { recentEvents: [event(5000, 'Bee'), event(1000), event(1)] });
    const merged = mergeHatchStats(a, b);
    expect(merged.recentEvents).toHaveLength(HATCH_MAX_EVENTS);
    expect(merged.recentEvents[0]).toEqual(event(5000, 'Bee'));
    expect(merged.recentEvents.filter((e) => e.timestamp === 1000)).toHaveLength(1);
    const olderOnly = copy({}, { recentEvents: [event(1)] });
    expect(mergeHatchStats(a, olderOnly)).toBe(a);
  });

  it('unions seeded ids and keeps the newest when over the cap', () => {
    const a = copy({}, { seededPetIds: Array.from({ length: HATCH_MAX_SEEDED_IDS }, (_, i) => `a${i}`) });
    const b = copy({}, { seededPetIds: ['a0', 'b0'] });
    const merged = mergeHatchStats(a, b);
    expect(merged.seededPetIds).toHaveLength(HATCH_MAX_SEEDED_IDS);
    expect(merged.seededPetIds.at(-1)).toBe('b0');
    expect(merged.seededPetIds).not.toContain('a0');
  });

  it('drops the cleanup stamp when an uncleaned copy contributes, and keeps a\'s session', () => {
    const a = copy({ Turtle: counts(1) });
    const b = copy({ Bee: counts(1) }, { meta: { version: 1, updatedAt: 20 } });
    const merged = mergeHatchStats(a, b);
    expect(merged.meta).toEqual({ version: 1, updatedAt: 20 });
    expect(merged.session).toBe(a.session);
    expect(mergeHatchStats(a, copy({ Bee: counts(1) })).meta.cleanedAt).toBe(5);
  });
});
