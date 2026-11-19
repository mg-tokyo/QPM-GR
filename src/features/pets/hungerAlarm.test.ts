import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivePetInfo } from '../../store/pets';

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
let troughFed: string[] | null = [];
vi.mock('../../core/gameState', () => ({ readSync: () => troughFed }));
vi.mock('../../utils/game/catalogHelpers', () => ({ getPetSafe: (s: string) => ({ name: `${s} (catalog)` }) }));
vi.mock('../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getPetSpriteDataUrlWithMutations: (species: string, mutations: string[]) => `data:${species}|${mutations.join(',')}`,
}));

let petsCb: ((infos: ActivePetInfo[]) => void) | null = null;
vi.mock('../../store/pets', () => ({
  onActivePetInfos: (cb: (infos: ActivePetInfo[]) => void) => { petsCb = cb; return () => { petsCb = null; }; },
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
  getHungerAlarmDiagnostics,
  setHungerAlarmDefault,
  setPetHungerThreshold,
  startHungerAlarm,
  stepHungerAlarm,
  stopHungerAlarm,
  type HungerAlarmState,
} from './hungerAlarm';

function pet(petId: string, hungerPct: number | null, name: string | null = null): ActivePetInfo {
  return {
    slotIndex: 0, slotId: `s-${petId}`, petId, hungerPct, hungerValue: null, hungerMax: null, hungerRaw: null,
    name, species: 'Turtle', targetScale: null, mutations: [], abilities: [], xp: null, level: null, levelRaw: null,
    strength: null, chargedAbilityId: null, position: null, updatedAt: 0, raw: null,
  };
}
const push = (...infos: ActivePetInfo[]): void => { petsCb?.(infos); };

describe('stepHungerAlarm', () => {
  const r = (petId: string, pct: number, threshold = 25): { petId: string; pct: number; threshold: number } => ({ petId, pct, threshold });

  it('baseline fires nothing; a crossing fires once; staying below does not repeat; feeding re-arms', () => {
    const s: HungerAlarmState = { baselined: false, below: new Map() };
    expect(stepHungerAlarm(s, [r('a', 10)])).toEqual([]);
    expect(stepHungerAlarm(s, [r('a', 9)])).toEqual([]);
    expect(stepHungerAlarm(s, [r('a', 80)])).toEqual([]);
    expect(stepHungerAlarm(s, [r('a', 30)])).toEqual([]);
    expect(stepHungerAlarm(s, [r('a', 24)])).toEqual(['a']);
    expect(stepHungerAlarm(s, [r('a', 20)])).toEqual([]);
    expect(stepHungerAlarm(s, [r('a', 100)])).toEqual([]);
    expect(stepHungerAlarm(s, [r('a', 24.5)])).toEqual(['a']);
  });

  it('a pet swapped in below its threshold fires; an empty team re-baselines', () => {
    const s: HungerAlarmState = { baselined: false, below: new Map() };
    stepHungerAlarm(s, [r('a', 90)]);
    expect(stepHungerAlarm(s, [r('a', 90), r('b', 5)])).toEqual(['b']);
    expect(stepHungerAlarm(s, [])).toEqual([]);
    expect(stepHungerAlarm(s, [r('a', 5), r('b', 5)])).toEqual([]);
  });

  it('uses each reading threshold', () => {
    const s: HungerAlarmState = { baselined: false, below: new Map() };
    stepHungerAlarm(s, [r('a', 60, 50), r('b', 60)]);
    expect(stepHungerAlarm(s, [r('a', 45, 50), r('b', 45)])).toEqual(['a']);
  });
});

describe('hunger alarm feature', () => {
  beforeEach(() => {
    stopHungerAlarm();
    mem.clear();
    raised.length = 0;
    rows.length = 0;
    defs.length = 0;
    troughFed = [];
  });

  it('registers its hub row and raises one keyed card per crossing, named by pet then catalog', () => {
    startHungerAlarm();
    startHungerAlarm();
    expect(rows).toEqual(['pets.hunger']);
    push(pet('a', 50, 'Shelly'), pet('b', 50));
    push(pet('a', 24.6, 'Shelly'), pet('b', 20));
    push(pet('a', 15, 'Shelly'), pet('b', 15));
    expect(raised[0]?.body).toBe('feature.hungerAlarm.body:{"pct":24,"threshold":25}');
    expect(raised.map((x) => x.cardKey)).toEqual(['hunger:a', 'hunger:b']);
    expect(raised[0]?.title).toContain('"name":"Shelly"');
    expect(raised[1]?.title).toContain('"name":"Turtle (catalog)"');
    expect(getHungerAlarmDiagnostics().raised).toBe(2);
  });

  it('carries the exact pet sprite (species + mutations) and a floating-card hunger bar', () => {
    startHungerAlarm();
    const gold = { ...pet('a', 80), mutations: ['Gold', 'Frozen'] };
    push(gold);
    push({ ...gold, hungerPct: 20 });
    expect(raised[0]?.iconUrl).toBe('data:Turtle|Gold,Frozen');
    expect(raised[0]?.meter).toEqual({ pct: 20, color: 'var(--qpm-hunger-low)' });
    expect(raised[0]?.accent).toBe('var(--qpm-hunger-low)');
  });

  it('accent follows the meter band (a 40% threshold fires in the mid band)', () => {
    startHungerAlarm();
    setHungerAlarmDefault(40);
    push(pet('a', 80));
    push(pet('a', 35));
    expect(raised[0]?.accent).toBe('var(--qpm-hunger-mid)');
  });

  it('row declares the first active pet sprite, a threshold summary and the hunger token', () => {
    startHungerAlarm();
    const def = defs[0];
    expect(def?.icon?.()).toBeNull();
    push({ ...pet('a', 80), mutations: ['Rainbow'] }, pet('b', 80));
    expect(def?.icon?.()).toBe('data:Turtle|Rainbow');
    setHungerAlarmDefault(30);
    expect(def?.summary?.()).toBe('feature.hungerAlarm.summary:{"pct":30}');
    expect(def?.accent).toBe('var(--qpm-hunger-low)');
  });

  it('skips a pet the trough will feed, without repeating later', () => {
    startHungerAlarm();
    push(pet('a', 50));
    troughFed = ['a'];
    push(pet('a', 20));
    push(pet('a', 10));
    expect(raised).toEqual([]);
    expect(getHungerAlarmDiagnostics().troughSkipped).toBe(1);
  });

  it('per-pet override beats the default; changing a threshold does not fire', () => {
    startHungerAlarm();
    push(pet('a', 60), pet('b', 60));
    setPetHungerThreshold('a', 70);
    setHungerAlarmDefault(65);
    expect(raised).toEqual([]);
    push(pet('a', 59), pet('b', 59));
    expect(raised).toEqual([]);
    push(pet('a', 80), pet('b', 80));
    push(pet('a', 68), pet('b', 68));
    expect(raised.map((x) => x.cardKey)).toEqual(['hunger:a']);
    setPetHungerThreshold('a', null);
    expect(getHungerAlarmDiagnostics().settings).toEqual({ defaultPct: 65, perPet: {} });
  });

  it('ignores pets with unknown hunger and stops cleanly', () => {
    startHungerAlarm();
    push(pet('a', null));
    push(pet('a', null));
    expect(getHungerAlarmDiagnostics().pets).toEqual([]);
    stopHungerAlarm();
    expect(petsCb).toBeNull();
    expect(getHungerAlarmDiagnostics().started).toBe(false);
  });
});
