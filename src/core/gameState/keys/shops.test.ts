import { describe, expect, it } from 'vitest';
import type { AtomSourceSpec, SourceSpec } from '../types';
import { SHOP_KEYS } from './shops';
import { GAME_STATE_KEYS, validateKeyTable } from './index';

const stageRung = (): AtomSourceSpec<unknown> =>
  (SHOP_KEYS.dayNightStage.sources as readonly SourceSpec<unknown>[])[0] as AtomSourceSpec<unknown>;

describe('dayNightStage key', () => {
  it('is merged into the key table and passes the ladder policy', () => {
    expect(GAME_STATE_KEYS.dayNightStage).toBe(SHOP_KEYS.dayNightStage);
    expect(SHOP_KEYS.dayNightStage.policy).toBe('client');
    expect(validateKeyTable()).toEqual([]);
  });
  it('binds the exact stage atom label, read-only', () => {
    const rung = stageRung();
    expect(rung.kind).toBe('atom');
    expect(rung.label.test('dayNightStageAtom')).toBe(true);
    expect(rung.label.test('dayNightPhaseOverrideAtom')).toBe(false);
    expect(rung.label.test('myDayNightStageAtom')).toBe(false);
    expect(rung.writable).not.toBe(true);
  });
  it('accepts any stage name, including one the game adds later', () => {
    const accepts = (v: unknown): boolean => stageRung().structure?.(v) ?? true;
    for (const s of ['day', 'sunset', 'midnight', 'sunrise', 'eclipse']) expect(accepts(s)).toBe(true);
    for (const v of [null, undefined, '', 3, {}]) expect(accepts(v)).toBe(false);
  });
});
