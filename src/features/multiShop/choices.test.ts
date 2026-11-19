import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  shopIds: null as string[] | null,
  pick: null as string[] | null,
  modal: null as string | null,
  cache: new Map<string, { config: Record<string, unknown> }>(),
  ensureCalls: [] as string[][],
  ensureResult: null as null | ((names: readonly string[]) => unknown),
  setPick: vi.fn(),
}));

vi.mock('../../catalogs/logic/gamePanelsCatalog', () => ({ getShopPanelIds: () => h.shopIds, onGamePanelsChange: () => () => {} }));
vi.mock('../../core/gameState', () => ({
  subscribe: () => () => {}, atomObjectFor: () => null, readGameAtom: () => ({ ok: false }), readSync: () => null,
}));
vi.mock('../../store/shopRegistry', () => ({ getShopWeatherKind: () => null }));
// Through gate.ts; its real module pulls utils/dom/dom.ts, which reads `document` at import.
vi.mock('../../utils/game/weatherDetection', () => ({ classifyWeatherFromLabel: () => 'sunny' }));
vi.mock('../multiStorage/session', () => ({ SIDEBAR_GAP_PX: 8 }));
vi.mock('../multiStorage/gameHooks', () => ({ petSidebarRightEdge: () => 0 }));
vi.mock('./panels', () => ({ currentModal: () => h.modal }));
vi.mock('./shopChrome', () => ({
  SHOP_FIT: { minWidthPx: 260, minHeightPx: 320, minHeightFraction: 0, unplacedAboveShare: 0, shortenAtBottom: true },
  shopTitle: (name: string) => name,
}));
vi.mock('./settings', () => ({
  getShopPick: () => h.pick, setShopPick: h.setPick, getSavedShopLayout: () => ({}), onMultiShopSettingsChange: () => () => {},
}));
vi.mock('./quietBuild', () => ({
  getCachedShopBuilds: () => h.cache,
  ensureShopConfigs: (names: readonly string[]) => {
    h.ensureCalls.push([...names]);
    return h.ensureResult ? h.ensureResult(names) : { ok: true, builds: new Map(), skipped: {}, peeked: [...names] };
  },
}));

import type { GateDeps } from './gate';
import { ensureShopChoiceConfigs, openableShopNames, shopChoicesFrom, toggleShopChoice } from './choices';

const SHOPS = ['seedShop', 'eggShop', 'rainShop', 'spookyShop'];
const SPOOKY_OPEN = { label: 'spookyShopIsOpenAtom' };
const builds = new Map([
  ['seedShop', { config: { modalName: 'seedShop', shopType: 'seed' } }],
  ['rainShop', { config: { modalName: 'rainShop', shopType: 'rain' } }],
  ['spookyShop', { config: { modalName: 'spookyShop', shopType: 'spooky', isOpenAtom: SPOOKY_OPEN } }],
]);
const deps = (weather: string, spookyOpen: boolean): GateDeps => ({
  weather, weatherOf: type => (type === 'rain' ? 'rain' : null), isOpen: () => spookyOpen,
});

describe('shopChoicesFrom', () => {
  it('lists every shop, marks closed weather shops and leaves unread ones without a state', () => {
    const choices = shopChoicesFrom(SHOPS, null, builds, deps('sunny', false));
    expect(choices.map(c => [c.name, c.picked, c.status, c.weather])).toEqual([
      ['seedShop', true, 'open', null],
      ['eggShop', true, null, null],
      ['rainShop', true, 'closed', 'rain'],
      ['spookyShop', true, 'closed', null],
    ]);
  });
  it('opens a weather shop in its weather and follows the pick', () => {
    const choices = shopChoicesFrom(SHOPS, ['rainShop', 'seedShop'], builds, deps('rain', true));
    expect(choices.filter(c => c.picked).map(c => c.name)).toEqual(['seedShop', 'rainShop']);
    expect(choices.find(c => c.name === 'rainShop')?.status).toBe('open');
  });
});

describe('openableShopNames', () => {
  it('keeps pick order and drops shops known to be closed, keeping unread ones', () => {
    const pick = ['rainShop', 'eggShop', 'seedShop'];
    const choices = shopChoicesFrom(SHOPS, pick, builds, deps('sunny', true));
    expect(openableShopNames(choices, pick)).toEqual(['eggShop', 'seedShop']);
  });
});

describe('toggleShopChoice', () => {
  beforeEach(() => { h.shopIds = [...SHOPS]; h.setPick.mockClear(); });
  it('leaves a shop out of the full pick', () => {
    h.pick = null;
    expect(toggleShopChoice('eggShop')).toBe(true);
    expect(h.setPick).toHaveBeenCalledWith(['seedShop', 'rainShop', 'spookyShop']);
  });
  it('refuses to unpick the last shop', () => {
    h.pick = ['seedShop'];
    expect(toggleShopChoice('seedShop')).toBe(false);
    expect(h.setPick).not.toHaveBeenCalled();
  });
});

describe('ensureShopChoiceConfigs (plan U3)', () => {
  beforeEach(() => {
    h.shopIds = [...SHOPS];
    h.modal = null;
    h.cache = new Map();
    h.ensureCalls = [];
    h.ensureResult = null;
  });
  it('does nothing while the shop list is unread or a modal is open', () => {
    h.shopIds = null;
    expect(ensureShopChoiceConfigs()).toBe(false);
    h.shopIds = [...SHOPS];
    h.modal = 'seedShop';
    expect(ensureShopChoiceConfigs()).toBe(false);
    expect(h.ensureCalls).toEqual([]);
  });
  it('builds only the shops not cached, in one call', () => {
    h.cache = new Map([['seedShop', { config: {} }]]);
    h.ensureResult = names => ({ ok: true, builds: new Map(names.map(n => [n, {}])), skipped: {}, peeked: [...names] });
    expect(ensureShopChoiceConfigs()).toBe(true);
    expect(h.ensureCalls).toEqual([['eggShop', 'rainShop', 'spookyShop']]);
  });
  it('does not ask again for a shop with a final skip, but retries one refused by the peek', () => {
    h.ensureResult = () => ({ ok: true, builds: new Map(), skipped: { eggShop: 'no-request', rainShop: 'peek:modal-open' }, peeked: [] });
    h.shopIds = ['eggShop', 'rainShop'];
    ensureShopChoiceConfigs();
    ensureShopChoiceConfigs();
    expect(h.ensureCalls).toEqual([['eggShop', 'rainShop'], ['rainShop']]);
  });
  it('asks again after the cache is replaced (a new engine generation)', () => {
    h.shopIds = ['eggShop'];
    h.ensureResult = () => ({ ok: true, builds: new Map(), skipped: { eggShop: 'no-request' }, peeked: [] });
    ensureShopChoiceConfigs();
    h.cache = new Map();
    ensureShopChoiceConfigs();
    expect(h.ensureCalls).toEqual([['eggShop'], ['eggShop']]);
  });
});
