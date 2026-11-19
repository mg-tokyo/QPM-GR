import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Pet { petId: string; species: string; name: string; mutations: string[]; strength: number; xp: number; targetScale: number }
let petListener: ((infos: Pet[]) => void) | null = null;
vi.mock('../../../store/pets', () => ({
  onActivePetInfos: (cb: (infos: Pet[]) => void) => { petListener = cb; return () => { petListener = null; }; },
}));
vi.mock('../../../store/weatherHub', () => ({ getWeatherSnapshot: () => ({ kind: 'sunny' }) }));
// 60 XP per minute: minutes to max = xp needed / 60.
vi.mock('../../../store/xpEta', () => ({
  computeTeamXpRates: () => ({ planningTeamXpPerHour: 3600 }),
  minutesToMaxStr: (p: { xp: number; strength: number; maxStr: number; xpPerLevel: number }, rate: number) =>
    p.strength >= p.maxStr ? null : ((p.maxStr - p.strength) * p.xpPerLevel - (p.xp % p.xpPerLevel)) / rate * 60,
}));
vi.mock('../../../store/xpTracker', () => ({ calculateMaxStrength: () => 100, getSpeciesXpPerLevel: () => 600 }));
vi.mock('../hungerAlarm', () => ({
  petIcon: (p: Pet) => `data:${p.species}+${p.mutations.join(',')}`,
  petName: (p: Pet) => p.name,
}));
const history: Array<{ feature: string; title?: string; level: string }> = [];
vi.mock('../../../core/notifications', () => ({ notify: (e: { feature: string; title?: string; level: string }) => { history.push(e); } }));

interface Card { rowId: string; title: string; cardKey: string; iconUrl?: string; meter?: unknown; figure?: unknown; body?: string; closed: boolean; patches: Array<{ body?: string; figure?: unknown }> }
const cards: Card[] = [];
const open = new Map<string, Card>();
let rowOn = true;
const rows = new Map<string, { summary?: () => string; settingsAction?: () => void }>();
vi.mock('../../alertHub', () => ({
  registerAlertRow: (def: { id: string; summary?: () => string; settingsAction?: () => void }) => { rows.set(def.id, def); },
  getAlertRowSettings: () => ({ enabled: rowOn, soundId: 'chime' }),
  isAlertCardOpen: (key: string) => open.has(key),
  raiseAlert: (rowId: string, p: Omit<Card, 'rowId' | 'closed' | 'patches'>) => {
    if (!rowOn) return null;
    const card: Card = { rowId, ...p, closed: false, patches: [] };
    cards.push(card);
    open.set(p.cardKey, card);
    return {
      update: (patch: { body?: string; figure?: unknown }) => { card.patches.push(patch); },
      close: () => { card.closed = true; open.delete(p.cardKey); },
    };
  },
}));

let storedLead = 10;
vi.mock('./settings', () => ({
  getMaxStrLeadMinutes: () => storedLead,
  writeMaxStrLeadMinutes: (m: number) => {
    if (!Number.isInteger(m) || m < 1) return false;
    storedLead = m;
    return true;
  },
  MAX_STR_MIN_LEAD_MINUTES: 1,
  MAX_STR_MAX_LEAD_MINUTES: 1440,
}));

const { startMaxStrAlarm, stopMaxStrAlarm, getMaxStrAlarmState, setMaxStrLeadMinutes, MAX_STR_ROW } = await import('./index');

const pet = (petId: string, strength: number, xp: number): Pet =>
  ({ petId, species: 'Bat', name: `Pet ${petId}`, mutations: ['Gold'], strength, xp, targetScale: 2 });

describe('max STR alarm wiring (ALR-14.2)', () => {
  beforeEach(() => {
    stopMaxStrAlarm();
    setMaxStrLeadMinutes(10);
    cards.length = 0;
    open.clear();
    history.length = 0;
    rowOn = true;
    startMaxStrAlarm();
  });

  it('fires a card with pet sprite, STR meter and countdown when the ETA enters the lead', () => {
    petListener?.([pet('a', 99, 300)]); // 300 XP left → 5 min
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      rowId: MAX_STR_ROW,
      title: 'Pet a nears max STR 100',
      cardKey: 'maxStr:a',
      iconUrl: 'data:Bat+Gold',
      body: 'STR 99 of 100',
      meter: { pct: 99 },
      figure: { label: 'Max STR in' },
    });
  });

  it('updates the open card in place as XP arrives, without a second card', () => {
    petListener?.([pet('a', 99, 300)]);
    petListener?.([pet('a', 99, 360)]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.patches.at(-1)).toMatchObject({ body: 'STR 99 of 100' });
  });

  it('at max: the card closes and one History entry is written', () => {
    petListener?.([pet('a', 99, 300)]);
    petListener?.([pet('a', 100, 600)]);
    petListener?.([pet('a', 100, 610)]);
    expect(cards[0]?.closed).toBe(true);
    expect(history).toEqual([expect.objectContaining({ feature: MAX_STR_ROW, title: 'Pet a reached max STR 100', level: 'success' })]);
  });

  it('a pet leaving closes its card; a pet first seen at max is silent', () => {
    petListener?.([pet('a', 99, 300), pet('b', 100, 0)]);
    petListener?.([pet('b', 100, 0)]);
    expect(cards.map((c) => [c.cardKey, c.closed])).toEqual([['maxStr:a', true]]);
    expect(history).toEqual([]);
  });

  it('row off: no card and no History entry', () => {
    rowOn = false;
    petListener?.([pet('a', 99, 300)]);
    petListener?.([pet('a', 100, 600)]);
    expect(cards).toEqual([]);
    expect(history).toEqual([]);
  });

  it('raising the lead through the setter fires a pet already on the team', () => {
    petListener?.([pet('a', 98, 0)]); // 1200 XP left → 20 min
    expect(cards).toEqual([]);
    const firedBefore = getMaxStrAlarmState().counts.fired;
    expect(setMaxStrLeadMinutes(30)).toBe(true);
    expect(cards).toHaveLength(1);
    expect(getMaxStrAlarmState()).toMatchObject({ leadMinutes: 30, counts: { fired: firedBefore + 1 } });
  });

  it('the lead comes from the stored setting; a refused value changes nothing (ALR-14.3)', () => {
    storedLead = 30;
    petListener?.([pet('a', 98, 0)]); // 20 min
    expect(cards).toHaveLength(1);
    expect(setMaxStrLeadMinutes(0)).toBe(false);
    expect(getMaxStrAlarmState().leadMinutes).toBe(30);
    expect(rows.get(MAX_STR_ROW)?.summary?.()).toBe('30 min before an active pet reaches max STR');
    expect(typeof rows.get(MAX_STR_ROW)?.settingsAction).toBe('function');
  });

  it('stop closes open cards and unsubscribes; start twice subscribes once', () => {
    petListener?.([pet('a', 99, 300)]);
    stopMaxStrAlarm();
    stopMaxStrAlarm();
    expect(cards[0]?.closed).toBe(true);
    expect(petListener).toBeNull();
    startMaxStrAlarm();
    startMaxStrAlarm();
    expect(getMaxStrAlarmState().started).toBe(true);
  });
});
