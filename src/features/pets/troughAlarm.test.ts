import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));
vi.mock('../../catalogs/shopEligibility', () => ({ getItemCatalogSpriteKey: (id: string) => `sprite/decor/${id}` }));
vi.mock('../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getAnySpriteDataUrl: (key: string | null) => (key ? `data:${key}` : ''),
}));

const subs = new Map<string, (v: unknown) => void>();
let initial: Record<string, unknown> = {};
vi.mock('../../core/gameState', () => ({
  readSync: (key: string) => initial[key] ?? null,
  subscribe: (key: string, cb: (v: unknown) => void) => { subs.set(key, cb); return () => { subs.delete(key); }; },
}));

interface RaisedCard { row: string; title: string; body?: string; cardKey?: string; iconUrl?: string; accent?: string; meter?: { pct: number; color: string } }
interface RowDef { id: string; icon?: () => string | null; summary?: () => string; accent?: string }
const raised: RaisedCard[] = [];
const rows: string[] = [];
const defs: RowDef[] = [];
vi.mock('../alertHub', () => ({
  raiseAlert: (row: string, p: Omit<RaisedCard, 'row'>) => { raised.push({ row, ...p }); return null; },
  registerAlertRow: (def: RowDef) => { rows.push(def.id); defs.push(def); },
}));

import {
  getTroughAlarmDiagnostics,
  onTroughChange,
  setTroughLowAt,
  startTroughAlarm,
  stepTroughAlarm,
  stopTroughAlarm,
  type TroughAlarmState,
  type TroughSnapshot,
} from './troughAlarm';

const crops = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
const setItems = (n: number): void => { subs.get('feedingTroughItems')?.(crops(n)); };
const setCapacity = (c: number | null): void => { subs.get('feedingTroughCapacity')?.(c); };

describe('stepTroughAlarm', () => {
  it('baselines, fires on the drop to lowAt, stays quiet while low, re-arms on refill', () => {
    const s: TroughAlarmState = { baselined: false, low: false };
    expect(stepTroughAlarm(s, 1, 9, 1)).toBe(false);
    expect(stepTroughAlarm(s, 0, 9, 1)).toBe(false);
    expect(stepTroughAlarm(s, 5, 9, 1)).toBe(false);
    expect(stepTroughAlarm(s, 2, 9, 1)).toBe(false);
    expect(stepTroughAlarm(s, 1, 9, 1)).toBe(true);
    expect(stepTroughAlarm(s, 0, 9, 1)).toBe(false);
    expect(stepTroughAlarm(s, 3, 9, 1)).toBe(false);
    expect(stepTroughAlarm(s, 0, 9, 1)).toBe(true);
  });

  it('no trough re-baselines', () => {
    const s: TroughAlarmState = { baselined: false, low: false };
    stepTroughAlarm(s, 5, 9, 1);
    expect(stepTroughAlarm(s, 0, null, 1)).toBe(false);
    expect(stepTroughAlarm(s, 0, 9, 1)).toBe(false);
  });
});

describe('trough alarm feature', () => {
  beforeEach(() => {
    stopTroughAlarm();
    mem.clear();
    raised.length = 0;
    rows.length = 0;
    defs.length = 0;
    initial = {};
  });

  it('baselines from the initial read and raises one keyed card with the trough sprite and a fill meter', () => {
    initial = { feedingTroughItems: crops(4), feedingTroughCapacity: 9 };
    startTroughAlarm();
    startTroughAlarm();
    expect(rows).toEqual(['pets.troughLow']);
    setItems(2);
    expect(raised).toEqual([]);
    setItems(1);
    setItems(0);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      row: 'pets.troughLow',
      title: 'feature.troughAlarm.title',
      body: 'feature.troughAlarm.body:{"count":1,"capacity":9}',
      cardKey: 'trough:low',
      iconUrl: 'data:sprite/decor/FeedingTrough',
      accent: 'var(--qpm-warning)',
    });
    expect(raised[0]?.meter?.pct).toBeCloseTo(100 / 9);
  });

  it('row declares the trough sprite, a lowAt summary and the warning token', () => {
    startTroughAlarm();
    setTroughLowAt(2);
    const def = defs[0];
    expect([def?.icon?.(), def?.summary?.(), def?.accent]).toEqual([
      'data:sprite/decor/FeedingTrough',
      'feature.troughAlarm.summary:{"lowAt":2}',
      'var(--qpm-warning)',
    ]);
  });

  it('feeds snapshots to listeners and reports no trough as not low', () => {
    const seen: TroughSnapshot[] = [];
    const off = onTroughChange((s) => { seen.push(s); });
    initial = { feedingTroughItems: crops(1), feedingTroughCapacity: 9 };
    startTroughAlarm();
    expect(seen.at(-1)).toEqual({ count: 1, capacity: 9, lowAt: 1, low: true });
    setCapacity(null);
    expect(seen.at(-1)?.capacity).toBeNull();
    expect(seen.at(-1)?.low).toBe(false);
    off();
    const n = seen.length;
    setCapacity(9);
    expect(seen).toHaveLength(n);
  });

  it('a lowAt change does not fire; the next drop does', () => {
    initial = { feedingTroughItems: crops(3), feedingTroughCapacity: 9 };
    startTroughAlarm();
    setTroughLowAt(3);
    expect(raised).toEqual([]);
    expect(getTroughAlarmDiagnostics()).toMatchObject({ lowAt: 3, low: true });
    setItems(5);
    setItems(3);
    expect(raised).toHaveLength(1);
    setTroughLowAt(-1);
    expect(getTroughAlarmDiagnostics().lowAt).toBe(3);
  });

  it('stops cleanly', () => {
    initial = { feedingTroughItems: crops(3), feedingTroughCapacity: 9 };
    startTroughAlarm();
    stopTroughAlarm();
    expect(subs.size).toBe(0);
    expect(getTroughAlarmDiagnostics()).toMatchObject({ started: false, capacity: null });
  });
});
