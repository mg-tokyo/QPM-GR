import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../catalogs/logic/gamePanelsCatalog', () => ({ getGamePanelIds: () => null, getStoragePanelIds: () => null }));
vi.mock('../../../store/shopRegistry', () => ({ getWeatherShopIds: () => [], getShopWeatherKind: () => null }));
vi.mock('../../../store/weatherHub', () => ({ getWeatherSnapshot: () => ({ kind: 'sunny' }) }));
vi.mock('../../../ui/components', () => ({ showToast: vi.fn() }));
vi.mock('../gameModal', () => ({ toggleBag: vi.fn(), toggleGameModal: vi.fn() }));

const { buildGameActions, resolveWeatherShopPanel } = await import('./gamePanels');

const PANELS = ['seedShop', 'rainShop', 'thunderShop', 'journal', 'dailyQuests', 'weatherStation',
  'petHutch', 'decorShed', 'seedSilo', 'toolShack', 'feedingTrough'];
const SHOP_WEATHER: Record<string, string> = { rain: 'rain', thunder: 'thunderstorm', snow: 'snow' };
const weatherOf = (id: string): string | null => SHOP_WEATHER[id] ?? null;
const SHOPS = Object.keys(SHOP_WEATHER);

describe('resolveWeatherShopPanel (game rule, deriveAvailableActions.ts:677-680)', () => {
  it('maps the running weather to its shop panel', () => {
    expect(resolveWeatherShopPanel('rain', SHOPS, weatherOf, PANELS)).toBe('rainShop');
    expect(resolveWeatherShopPanel('thunderstorm', SHOPS, weatherOf, PANELS)).toBe('thunderShop');
  });
  it('opens nothing without a weather', () => {
    expect(resolveWeatherShopPanel('sunny', SHOPS, weatherOf, PANELS)).toBeNull();
    expect(resolveWeatherShopPanel('unknown', SHOPS, weatherOf, PANELS)).toBeNull();
  });
  it('opens nothing for a weather with no shop', () => {
    expect(resolveWeatherShopPanel('amber', SHOPS, weatherOf, PANELS)).toBeNull();
  });
  it('opens nothing when the game has no panel for the shop', () => {
    expect(resolveWeatherShopPanel('snow', SHOPS, weatherOf, PANELS)).toBeNull();
  });
  it('accepts a shop id that already is the panel id', () => {
    expect(resolveWeatherShopPanel('rain', ['rainShop'], () => 'rain', PANELS)).toBe('rainShop');
  });
});

describe('buildGameActions (PD2: rows only for ids in the game list)', () => {
  const ids = (panels: string[] | null, storages: string[] | null): string[] =>
    buildGameActions(panels, storages).map(a => a.id);

  it('lists the bag only while the panel list is unread', () => {
    expect(ids(null, null)).toEqual(['bag']);
  });
  it('lists storages, named panels and the weather shop from the game list', () => {
    expect(ids(PANELS, ['petHutch', 'decorShed', 'seedSilo', 'toolShack', 'feedingTrough'])).toEqual([
      'bag', 'panel:petHutch', 'panel:decorShed', 'panel:seedSilo', 'panel:toolShack', 'panel:feedingTrough',
      'panel:journal', 'panel:dailyQuests', 'panel:weatherStation', 'weatherShop',
    ]);
  });
  it('hides a named panel or storage the game list lacks', () => {
    const panels = PANELS.filter(id => id !== 'dailyQuests' && id !== 'toolShack');
    const got = ids(panels, ['petHutch', 'toolShack']);
    expect(got).not.toContain('panel:dailyQuests');
    expect(got).not.toContain('panel:toolShack');
    expect(got).toContain('panel:petHutch');
  });
  it('carries the panel id and section', () => {
    const silo = buildGameActions(PANELS, ['seedSilo']).find(a => a.id === 'panel:seedSilo');
    expect(silo).toMatchObject({ section: 'gamePanels', panelId: 'seedSilo' });
    expect(buildGameActions(PANELS, []).find(a => a.id === 'weatherShop')?.section).toBe('shops');
  });
});
