// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchedSeed } from '../../../features/journalSeeds';
import type { AlertModel } from './types';

const h = vi.hoisted(() => ({
  watched: [] as WatchedSeed[],
  rows: new Map<string, boolean>(),
  weatherKind: 'rain',
  pinSound: null as null | { soundId: string; volume: number; mode: 'once' | 'loop' },
}));

vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock('../../../features/journalSeeds', () => ({ getWatchedSeeds: () => h.watched }));
vi.mock('../../../features/alertHub/settings', () => ({
  getAlertRowSettings: (id: string, soundId: string) => ({ enabled: h.rows.get(id) ?? false, soundId }),
}));
vi.mock('../../../features/alertHub/raise', () => ({ playAlertRowSound: vi.fn() }));
vi.mock('../../../sprite-v2/compat', () => ({ getAnySpriteDataUrl: () => '', isSpritesReady: () => false }));
vi.mock('../../../utils/game/catalogHelpers', () => ({
  getMutationName: (id: string) => (id === 'Ambershine' ? 'Amberlit' : id),
  getPlantSafe: (species: string) => ({ crop: { name: species === 'PurpleDaisy' ? 'Purple Daisy' : species } }),
}));
vi.mock('../../../features/mutations/data/variantBadges', () => ({
  findVariantBadge: (v: string) => (v === 'Wet' ? { color: 'var(--test-wet)' } : undefined),
}));
vi.mock('../../../features/garden/cropMutationAnalytics', () => ({
  resolveWeatherMutationEntry: () => ({ displayName: 'Rain', mutation: 'Wet' }),
}));
vi.mock('../../../store/weatherHub', () => ({ getWeatherSnapshot: () => ({ kind: h.weatherKind }) }));
vi.mock('./itemLook', () => ({ getAlertSpriteUrl: () => null, getItemRarityLook: () => null }));
vi.mock('./ownershipTracker', () => ({
  debugLog: () => { /* silenced */ },
  toCanonicalKey: (kind: string, id: string) => `${kind}:${id}`,
  clearPendingOwnershipConfirmation: () => { /* no pendings here */ },
}));
vi.mock('./purchaseActions', () => ({ handleBuyAll: vi.fn() }));
vi.mock('./stockProcessor', () => ({ markDismissedCycle: vi.fn() }));
vi.mock('../../../store/shopStock', () => ({ getShopStockItemByKey: () => null, onShopStockItemChange: () => () => { /* none */ } }));
vi.mock('./soundConfig', () => ({ getSoundConfig: () => h.pinSound, getCustomSounds: () => ({}), DEFAULT_LOOP_INTERVAL_MS: 3_000 }));
vi.mock('./soundEngine', () => ({
  playSound: vi.fn(async () => { /* no-op */ }),
  playCustomSound: vi.fn(async () => { /* no-op */ }),
  startLoop: vi.fn(), stopLoop: vi.fn(), isLooping: () => false, isBuiltinSound: () => true,
}));
vi.mock('./cardSize', () => ({ getRestockCardSize: () => 1 }));

const seed = (over: Partial<WatchedSeed> = {}): WatchedSeed => ({
  seedSpecies: 'Pumpkin', forSpecies: 'Pumpkin', missing: ['Normal', 'Wet', 'Gold', 'Frozen'], weatherMatch: null, ...over,
});

const model = (over: Partial<AlertModel> = {}): AlertModel => ({
  key: 'seed:Pumpkin', shopType: 'seed', itemId: 'Pumpkin', stockCycleId: 'rid:seed:1', label: 'Pumpkin Seed', quantity: 25, priceCoins: 10, ...over,
});

async function load() {
  vi.resetModules();
  const card = await import('./journalSeedCard');
  card.registerJournalSeedRows();
  return card;
}

beforeEach(() => {
  h.watched = [];
  h.rows = new Map();
  h.pinSound = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('resolveJournalCard (ALR-16.4)', () => {
  it('a watched seed with the row on gets the journal line and its first missing variants as chips', async () => {
    const card = await load();
    h.watched = [seed()];
    h.rows.set(card.JOURNAL_SEED_ROW, true);
    const info = card.resolveJournalCard('Pumpkin', false);
    expect(info?.rowId).toBe(card.JOURNAL_SEED_ROW);
    expect(info?.line).toBe('feature.restockAlert.journalMissing {"count":4}');
    expect(info?.weatherLine).toBeNull();
    expect(info?.chips.map((c) => c.text)).toEqual(['Normal', 'Wet', 'Gold']);
  });

  it('a seed the player owns is not on the watched list, so no card', async () => {
    const card = await load();
    h.watched = [seed({ seedSpecies: 'Carrot', forSpecies: 'Carrot' })];
    h.rows.set(card.JOURNAL_SEED_ROW, true);
    expect(card.resolveJournalCard('Pumpkin', false)).toBeNull();
  });

  it('both rows off → nothing, pinned or not', async () => {
    const card = await load();
    h.watched = [seed({ weatherMatch: 'Wet' })];
    expect(card.resolveJournalCard('Pumpkin', false)).toBeNull();
    expect(card.resolveJournalCard('Pumpkin', true)).toBeNull();
  });

  it('a weather match answers to the weather row, with the weather line and its chip first', async () => {
    const card = await load();
    h.watched = [seed({ weatherMatch: 'Gold' })];
    h.rows.set(card.JOURNAL_SEED_WEATHER_ROW, true);
    const info = card.resolveJournalCard('Pumpkin', false);
    expect(info?.rowId).toBe(card.JOURNAL_SEED_WEATHER_ROW);
    expect(info?.weatherLine).toBe('feature.restockAlert.journalWeatherLine {"weather":"Rain","mutation":"Gold"}');
    expect(info?.chips.map((c) => c.text)).toEqual(['Gold', 'Normal', 'Wet']);
  });

  it('weather row off: a weather match still shows on the main row, line kept', async () => {
    const card = await load();
    h.watched = [seed({ weatherMatch: 'Wet' })];
    h.rows.set(card.JOURNAL_SEED_ROW, true);
    const info = card.resolveJournalCard('Pumpkin', false);
    expect(info?.rowId).toBe(card.JOURNAL_SEED_ROW);
    expect(info?.weatherLine).not.toBeNull();
    expect(info?.chips[0]).toEqual({ text: 'Wet', color: 'var(--test-wet)' });
  });

  it('a non-weather seed with only the weather row on gets no card', async () => {
    const card = await load();
    h.watched = [seed()];
    h.rows.set(card.JOURNAL_SEED_WEATHER_ROW, true);
    expect(card.resolveJournalCard('Pumpkin', false)).toBeNull();
  });

  it('a rare crop names the crop it is for; one missing variant reads singular', async () => {
    const card = await load();
    h.rows.set(card.JOURNAL_SEED_ROW, true);
    h.watched = [seed({ seedSpecies: 'Daisy', forSpecies: 'PurpleDaisy', missing: ['Normal', 'Wet'] }), seed({ missing: ['Ambershine'] })];
    expect(card.resolveJournalCard('Daisy', false)?.line).toBe('feature.restockAlert.journalMissingFor {"count":2,"species":"Purple Daisy"}');
    expect(card.resolveJournalCard('Pumpkin', false)?.line).toBe('feature.restockAlert.journalMissingOne');
    expect(card.resolveJournalCard('Pumpkin', false)?.chips[0]?.text).toBe('Amberlit');
  });

  it('seed entries: the seed shop, or a mixed shop entry tagged Seed', async () => {
    const card = await load();
    expect(card.isSeedEntry('seed', undefined)).toBe(true);
    expect(card.isSeedEntry('rain', 'Seed')).toBe(true);
    expect(card.isSeedEntry('rain', 'Tool')).toBe(false);
    expect(card.isSeedEntry('egg', undefined)).toBe(false);
  });

  it('both rows sit in the shops group, off by default, weather row on a stronger default sound', async () => {
    const card = await load();
    const { getAlertRow } = await import('../../../features/alertHub/registry');
    expect(getAlertRow(card.JOURNAL_SEED_ROW)).toMatchObject({ group: 'shops', defaultSound: 'chime' });
    expect(getAlertRow(card.JOURNAL_SEED_WEATHER_ROW)).toMatchObject({ group: 'shops', defaultSound: 'alert' });
    expect(getAlertRow(card.JOURNAL_SEED_ROW)?.defaultEnabled).toBeUndefined();
  });
});

describe('journal restock card (ALR-16.4)', () => {
  async function loadDom() {
    const card = await load();
    const dom = await import('./alertDom');
    const raise = await import('../../../features/alertHub/raise');
    const engine = await import('./soundEngine');
    return { card, dom, playRow: vi.mocked(raise.playAlertRowSound), playSound: vi.mocked(engine.playSound) };
  }

  const journal = (over: Partial<NonNullable<AlertModel['journal']>> = {}): NonNullable<AlertModel['journal']> => ({
    rowId: 'shops.journalSeed', pinned: false, line: 'Journal: 4 variants missing', weatherLine: null, chips: [{ text: 'Wet' }], ...over,
  });

  it('journal only: journal caption, line and chips; the row sound plays once, no pin sound or mute', async () => {
    const { dom, playRow, playSound } = await loadDom();
    const active = dom.createAlert(model({ journal: journal() }));
    expect(active.captionEl?.textContent).toBe('feature.restockAlert.journalSeedInStock');
    expect(active.journalEl?.textContent).toBe('Journal: 4 variants missing');
    expect(active.root.querySelectorAll('.qpm-alert-card__chip')).toHaveLength(1);
    expect(playRow).toHaveBeenCalledWith('shops.journalSeed');
    expect(playSound).not.toHaveBeenCalled();
    expect(active.muteBtn?.style.display).toBe('none');
    expect(active.root.style.order).toBe('');
  });

  it('pinned and watched: pin title and pin sound, journal line added, row sound silent', async () => {
    const { dom, playRow, playSound } = await loadDom();
    h.pinSound = { soundId: 'bell', volume: 0.5, mode: 'once' };
    const active = dom.createAlert(model({ journal: journal({ pinned: true }) }));
    expect(active.captionEl?.textContent).toBe('feature.restockAlert.pinnedRestocked');
    expect(active.journalEl?.textContent).toBe('Journal: 4 variants missing');
    expect(playSound).toHaveBeenCalledWith('bell', 0.5);
    expect(playRow).not.toHaveBeenCalled();
  });

  it('weather match: weather row sound, weather line, card first in the stack', async () => {
    const { dom, playRow } = await loadDom();
    const active = dom.createAlert(model({ journal: journal({ rowId: 'shops.journalSeedWeather', weatherLine: 'Rain now: Wet unlogged' }) }));
    expect(playRow).toHaveBeenCalledWith('shops.journalSeedWeather');
    expect(active.journalEl?.textContent).toBe('Journal: 4 variants missing\nRain now: Wet unlogged');
    expect(active.root.style.order).toBe('-1');
  });

  it('an update that drops the journal part returns the card to the plain pin look', async () => {
    const { dom } = await loadDom();
    dom.createAlert(model({ journal: journal({ pinned: true, weatherLine: 'w' }) }));
    dom.upsertAlert(model());
    const { activeAlerts } = await import('./alertState');
    const active = activeAlerts.get('seed:Pumpkin');
    expect(active?.model.journal).toBeUndefined();
    expect(active?.journalEl?.style.display).toBe('none');
    expect(active?.root.querySelectorAll('.qpm-alert-card__chip')).toHaveLength(0);
    expect(active?.root.style.order).toBe('');
  });

  it('Dismiss on a journal card is the per-restock dismissal pins use (PD2)', async () => {
    const { dom } = await loadDom();
    const sp = await import('./stockProcessor');
    const active = dom.createAlert(model({ journal: journal() }));
    active.dismissBtn.click();
    expect(vi.mocked(sp.markDismissedCycle)).toHaveBeenCalledWith('seed:Pumpkin', 'rid:seed:1');
  });
});
