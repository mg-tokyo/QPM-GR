import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GardenSnapshot } from '../bridge';
import type { EggEntry } from './schedule';

let snapshotListener: ((s: GardenSnapshot) => void) | null = null;
let current: GardenSnapshot = null;
vi.mock('../bridge', () => ({
  getGardenSnapshot: () => current,
  onGardenSnapshot: (cb: (s: GardenSnapshot) => void) => { snapshotListener = cb; return () => { snapshotListener = null; }; },
}));
vi.mock('../../../sprite-v2/compat', () => ({ isSpritesReady: () => true, getAnySpriteDataUrl: (k: string | null) => (k ? `data:${k}` : '') }));
vi.mock('../../../utils/game/catalogHelpers', () => ({
  getEggSafe: (id: string) => ({ name: `${id} Egg`, sprite: `sprite/pet/${id}Egg` }),
}));
let serverNow: number | null = null;
vi.mock('../../../store/serverClock', () => ({ getServerNowMs: () => serverNow }));
let leadMinutes = 0;
vi.mock('./settings', () => ({ getEggReadyLeadMinutes: () => leadMinutes }));

interface Card { rowId: string; title: string; body?: string; figure?: unknown; sprites?: unknown; iconUrl?: string; closed: boolean; patches: unknown[] }
const cards: Card[] = [];
const open = new Map<string, Card>();
const rows = new Map<string, { id: string; group: string; summary?: () => string; settingsAction?: () => void }>();
let rowOn = true;
vi.mock('../../alertHub', () => ({
  registerAlertRow: (def: { id: string; group: string }) => { rows.set(def.id, def); },
  isAlertCardOpen: (key: string) => open.has(key),
  raiseAlert: (rowId: string, p: Omit<Card, 'rowId' | 'closed' | 'patches'> & { cardKey: string }) => {
    if (!rowOn) return null;
    let card = open.get(p.cardKey);
    if (card) card.patches.push({ body: p.body, figure: p.figure });
    else {
      card = { rowId, ...p, closed: false, patches: [] };
      cards.push(card);
      open.set(p.cardKey, card);
    }
    const c = card;
    return {
      update: (patch: unknown) => { c.patches.push(patch); },
      close: () => { c.closed = true; open.delete(p.cardKey); },
    };
  },
}));

const { startEggReadyAlarm, stopEggReadyAlarm, getEggReadyAlarmState, EGG_READY_ROW } = await import('./alarm');

let batchListener: ((b: EggEntry[]) => void) | null = null;
const subscribeBatches = (cb: (b: EggEntry[]) => void): (() => void) => { batchListener = cb; return () => { batchListener = null; }; };

const egg = (tile: number, eggId = 'Common'): EggEntry => ({ key: `g:${tile}|100`, tileKey: `g:${tile}`, eggId, plantedAt: 100, maturedAt: 200 });
const garden = (...eggs: EggEntry[]): GardenSnapshot => ({
  tileObjects: Object.fromEntries(eggs.map((e) => [e.tileKey.slice(2), { objectType: 'egg', eggId: e.eggId, plantedAt: e.plantedAt, maturedAt: e.maturedAt }])),
}) as unknown as GardenSnapshot;

describe('egg ready alarm (ALR-11.2)', () => {
  beforeEach(() => {
    stopEggReadyAlarm();
    cards.length = 0;
    open.clear();
    rows.clear();
    rowOn = true;
    current = null;
    serverNow = null;
    leadMinutes = 0;
    startEggReadyAlarm(subscribeBatches);
  });

  it('registers the garden row with a settings window', () => {
    expect(rows.get(EGG_READY_ROW)).toMatchObject({ group: 'garden' });
    expect(typeof rows.get(EGG_READY_ROW)?.settingsAction).toBe('function');
  });

  it('row summary follows the lead time (ALR-11.3)', () => {
    const summary = rows.get(EGG_READY_ROW)?.summary;
    expect(summary?.()).toBe('One card, counted down as you hatch');
    leadMinutes = 3;
    expect(summary?.()).toBe('3 min before an egg is ready');
  });

  it('eggs still incubating (lead time) → countdown to the last one; once ready → count', () => {
    serverNow = 1_000_000;
    const early = (tile: number, maturedAt: number): EggEntry => ({ ...egg(tile), maturedAt });
    const before = Date.now();
    batchListener?.([early(1, 1_030_000), early(2, 1_060_000)]);
    const figure = cards[0]?.figure as { countdownTo: number; label: string };
    expect(figure.label).toBe('Ready in');
    expect(figure.countdownTo - before).toBeGreaterThanOrEqual(60_000);
    expect(figure.countdownTo - Date.now()).toBeLessThanOrEqual(60_000);
    serverNow = 1_070_000;
    snapshotListener?.(garden(early(2, 1_060_000)));
    expect(cards[0]?.patches.at(-1)).toMatchObject({ figure: { value: '1', label: 'Eggs' } });
  });

  it('one batch → one card with names, count figure and per-kind sprites', () => {
    batchListener?.([egg(1), egg(2), egg(3, 'Rare')]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      rowId: EGG_READY_ROW,
      title: 'Eggs ready to hatch',
      body: 'Common Egg ×2 · Rare Egg',
      figure: { value: '3', label: 'Eggs' },
      sprites: [{ url: 'data:sprite/pet/CommonEgg', count: 2 }, { url: 'data:sprite/pet/RareEgg' }],
      iconUrl: 'data:sprite/pet/CommonEgg',
    });
  });

  it('a second batch while the card is open adds to the same card', () => {
    batchListener?.([egg(1)]);
    batchListener?.([egg(2)]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.patches.at(-1)).toMatchObject({ body: 'Common Egg ×2', figure: { value: '2', label: 'Eggs' } });
  });

  it('a hatched egg leaves the count; the last one hatched closes the card', () => {
    batchListener?.([egg(1), egg(2)]);
    snapshotListener?.(garden(egg(2)));
    expect(cards[0]?.patches.at(-1)).toMatchObject({ body: 'Common Egg', figure: { value: '1', label: 'Eggs' } });
    expect(cards[0]?.closed).toBe(false);
    snapshotListener?.(garden());
    expect(cards[0]?.closed).toBe(true);
    expect(getEggReadyAlarmState()).toMatchObject({ onCard: [], closedEmpty: 1 });
  });

  it('a null garden is a feed gap, not a hatch; an unchanged garden patches nothing', () => {
    batchListener?.([egg(1)]);
    snapshotListener?.(null);
    snapshotListener?.(garden(egg(1)));
    expect(cards[0]?.patches).toEqual([]);
    expect(cards[0]?.closed).toBe(false);
  });

  it('after the player closes the card, the next batch starts a fresh card', () => {
    batchListener?.([egg(1), egg(2)]);
    open.clear();
    batchListener?.([egg(3)]);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ body: 'Common Egg', figure: { value: '1', label: 'Eggs' } });
  });

  it('row off → nothing raised or tracked', () => {
    rowOn = false;
    batchListener?.([egg(1)]);
    expect(cards).toEqual([]);
    expect(getEggReadyAlarmState().onCard).toEqual([]);
  });

  it('stop unsubscribes and closes the open card; start twice subscribes once', () => {
    batchListener?.([egg(1)]);
    stopEggReadyAlarm();
    stopEggReadyAlarm();
    expect(cards[0]?.closed).toBe(true);
    expect(batchListener).toBeNull();
    expect(snapshotListener).toBeNull();
    startEggReadyAlarm(subscribeBatches);
    startEggReadyAlarm(subscribeBatches);
    expect(getEggReadyAlarmState().started).toBe(true);
  });
});
