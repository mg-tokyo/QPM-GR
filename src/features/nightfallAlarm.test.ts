import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));
vi.mock('../ui/core/panelHelpers', () => ({ formatRestockCountdown: (ms: number) => `${Math.round(ms / 1000)}s` }));
vi.mock('../store/serverClock', () => ({ getServerNowMs: () => null }));
// Same cycle shape as forecastWidget/model.test.ts: nightfall at 03:40, 07:40, 11:40 … UTC.
vi.mock('../catalogs/logic/dayCycleCatalog', () => ({
  getDayCycle: () => ({
    stages: [{ id: 'day', minutes: 210 }, { id: 'sunset', minutes: 10 }, { id: 'midnight', minutes: 10 }, { id: 'sunrise', minutes: 10 }],
    stageOrder: ['sunrise', 'day', 'sunset', 'midnight'],
  }),
  onDayCycleChange: () => () => {},
}));

interface Raised { row: string; title: string; body?: string; cardKey?: string }
const raised: Raised[] = [];
const rows: string[] = [];
const settingsActions: unknown[] = [];
vi.mock('./alertHub', () => ({
  raiseAlert: (row: string, p: Omit<Raised, 'row'>) => { raised.push({ row, ...p }); return null; },
  registerAlertRow: (def: { id: string; settingsAction?: unknown }) => { rows.push(def.id); settingsActions.push(def.settingsAction); },
}));

type Mod = typeof import('./nightfallAlarm');
let mod: Mod;
const utc = (hms: string): number => Date.parse(`2026-11-13T${hms}Z`);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mem.clear();
  raised.length = 0;
  rows.length = 0;
  settingsActions.length = 0;
  mod = await import('./nightfallAlarm');
});

afterEach(() => {
  mod.stopNightfallAlarm();
  vi.useRealTimers();
});

describe('nightfall alarm', () => {
  it('fires once at nightfall minus the lead, then arms the next night', () => {
    vi.setSystemTime(utc('11:30:00'));
    mod.startNightfallAlarm();
    expect(mod.getNightfallAlarmState()).toMatchObject({ armed: true, leadMinutes: 1, nextNightMs: utc('11:40:00'), nextFireAt: utc('11:39:00') });
    vi.advanceTimersByTime(9 * 60_000 - 1000);
    expect(raised).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(raised).toEqual([{
      row: 'garden.nightfall',
      title: 'feature.nightfallAlarm.title',
      body: 'feature.nightfallAlarm.bodyIn:{"time":"60s"}',
      cardKey: `nightfall:${utc('11:40:00')}`,
    }]);
    vi.advanceTimersByTime(10 * 60_000);
    expect(raised).toHaveLength(1);
    expect(mod.getNightfallAlarmState()).toMatchObject({ fired: 1, lastFiredNightMs: utc('11:40:00'), nextNightMs: utc('15:40:00') });
  });

  it('registers its centre row with a settings action', () => {
    vi.setSystemTime(utc('11:30:00'));
    mod.startNightfallAlarm();
    expect(rows).toEqual(['garden.nightfall']);
    expect(typeof settingsActions[0]).toBe('function');
  });

  it('lead 0 fires at nightfall with the "now" text', () => {
    vi.setSystemTime(utc('11:30:00'));
    mod.startNightfallAlarm();
    expect(mod.setNightfallLeadMinutes(0)).toBe(true);
    vi.advanceTimersByTime(10 * 60_000 + 100);
    expect(raised.map((r) => r.body)).toEqual(['feature.nightfallAlarm.bodyNow']);
  });

  it('a start just after the fire time still fires for that night', () => {
    vi.setSystemTime(utc('11:39:30'));
    mod.startNightfallAlarm();
    vi.advanceTimersByTime(100);
    expect(raised.map((r) => r.cardKey)).toEqual([`nightfall:${utc('11:40:00')}`]);
  });

  it('a wake more than a minute late skips that night and re-arms', () => {
    vi.setSystemTime(utc('11:30:00'));
    mod.startNightfallAlarm();
    vi.setSystemTime(utc('11:42:00')); // machine slept: the clock jumps, the timer has not run
    vi.advanceTimersByTime(9 * 60_000 + 100);
    expect(raised).toHaveLength(0);
    expect(mod.getNightfallAlarmState()).toMatchObject({ skippedLate: 1, nextNightMs: utc('15:40:00') });
  });

  it('start is idempotent, stop disarms, invalid leads are refused', () => {
    vi.setSystemTime(utc('11:30:00'));
    mod.startNightfallAlarm();
    mod.startNightfallAlarm();
    expect(rows).toEqual(['garden.nightfall']);
    expect(mod.setNightfallLeadMinutes(-1)).toBe(false);
    expect(mod.setNightfallLeadMinutes(1.5)).toBe(false);
    expect(mod.setNightfallLeadMinutes(181)).toBe(false);
    mod.stopNightfallAlarm();
    expect(mod.getNightfallAlarmState()).toMatchObject({ started: false, armed: false, nextFireAt: null });
    vi.advanceTimersByTime(60 * 60_000);
    expect(raised).toHaveLength(0);
  });
});
