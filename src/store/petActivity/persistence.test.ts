import { describe, expect, it } from 'vitest';
import { MAX_AGE_MS, MAX_EVENTS, mergePetActivity } from './persistence';
import type { PetActivityEvent } from './types';

const NOW = 1_800_000_000_000;

function ev(id: string, ts: number, updatedAt = ts, action = 'a'): PetActivityEvent {
  return {
    id, ts, source: 'server', kind: 'ability', action, family: 'f',
    pet: { id: 'p', species: 'Bee', name: null, mutations: [], targetScale: 1, xp: 0, abilities: [], str: null, maxStr: null, level: null },
    targets: [], values: {}, updatedAt,
  };
}

describe('mergePetActivity', () => {
  it('unions by id, sorted by ts', () => {
    const a = [ev('x', NOW - 30), ev('y', NOW - 10)];
    const b = [ev('z', NOW - 20), ev('y', NOW - 10)];
    expect(mergePetActivity(a, b, NOW).map((e) => e.id)).toEqual(['x', 'z', 'y']);
  });

  it('returns a itself when b adds nothing', () => {
    const a = [ev('x', NOW - 30), ev('y', NOW - 10, NOW - 5)];
    expect(mergePetActivity(a, [ev('y', NOW - 10, NOW - 9)], NOW)).toBe(a);
    expect(mergePetActivity(a, [], NOW)).toBe(a);
  });

  it('the newer updatedAt wins for one id; a tie keeps a', () => {
    const a = [ev('y', NOW - 10, NOW - 10, 'old')];
    const merged = mergePetActivity(a, [ev('y', NOW - 10, NOW - 1, 'stacked')], NOW);
    expect(merged.map((e) => e.action)).toEqual(['stacked']);
    expect(mergePetActivity(a, [ev('y', NOW - 10, NOW - 10, 'other')], NOW)).toBe(a);
  });

  it('is idempotent', () => {
    const a = [ev('x', NOW - 30)];
    const b = [ev('z', NOW - 20)];
    const once = mergePetActivity(a, b, NOW);
    expect(mergePetActivity(once, b, NOW)).toBe(once);
  });

  it('ignores events past the age limit and keeps the newest MAX_EVENTS', () => {
    const a = [ev('x', NOW - 30)];
    expect(mergePetActivity(a, [ev('old', NOW - MAX_AGE_MS - 1)], NOW)).toBe(a);
    const many = Array.from({ length: MAX_EVENTS }, (_, i) => ev(`m${i}`, NOW - MAX_EVENTS + i));
    const merged = mergePetActivity([ev('oldest', NOW - MAX_EVENTS - 1)], many, NOW);
    expect(merged).toHaveLength(MAX_EVENTS);
    expect(merged[0]?.id).toBe('m0');
  });
});
