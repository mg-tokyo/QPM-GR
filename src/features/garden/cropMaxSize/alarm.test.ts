import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SizeEdge } from './core';

const store = new Map<string, unknown>();
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown) => (store.has(k) ? store.get(k) : d),
    set: (k: string, v: unknown) => { store.set(k, v); },
  },
}));
vi.mock('../../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getCropSpriteDataUrlWithMutations: (s: string, m: string[]) => `data:${s}+${m.join(',')}`,
}));
vi.mock('../../../utils/game/catalogHelpers', () => ({ getPlantSafe: (s: string) => ({ crop: { name: `${s} Crop` } }) }));

interface Card { rowId: string; title: string; body?: string; chips?: unknown; figure?: unknown; sprites?: unknown; iconUrl?: string; level?: string; closed: boolean; patches: unknown[] }
const cards: Card[] = [];
const open = new Map<string, Card>();
const rows = new Map<string, { id: string; group: string; summary?: () => string }>();
let rowOn = true;
vi.mock('../../alertHub', () => ({
  registerAlertRow: (def: { id: string; group: string }) => { rows.set(def.id, def); },
  isAlertCardOpen: (key: string) => open.has(key),
  raiseAlert: (rowId: string, p: Omit<Card, 'rowId' | 'closed' | 'patches'> & { cardKey: string }) => {
    if (!rowOn) return null;
    const existing = open.get(p.cardKey);
    if (existing) { existing.patches.push({ body: p.body, chips: p.chips, figure: p.figure }); return { update: () => undefined, close: () => undefined }; }
    const card: Card = { rowId, ...p, closed: false, patches: [] };
    cards.push(card);
    open.set(p.cardKey, card);
    return { update: () => undefined, close: () => { card.closed = true; open.delete(p.cardKey); } };
  },
}));

const alarm = await import('./alarm');
const { startCropMaxSizeAlarm, stopCropMaxSizeAlarm, readCropMaxSizeAlertSettings, writeCropMaxSizeAlertSettings, getCropMaxSizeAlarmState, CROP_MAX_SIZE_ROW } = alarm;

let batchListener: ((b: SizeEdge[]) => void) | null = null;
const feed = (cb: (b: SizeEdge[]) => void): (() => void) => { batchListener = cb; return () => { batchListener = null; }; };
const edge = (tile: number, species = 'Carrot', mutations: string[] = []): SizeEdge => ({ tileKey: `g:${tile}`, slotId: 0, species, mutations, size: 100 });

describe('crop max-size alarm (ALR-15.2)', () => {
  beforeEach(() => {
    stopCropMaxSizeAlarm();
    cards.length = 0;
    open.clear();
    rows.clear();
    store.clear();
    rowOn = true;
    startCropMaxSizeAlarm(feed);
  });

  it('settings default to unlogged-journal mode with no picked species, and round-trip', () => {
    expect(readCropMaxSizeAlertSettings()).toEqual({ unloggedJournal: true, species: [] });
    writeCropMaxSizeAlertSettings({ unloggedJournal: false, species: ['Tulip'] });
    expect(readCropMaxSizeAlertSettings()).toEqual({ unloggedJournal: false, species: ['Tulip'] });
    store.set('qpm.cropMaxSizeAlert.v1', { unloggedJournal: 'yes', species: ['Beet', 3, ''] });
    expect(readCropMaxSizeAlertSettings()).toEqual({ unloggedJournal: true, species: ['Beet'] });
  });

  it('registers the garden row with a summary that follows the settings', () => {
    const row = rows.get(CROP_MAX_SIZE_ROW);
    expect(row).toMatchObject({ group: 'garden' });
    expect(row?.summary?.()).toBe('Species without Max Weight in your journal');
    writeCropMaxSizeAlertSettings({ unloggedJournal: true, species: ['Tulip', 'Beet'] });
    expect(row?.summary?.()).toBe('Unlogged Max Weight + 2 picked species');
  });

  it('one batch → one card: crop sprites with mutations, a chip per species, count figure', () => {
    batchListener?.([edge(1, 'Carrot', ['Gold']), edge(2), edge(3, 'Tulip')]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      rowId: CROP_MAX_SIZE_ROW,
      title: 'Crops reached max size',
      body: 'Carrot Crop ×2 · Tulip Crop',
      level: 'success',
      chips: [{ text: 'Carrot Crop ×2', iconUrl: 'data:Carrot+Gold' }, { text: 'Tulip Crop', iconUrl: 'data:Tulip+' }],
      figure: { value: '3', label: 'Crops' },
      sprites: [{ url: 'data:Carrot+Gold', count: 2 }, { url: 'data:Tulip+' }],
      iconUrl: 'data:Carrot+Gold',
    });
  });

  it('PD2: a batch while the card is open updates its count and names', () => {
    batchListener?.([edge(1)]);
    batchListener?.([edge(2, 'Tulip')]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.patches.at(-1)).toMatchObject({ body: 'Carrot Crop · Tulip Crop', figure: { value: '2', label: 'Crops' } });
  });

  it('after the player closes the card, the next batch starts afresh', () => {
    batchListener?.([edge(1), edge(2)]);
    open.clear();
    batchListener?.([edge(3, 'Beet')]);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ body: 'Beet Crop', figure: { value: '1', label: 'Crops' } });
  });

  it('row off → nothing raised or kept', () => {
    rowOn = false;
    batchListener?.([edge(1)]);
    expect(cards).toEqual([]);
    expect(getCropMaxSizeAlarmState().onCard).toEqual([]);
  });

  it('stop unsubscribes; start twice subscribes once', () => {
    stopCropMaxSizeAlarm();
    stopCropMaxSizeAlarm();
    expect(batchListener).toBeNull();
    startCropMaxSizeAlarm(feed);
    startCropMaxSizeAlarm(feed);
    expect(getCropMaxSizeAlarmState().started).toBe(true);
  });
});
