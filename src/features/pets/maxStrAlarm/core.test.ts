import { describe, expect, it } from 'vitest';
import { stepMaxStr, type MaxStrPetState, type MaxStrReading } from './core';

const r = (petId: string, strength: number, minutes: number | null, maxStr = 100): MaxStrReading => ({ petId, strength, maxStr, minutes });
const fresh = (): Map<string, MaxStrPetState> => new Map();

describe('max STR pre-alarm step (ALR-14.2)', () => {
  it('fires once when the ETA crosses into the lead, not again while it stays', () => {
    const s = fresh();
    expect(stepMaxStr(s, [r('a', 98, 30)], 10)).toEqual([]);
    expect(stepMaxStr(s, [r('a', 99, 9)], 10)).toEqual([{ kind: 'fire', petId: 'a' }]);
    expect(stepMaxStr(s, [r('a', 99, 5)], 10)).toEqual([]);
  });

  it('does not re-fire when the ETA leaves the lead and comes back during the same stay', () => {
    const s = fresh();
    stepMaxStr(s, [r('a', 99, 8)], 10);
    expect(stepMaxStr(s, [r('a', 99, 14)], 10)).toEqual([]);
    expect(stepMaxStr(s, [r('a', 99, 6)], 10)).toEqual([]);
  });

  it('PD1: a pet first seen inside the lead fires; one first seen at max stays silent', () => {
    const s = fresh();
    expect(stepMaxStr(s, [r('a', 99, 3), r('b', 100, null)], 10)).toEqual([{ kind: 'fire', petId: 'a' }]);
    expect(s.get('b')).toEqual({ fired: false, atMax: true });
  });

  it('reaching max emits one max edge; staying at max emits nothing', () => {
    const s = fresh();
    stepMaxStr(s, [r('a', 99, 2)], 10);
    expect(stepMaxStr(s, [r('a', 100, null)], 10)).toEqual([{ kind: 'max', petId: 'a' }]);
    expect(stepMaxStr(s, [r('a', 100, null)], 10)).toEqual([]);
  });

  it('a pet that jumps to max without the pre-alarm (potion) still gets its max edge', () => {
    const s = fresh();
    stepMaxStr(s, [r('a', 90, 600)], 10);
    expect(stepMaxStr(s, [r('a', 100, null)], 10)).toEqual([{ kind: 'max', petId: 'a' }]);
  });

  it('a pet leaving emits left and re-arms when it returns', () => {
    const s = fresh();
    stepMaxStr(s, [r('a', 99, 4), r('b', 90, 600)], 10);
    expect(stepMaxStr(s, [r('b', 90, 600)], 10)).toEqual([{ kind: 'left', petId: 'a' }]);
    expect(stepMaxStr(s, [r('a', 99, 4), r('b', 90, 600)], 10)).toEqual([{ kind: 'fire', petId: 'a' }]);
  });

  it('an empty team is a feed gap: state kept, no edges', () => {
    const s = fresh();
    stepMaxStr(s, [r('a', 99, 4)], 10);
    expect(stepMaxStr(s, [], 10)).toEqual([]);
    expect(stepMaxStr(s, [r('a', 99, 3)], 10)).toEqual([]);
  });

  it('an unknown ETA never fires', () => {
    const s = fresh();
    expect(stepMaxStr(s, [r('a', 99, null)], 10)).toEqual([]);
  });
});
