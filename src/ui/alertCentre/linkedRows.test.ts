import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
}));
let spritesReady = true;
const atlas = new Set<string>();
vi.mock('../../sprite-v2/compat', () => ({
  isSpritesReady: () => spritesReady,
  getAnySpriteDataUrl: (key: string) => (atlas.has(key) ? `data:${key}` : ''),
}));
let pins = new Set<string>();
vi.mock('../../store/restockTracked', () => ({ loadTrackedSet: () => new Set(pins) }));
let pinLook: { iconUrl: string | null; accent: string | null } = { iconUrl: null, accent: null };
const pinLookCalls: string[][] = [];
vi.mock('../shop/restockAlerts/itemLook', () => ({
  getPinLook: (keys: Iterable<string>) => { pinLookCalls.push([...keys]); return pinLook; },
}));
let popupSettings = { abilities: [] as string[], levelUps: false };
vi.mock('../../features/popupSilencer', () => ({ getPopupSilencerSettings: () => popupSettings }));
const capacityConfig = { enabled: true, warningThreshold: 85 };
vi.mock('../../features/economy/inventoryCapacity', () => ({
  getInventoryCapacityConfig: () => capacityConfig,
  getInventoryCapacityState: () => ({ count: 40, max: 100, level: 'ok' }),
  subscribeToInventoryCapacityConfig: () => () => {},
  updateInventoryCapacityConfig: () => {},
}));
let reminderConfig = { enabled: true, showNotifications: true, highlightPlants: true };
vi.mock('../../features/mutations/reminder', () => ({ getConfig: () => reminderConfig }));
let weather: string | null = null;
vi.mock('../../core/gameState', () => ({ readSync: (key: string) => (key === 'weather' ? weather : null) }));
vi.mock('../../utils/game/catalogHelpers', () => ({
  getWeatherDefSafe: (id: string) => (id === 'Rain' ? { id, name: 'Rain', groupId: 'Hydro', spriteKey: 'sprite/weather/Rain', mutation: 'Wet' } : null),
}));
vi.mock('../panel/tileRegistry', () => ({ getTileDefinition: () => null }));
vi.mock('../pets/popupSilencerWindow', () => ({ openPopupSilencerWindow: () => {} }));
vi.mock('../forecastWidget', () => ({
  closeForecastWidget: () => {},
  isForecastWidgetOpen: () => false,
  onForecastWidgetOpenChange: () => () => {},
  openForecastWidget: () => {},
}));

const restockSize = { get: vi.fn(() => 1.1), preview: vi.fn(), set: vi.fn() };
vi.mock('../shop/restockAlerts/cardSize', () => ({
  PIN_ROW_ID: 'linked.restock',
  getRestockCardSize: () => restockSize.get(),
  previewRestockCardSize: (v: number) => restockSize.preview(v),
  setRestockCardSize: (v: number) => restockSize.set(v),
}));

import { resolveRowAccent, resolveRowIcon, resolveRowSummary, type AlertRowDef } from '../../features/alertHub/registry';
import { getLinkedRows, type LinkedRow } from './linkedRows';

function row(id: string): LinkedRow {
  const found = getLinkedRows().find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}
// The centre resolves linked rows through the same resolvers as hub rows.
const asDef = (r: LinkedRow): AlertRowDef => ({ ...r, defaultSound: 'none' });

const UI_KEYS = ['sprite/ui/SeedsRestocked', 'sprite/ui/PetIconColor', 'sprite/ui/InventoryBag', 'sprite/ui/WeatherStationIcon', 'sprite/ui/SunnyIcon', 'sprite/weather/Rain'];

beforeEach(() => {
  spritesReady = true;
  atlas.clear();
  for (const key of UI_KEYS) atlas.add(key);
  pins = new Set();
  pinLook = { iconUrl: null, accent: null };
  pinLookCalls.length = 0;
  popupSettings = { abilities: [], levelUps: false };
  reminderConfig = { enabled: true, showNotifications: true, highlightPlants: true };
  weather = null;
});

describe('linked rows declare icon, summary and accent (ALR-17 PD1)', () => {
  it('every row has all three', () => {
    for (const r of getLinkedRows()) {
      expect(resolveRowIcon(asDef(r)), r.id).toMatch(/^data:/);
      expect(resolveRowSummary(asDef(r)), r.id).toBeTruthy();
      expect(resolveRowAccent(asDef(r)), r.id).toMatch(/^var\(--qpm-/);
    }
  });

  it('restock: first pin look, else the restock UI sprite and the accent token', () => {
    const r = asDef(row('linked.restock'));
    expect(resolveRowIcon(r)).toBe('data:sprite/ui/SeedsRestocked');
    expect(resolveRowAccent(r)).toBe('var(--qpm-accent)');
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.restockSummaryNone');

    pins = new Set(['seed:Carrot', 'weather:Rain']);
    pinLook = { iconUrl: 'data:carrot', accent: 'var(--qpm-rarity-common)' };
    expect(resolveRowIcon(r)).toBe('data:carrot');
    expect(resolveRowAccent(r)).toBe('var(--qpm-rarity-common)');
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.restockSummary {"count":2}');
    expect(pinLookCalls.at(-1)).toEqual(['seed:Carrot', 'weather:Rain']);
  });

  it('restock: one card size for all restock and weather cards; only restock has one (ALR-17.11b)', () => {
    const size = row('linked.restock').cardSize!;
    expect(size.get()).toBe(1.1);
    size.preview(0.9);
    size.commit(1.3);
    expect(restockSize.preview).toHaveBeenCalledWith(0.9);
    expect(restockSize.set).toHaveBeenCalledWith(1.3);
    expect(getLinkedRows().filter((r) => r.cardSize).map((r) => r.id)).toEqual(['linked.restock']);
  });

  it('popups: counts hidden abilities and level-ups', () => {
    const r = asDef(row('linked.popups'));
    expect(resolveRowIcon(r)).toBe('data:sprite/ui/PetIconColor');
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.popupsSummaryNone');
    popupSettings = { abilities: [], levelUps: true };
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.popupsSummaryLevelUpsOnly');
    popupSettings = { abilities: ['a', 'b'], levelUps: false };
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.popupsSummary {"count":2}');
    popupSettings = { abilities: ['a'], levelUps: true };
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.popupsSummaryLevelUps {"count":1}');
  });

  it('bag full: threshold of max, warning token', () => {
    const r = asDef(row('linked.bagFull'));
    expect(resolveRowIcon(r)).toBe('data:sprite/ui/InventoryBag');
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.bagFullSummary {"threshold":85,"max":100}');
    expect(resolveRowAccent(r)).toBe('var(--qpm-warning)');
  });

  it('mutation reminder: summary follows its config', () => {
    const r = asDef(row('linked.mutationReminder'));
    expect(resolveRowIcon(r)).toBe('data:sprite/ui/WeatherStationIcon');
    expect(resolveRowAccent(r)).toBe('var(--qpm-positive)');
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.reminderBoth');
    reminderConfig = { enabled: true, showNotifications: true, highlightPlants: false };
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.reminderPopups');
    reminderConfig = { enabled: true, showNotifications: false, highlightPlants: true };
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.reminderHighlights');
    reminderConfig = { enabled: false, showNotifications: true, highlightPlants: true };
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.reminderOff');
  });

  it('forecast: current weather sprite and name, else SunnyIcon and clear skies', () => {
    const r = asDef(row('linked.forecast'));
    expect(resolveRowIcon(r)).toBe('data:sprite/ui/SunnyIcon');
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.forecastSummaryClear');
    weather = 'Rain';
    expect(resolveRowIcon(r)).toBe('data:sprite/weather/Rain');
    expect(resolveRowSummary(r)).toBe('feature.alertCentre.linked.forecastSummary {"weather":"Rain"}');
    expect(resolveRowAccent(r)).toBe('var(--qpm-info)');
  });

  it('no icon before the sprite system is ready; pins are not resolved then', () => {
    spritesReady = false;
    pins = new Set(['seed:Carrot']);
    for (const r of getLinkedRows()) expect(resolveRowIcon(asDef(r)), r.id).toBeNull();
    expect(pinLookCalls).toHaveLength(0);
  });
});
