import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestockItem } from '../../utils/restock/types';

let mockWeatherShopIds: string[];
let mockCatalogsLoaded: boolean;
let mockEligibleByShop: Map<string, string[]>;

vi.mock('../../store/shopRegistry', () => ({
  getWeatherShopIds: () => mockWeatherShopIds.slice(),
}));

vi.mock('../../catalogs/shopEligibility', () => ({
  areShopCatalogsLoaded: () => mockCatalogsLoaded,
  getShopEligibleItemIds: (shopId: string) => (mockEligibleByShop.get(shopId) ?? []).slice(),
  isItemCatalogLoaded: () => mockCatalogsLoaded,
  getItemCatalogName:    () => null,
  getItemCatalogPricing: () => null,
  getItemCatalogSpriteKey: () => null,
}));

vi.mock('../../catalogs/gameCatalogs', () => ({
  getWeatherDef: () => null,
}));

vi.mock('../../utils/restock/dataService', () => ({
  getItemIdVariants: () => [] as string[],
}));

vi.mock('../../sprite-v2/compat', () => ({
  getAnySpriteDataUrl: () => null,
  getCropSpriteCanvas: () => null,
  getPetSpriteCanvas: () => null,
}));

vi.mock('../../utils/dom/canvasHelpers', () => ({
  canvasToDataUrl: () => null,
}));

vi.mock('../../utils/storage', () => ({
  storage: {
    get: <T,>(_k: string, fallback: T): T => fallback,
    set: () => { /* no-op */ },
  },
}));

vi.mock('../../types/shops', () => ({
  isWeatherShopType: (id: string) => !['seeds', 'eggs', 'tools', 'decor', 'seed', 'egg', 'tool'].includes(id),
}));

vi.mock('./restockWindowDiagnostics', () => ({
  warnFeature: () => { /* no-op */ },
}));

vi.mock('./restockWindowConstants', () => ({
  TRACKED_KEY: 'test.tracked',
  UI_STATE_KEY: 'test.ui',
  ARIEDAM_KEY: 'test.ariedam',
  ARIEDAM_TTL_MS: 60_000,
  isCelestialItem: () => false,
}));

async function loadModule(): Promise<typeof import('./restockWindowMeta')> {
  return await import('./restockWindowMeta');
}

function makeExistingRow(itemId: string, shopType: string): RestockItem {
  return {
    item_id: itemId, shop_type: shopType,
    current_probability: null, appearance_rate: null, predicted_next_ms: null,
    estimated_next_timestamp: null, median_interval_ms: null, last_seen: null,
    average_quantity: null, total_quantity: 0, total_occurrences: 0,
    algorithm_version: null, algorithm_updated_at: null, recent_intervals_ms: null,
    empirical_weight: null, empirical_probability: null, fallback_rate: null,
    baseline_interval_ms: null, ema_interval_ms: null, weather_intervals: null,
    is_dormant: null, current_weather: null, weather_baseline_ms: null,
    weather_samples: null, weather_used: null, weather_rejected_reason: null,
  };
}

beforeEach(() => {
  mockWeatherShopIds = [];
  mockCatalogsLoaded = false;
  mockEligibleByShop = new Map();
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('mergeWeatherShopFallbackRows (T2)', () => {
  it('returns input unchanged when no weather shops are known', async () => {
    const mod = await loadModule();
    const input: RestockItem[] = [];
    expect(mod.mergeWeatherShopFallbackRows(input)).toBe(input);
  });

  it('emits one LOADING placeholder row per weather shop when catalogs are unloaded and shops have no existing rows', async () => {
    mockWeatherShopIds = ['amber', 'dawn'];
    mockCatalogsLoaded = false;
    const mod = await loadModule();

    const result = mod.mergeWeatherShopFallbackRows([]);
    const shopTypes = result.map((r) => r.shop_type).sort();
    expect(shopTypes).toEqual(['amber', 'dawn']);
    for (const row of result) {
      expect(row.item_id).toBe(mod.LOADING_ITEM_ID);
      expect(row.is_dormant).toBeNull();
    }
  });

  it('preserves an existing row for a shop and skips the loading placeholder for THAT shop when catalogs are unloaded', async () => {
    mockWeatherShopIds = ['amber', 'dawn'];
    mockCatalogsLoaded = false;
    const mod = await loadModule();

    const result = mod.mergeWeatherShopFallbackRows([makeExistingRow('AmberEgg', 'amber')]);
    const amberRows = result.filter((r) => r.shop_type === 'amber');
    const dawnRows  = result.filter((r) => r.shop_type === 'dawn');
    expect(amberRows).toHaveLength(1);
    expect(amberRows[0]!.item_id).toBe('AmberEgg');
    expect(dawnRows).toHaveLength(1);
    expect(dawnRows[0]!.item_id).toBe(mod.LOADING_ITEM_ID);
  });

  it('emits catalog-eligible rows for each weather shop when catalogs are loaded (no literal fallback map)', async () => {
    mockWeatherShopIds = ['amber'];
    mockCatalogsLoaded = true;
    mockEligibleByShop.set('amber', ['AmberEgg', 'HungerShard', 'XPShard']);
    const mod = await loadModule();

    const result = mod.mergeWeatherShopFallbackRows([]);
    const amberIds = result.filter((r) => r.shop_type === 'amber').map((r) => r.item_id).sort();
    expect(amberIds).toEqual(['AmberEgg', 'HungerShard', 'XPShard']);
    for (const row of result) {
      expect(row.item_id).not.toBe(mod.LOADING_ITEM_ID);
    }
  });

  it('does NOT emit a LOADING row for a shop that already has rows (catalogs unloaded)', async () => {
    mockWeatherShopIds = ['amber'];
    mockCatalogsLoaded = false;
    const mod = await loadModule();

    const result = mod.mergeWeatherShopFallbackRows([makeExistingRow('AmberEgg', 'amber')]);
    expect(result).toHaveLength(1);
    expect(result[0]!.item_id).toBe('AmberEgg');
  });

  it('does not add duplicate rows when a catalog-eligible id is already present', async () => {
    mockWeatherShopIds = ['amber'];
    mockCatalogsLoaded = true;
    mockEligibleByShop.set('amber', ['AmberEgg', 'HungerShard']);
    const mod = await loadModule();

    const result = mod.mergeWeatherShopFallbackRows([makeExistingRow('AmberEgg', 'amber')]);
    const amberIds = result.filter((r) => r.shop_type === 'amber').map((r) => r.item_id).sort();
    expect(amberIds).toEqual(['AmberEgg', 'HungerShard']);
  });
});
