import { describe, expect, it } from 'vitest';
import type { AtomSourceSpec, IdentityContext, SourceSpec, StateTreeSourceSpec } from '../types';
import type { QuinoaStateSnapshot } from '../../../types/gameAtoms';
import { SHOP_KEYS } from './shops';
import { GAME_STATE_KEYS, validateKeyTable } from './index';

const ID: IdentityContext = { playerId: null, myIdx: null };
const rungs = (key: 'weatherForecast' | 'weatherWindow'): readonly SourceSpec<unknown>[] =>
  SHOP_KEYS[key].sources as readonly SourceSpec<unknown>[];
const selectWith = (key: 'weatherForecast' | 'weatherWindow', data: Record<string, unknown> | null): unknown => {
  const rung = rungs(key).find((s): s is StateTreeSourceSpec<unknown> => s.kind === 'stateTree')!;
  const snap: QuinoaStateSnapshot = { scope: 'Room', data: {}, child: data === null ? null : { scope: 'Quinoa', data } };
  return rung.select(snap, ID);
};
const lunar = { groupId: 'Lunar', weatherId: null, startsAtMs: 1000, endsAtMs: 2000 };
const rain = { groupId: 'Hydro', weatherId: 'Rain', startsAtMs: 3000, endsAtMs: 4000 };

describe('weather forecast keys', () => {
  it('are merged, authoritative, state tree first', () => {
    expect(GAME_STATE_KEYS.weatherForecast).toBe(SHOP_KEYS.weatherForecast);
    expect(GAME_STATE_KEYS.weatherWindow).toBe(SHOP_KEYS.weatherWindow);
    for (const k of ['weatherForecast', 'weatherWindow'] as const) {
      expect(SHOP_KEYS[k].policy).toBe('authoritative');
      expect(rungs(k)[0]!.kind).toBe('stateTree');
    }
  });
  it('forecast keeps order and lunar nulls, drops malformed entries', () => {
    const list = [lunar, rain];
    expect(selectWith('weatherForecast', { weatherForecast: list })).toBe(list);
    expect(selectWith('weatherForecast', { weatherForecast: [lunar, { groupId: 'X' }, rain, null] })).toEqual([lunar, rain]);
    expect(selectWith('weatherForecast', { weatherForecast: [] })).toEqual([]);
  });
  it('forecast is unavailable without the field or the data', () => {
    expect(selectWith('weatherForecast', {})).toBeUndefined();
    expect(selectWith('weatherForecast', { weatherForecast: {} })).toBeUndefined();
    expect(selectWith('weatherForecast', null)).toBeUndefined();
  });
  it('window: null when clear, projected record, unavailable when malformed', () => {
    expect(selectWith('weatherWindow', { weatherWindow: null })).toBeNull();
    expect(selectWith('weatherWindow', { weatherWindow: { startsAtMs: 1, endsAtMs: 2, extra: 3 } })).toEqual({ startsAtMs: 1, endsAtMs: 2 });
    expect(selectWith('weatherWindow', { weatherWindow: { startsAtMs: 1 } })).toBeUndefined();
    expect(selectWith('weatherWindow', {})).toBeUndefined();
  });
  it('window atom rung binds the exact label with the same projection', () => {
    const atom = rungs('weatherWindow').find((s): s is AtomSourceSpec<unknown> => s.kind === 'atom')!;
    expect(atom.label.test('weatherWindowAtom')).toBe(true);
    expect(atom.label.test('weatherScrimOverridesAtom')).toBe(false);
    expect(atom.writable).not.toBe(true);
    expect(atom.project!(null)).toBeNull();
    expect(atom.project!({ startsAtMs: 1, endsAtMs: 2 })).toEqual({ startsAtMs: 1, endsAtMs: 2 });
    expect(atom.project!('Rain')).toBeUndefined();
  });
});

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
