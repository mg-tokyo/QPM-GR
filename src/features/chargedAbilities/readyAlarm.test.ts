import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadyEdgeEvent } from './readyEdge';

let edgeListener: ((e: ReadyEdgeEvent) => void) | null = null;
vi.mock('./readyEdge', () => ({
  onReadyEdge: (cb: (e: ReadyEdgeEvent) => void) => { edgeListener = cb; return () => { edgeListener = null; }; },
}));

let rebuilt: (() => void) | null = null;
const ability = (abilityId: string, abilityName: string, accentColor: string) => ({ abilityId, abilityName, accentColor, requiredSpecies: ['Wolf'] });
let projections = [ability('DawnCapture', 'Dawn Capture', '#f0a'), ability('Thundercharger', 'Thundercharger', 'linear-gradient(red, blue)')];
vi.mock('./abilities', () => ({
  getAllAbilityProjections: () => projections,
  getAbilityProjection: (id: string) => projections.find((p) => p.abilityId === id) ?? null,
  onAbilityProjectionsRebuilt: (cb: () => void) => { rebuilt = cb; return () => { rebuilt = null; }; },
}));

const pets = [
  { slotId: 's1', petId: 'p1', species: 'Wolf', name: 'Rex', mutations: ['Gold'], chargedAbilityId: 'DawnCapture' },
  { slotId: 's2', petId: 'p2', species: 'Wolf', name: 'Ash', mutations: [], chargedAbilityId: 'DawnCapture' },
];
vi.mock('../../store/pets', () => ({ getActivePetInfos: () => pets }));
vi.mock('../../sprite-v2/compat', () => ({ isSpritesReady: () => true, getPetSpriteDataUrlWithMutations: (s: string) => `data:${s}` }));
vi.mock('../pets/hungerAlarm', () => ({
  petIcon: (p: { species: string; mutations: string[] }) => `data:${p.species}+${p.mutations.join(',')}`,
  petName: (p: { name: string }) => p.name,
}));

const store = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: { get: (k: string, d: unknown) => (store.has(k) ? store.get(k) : d), set: (k: string, v: unknown) => { store.set(k, v); } },
}));

interface Raised { rowId: string; title: string; cardKey?: string; accent?: string; chips?: unknown; figure?: unknown; iconUrl?: string; closed: boolean; opts?: unknown }
const raised: Raised[] = [];
const rows = new Map<string, { id: string; labelParams?: Record<string, string | number>; accent?: unknown; summary?: () => string }>();
let rowOn = true;
vi.mock('../alertHub', () => ({
  registerAlertRow: (def: { id: string }) => { rows.set(def.id, def); },
  raiseAlert: (rowId: string, p: Omit<Raised, 'rowId' | 'closed'>, opts?: unknown) => {
    if (!rowOn) return null;
    const entry: Raised = { rowId, ...p, closed: false, opts };
    raised.push(entry);
    return { update: () => undefined, close: () => { entry.closed = true; } };
  },
}));

const { startChargedReadyAlarm, stopChargedReadyAlarm, getChargedReadyAlarmDiagnostics, chargedReadyRowId, previewChargedReadyCard } = await import('./readyAlarm');
const settings = await import('./readySettings');

const fire = (petSlotId: string, abilityId = 'DawnCapture', gardenTargetCount = 3): ReadyEdgeEvent =>
  ({ kind: 'fire', key: `${petSlotId}:${abilityId}`, petSlotId, abilityId, gardenTargetCount });
const stop = (petSlotId: string, reason: 'used' | 'removed', abilityId = 'DawnCapture'): ReadyEdgeEvent =>
  ({ kind: 'stop', key: `${petSlotId}:${abilityId}`, petSlotId, abilityId, gardenTargetCount: 0, reason });

describe('charged ability ready alarm (ALR-10.2)', () => {
  beforeEach(() => {
    stopChargedReadyAlarm();
    raised.length = 0;
    rows.clear();
    store.clear();
    rowOn = true;
    projections = [ability('DawnCapture', 'Dawn Capture', '#f0a'), ability('Thundercharger', 'Thundercharger', 'linear-gradient(red, blue)')];
    startChargedReadyAlarm();
  });

  it('registers one pets row per catalog charged ability, label from the catalog name, gradient accent dropped', () => {
    expect([...rows.keys()]).toEqual([chargedReadyRowId('DawnCapture'), chargedReadyRowId('Thundercharger')]);
    expect(rows.get('pets.chargedReady.DawnCapture')).toMatchObject({ group: 'pets', labelParams: { ability: 'Dawn Capture' }, accent: '#f0a' });
    expect(rows.get('pets.chargedReady.Thundercharger')).not.toHaveProperty('accent');
  });

  it('re-registers rows when the projections are rebuilt from a new catalog', () => {
    projections = [...projections, ability('AmberCapture', 'Amber Capture', '#fa0')];
    rebuilt?.();
    expect(rows.has('pets.chargedReady.AmberCapture')).toBe(true);
  });

  it('two pets → two cards with pet sprite, ability chip, target figure and accent', () => {
    edgeListener?.(fire('s1'));
    edgeListener?.(fire('s2', 'DawnCapture', 5));
    expect(raised.map((r) => [r.rowId, r.title, r.cardKey])).toEqual([
      ['pets.chargedReady.DawnCapture', 'Rex is charged', 'chargedReady:s1:DawnCapture'],
      ['pets.chargedReady.DawnCapture', 'Ash is charged', 'chargedReady:s2:DawnCapture'],
    ]);
    expect(raised[0]).toMatchObject({
      iconUrl: 'data:Wolf+Gold',
      accent: '#f0a',
      chips: [{ text: 'Dawn Capture', color: '#f0a' }],
      figure: { value: '3', label: 'Targets' },
    });
    expect(getChargedReadyAlarmDiagnostics()).toMatchObject({ started: true, openCards: 2, fired: 2 });
  });

  it('using the ability closes that pet\'s card only; the pet leaving closes its card', () => {
    edgeListener?.(fire('s1'));
    edgeListener?.(fire('s2'));
    edgeListener?.(stop('s1', 'used'));
    expect(raised.map((r) => r.closed)).toEqual([true, false]);
    edgeListener?.(stop('s2', 'removed'));
    expect(raised.map((r) => r.closed)).toEqual([true, true]);
    expect(getChargedReadyAlarmDiagnostics()).toMatchObject({ openCards: 0, closed: 2 });
  });

  it('row off → nothing raised and nothing tracked; a later stop is a no-op', () => {
    rowOn = false;
    const closedBefore = getChargedReadyAlarmDiagnostics().closed;
    edgeListener?.(fire('s1'));
    edgeListener?.(stop('s1', 'used'));
    expect(raised).toEqual([]);
    expect(getChargedReadyAlarmDiagnostics()).toMatchObject({ openCards: 0, closed: closedBefore });
  });

  it('stop is idempotent and closes open cards; start again re-subscribes once', () => {
    edgeListener?.(fire('s1'));
    stopChargedReadyAlarm();
    stopChargedReadyAlarm();
    expect(raised[0]?.closed).toBe(true);
    expect(edgeListener).toBeNull();
    startChargedReadyAlarm();
    startChargedReadyAlarm();
    expect(edgeListener).not.toBeNull();
    expect(getChargedReadyAlarmDiagnostics().started).toBe(true);
  });
});

describe('repeat until used (ALR-10.3)', () => {
  beforeEach(() => {
    stopChargedReadyAlarm();
    raised.length = 0;
    rows.clear();
    store.clear();
    rowOn = true;
    startChargedReadyAlarm();
  });

  it('off by default: one chime, no repeat, the plain summary', () => {
    edgeListener?.(fire('s1'));
    expect(raised[0]?.opts).toEqual({});
    expect(rows.get('pets.chargedReady.DawnCapture')?.summary?.()).toBe('Once per recharge, when your garden has a target');
  });

  it('on for one ability: its cards repeat at the shared interval, other abilities do not', () => {
    settings.setChargedReadyRepeat('DawnCapture', true);
    expect(settings.setChargedReadyIntervalSec(5)).toBe(true);
    edgeListener?.(fire('s1'));
    edgeListener?.(fire('s3', 'Thundercharger'));
    expect(raised.map((r) => r.opts)).toEqual([{ repeat: { intervalMs: 5000 } }, {}]);
    expect(rows.get('pets.chargedReady.DawnCapture')?.summary?.()).toBe('Repeats every 5 s until used');
    expect(previewChargedReadyCard('DawnCapture')).not.toBeNull();
    expect(raised[2]?.opts).toEqual({ repeat: { intervalMs: 5000 } });
  });

  it('interval outside 2–60 s or fractional is refused; a bad stored value reads as 3 s', () => {
    expect(settings.setChargedReadyIntervalSec(1)).toBe(false);
    expect(settings.setChargedReadyIntervalSec(61)).toBe(false);
    expect(settings.setChargedReadyIntervalSec(2.5)).toBe(false);
    store.set(settings.CHARGED_READY_ALERT_KEY, { repeat: ['DawnCapture', 7], intervalSec: 'x' });
    expect(settings.getChargedReadyIntervalSec()).toBe(3);
    expect(settings.isChargedReadyRepeatOn('DawnCapture')).toBe(true);
  });

  it('turning repeat off keeps the other abilities and the interval', () => {
    settings.setChargedReadyRepeat('DawnCapture', true);
    settings.setChargedReadyRepeat('Thundercharger', true);
    settings.setChargedReadyIntervalSec(10);
    settings.setChargedReadyRepeat('DawnCapture', false);
    expect(store.get(settings.CHARGED_READY_ALERT_KEY)).toEqual({ repeat: ['Thundercharger'], intervalSec: 10 });
  });
});
