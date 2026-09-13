import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockEligibleShopIds: Set<string>;
let mockStorage: Map<string, unknown>;
let onCatalogsReadyCallbacks: Array<() => void>;
let onCatalogsReadyFireOnSubscribe: boolean;
let subscribeAtomCallback: ((value: unknown) => void) | null;

vi.mock('../catalogs/shopEligibility', () => ({
  getAllEligibleShopIds: () => new Set(mockEligibleShopIds),
}));

vi.mock('../catalogs/gameCatalogs', () => ({
  onCatalogsReady: (cb: () => void) => {
    onCatalogsReadyCallbacks.push(cb);
    if (onCatalogsReadyFireOnSubscribe) cb();
    return () => {
      const i = onCatalogsReadyCallbacks.indexOf(cb);
      if (i >= 0) onCatalogsReadyCallbacks.splice(i, 1);
    };
  },
}));

vi.mock('../utils/storage', () => ({
  storage: {
    get: <T,>(key: string, fallback: T): T => (mockStorage.get(key) as T | undefined) ?? fallback,
    set: (key: string, value: unknown): void => { mockStorage.set(key, value); },
  },
}));

// weatherDetection transitively imports utils/dom/dom which reads `document` at
// module load, which the node vitest env lacks. Only the kinds list is used here.
vi.mock('../utils/game/weatherDetection', () => ({
  DETAILED_WEATHER_KINDS: ['sunny', 'rain', 'snow', 'dawn', 'amber', 'thunderstorm', 'unknown'] as const,
}));

vi.mock('../core/atomRegistry', () => ({
  readAtomValueSync: vi.fn(() => null),
  subscribeAtomValue: vi.fn(async (_key: string, cb: (v: unknown) => void) => {
    subscribeAtomCallback = cb;
    return () => { subscribeAtomCallback = null; };
  }),
}));

vi.mock('../core/gameState', () => ({
  atomObjectFor: vi.fn(() => null),
}));

vi.mock('../core/jotaiBridge', () => ({
  getCachedStore: vi.fn(() => null),
}));

vi.mock('./weatherHub', () => ({
  getWeatherSnapshot: vi.fn(() => ({ kind: 'unknown' as const })),
}));

vi.mock('./_storeDiagnostics', () => ({
  createStoreDiagnostics: () => ({
    register: vi.fn(),
    publishOk: vi.fn(),
    warn: vi.fn(),
    log: { debug: vi.fn() },
  }),
}));

async function loadModule(): Promise<typeof import('./shopRegistry')> {
  return await import('./shopRegistry');
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mockEligibleShopIds = new Set();
  mockStorage = new Map();
  onCatalogsReadyCallbacks = [];
  onCatalogsReadyFireOnSubscribe = false;
  subscribeAtomCallback = null;
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('shopRegistry — catalog-driven weather-shop set (T1)', () => {
  it('reseeds catalogWeatherShopSet and discoveredIds from catalog blueprints when onCatalogsReady fires', async () => {
    mockEligibleShopIds = new Set(['dawn', 'snow', 'thunder', 'amber', 'rain', 'apology', 'seed', 'egg', 'tool', 'decor']);
    onCatalogsReadyFireOnSubscribe = true;
    const mod = await loadModule();
    await mod.startShopRegistry();
    await flushMicrotasks();

    expect([...mod.getKnownShopIds()].sort()).toEqual([
      'amber', 'apology', 'dawn', 'decor', 'eggs', 'rain', 'seeds', 'snow', 'thunder', 'tools',
    ]);
    expect([...mod.getWeatherGatedShopIds()].sort()).toEqual([
      'amber', 'apology', 'dawn', 'rain', 'snow', 'thunder',
    ]);
  });

  it('getWeatherShopIds filters to ids that resolve to a weather kind via the name heuristic', async () => {
    mockEligibleShopIds = new Set(['dawn', 'snow', 'thunder', 'amber', 'rain', 'apology']);
    onCatalogsReadyFireOnSubscribe = true;
    const mod = await loadModule();
    await mod.startShopRegistry();
    await flushMicrotasks();

    expect([...mod.getWeatherShopIds()].sort()).toEqual(['amber', 'dawn', 'rain', 'snow', 'thunder']);
  });

  it('empty catalog scan → empty derived set; standard shops still known', async () => {
    mockEligibleShopIds = new Set();
    onCatalogsReadyFireOnSubscribe = true;
    const mod = await loadModule();
    await mod.startShopRegistry();
    await flushMicrotasks();

    expect([...mod.getWeatherGatedShopIds()]).toEqual([]);
    expect([...mod.getKnownShopIds()].sort()).toEqual(['decor', 'eggs', 'seeds', 'tools']);
  });

  it('defers derivation until onCatalogsReady fires; empty until then', async () => {
    mockEligibleShopIds = new Set(['dawn', 'amber']);
    onCatalogsReadyFireOnSubscribe = false;
    const mod = await loadModule();
    await mod.startShopRegistry();
    await flushMicrotasks();

    expect([...mod.getWeatherGatedShopIds()]).toEqual([]);
    onCatalogsReadyCallbacks[0]?.();
    expect([...mod.getWeatherGatedShopIds()].sort()).toEqual(['amber', 'dawn']);
  });

  it('runtime observations still merge non-catalog ids via registerDiscovered', async () => {
    mockEligibleShopIds = new Set(['dawn']);
    onCatalogsReadyFireOnSubscribe = true;
    const mod = await loadModule();
    await mod.startShopRegistry();
    await flushMicrotasks();

    mod.registerDiscovered('futureShop');
    expect([...mod.getWeatherGatedShopIds()].sort()).toEqual(['dawn', 'futureShop']);
  });

  it('registerDiscovered is a no-op for ids already in the catalog set (T1 invariant)', async () => {
    mockEligibleShopIds = new Set(['dawn']);
    onCatalogsReadyFireOnSubscribe = true;
    const mod = await loadModule();
    await mod.startShopRegistry();
    await flushMicrotasks();

    const seen: string[] = [];
    mod.onShopDiscovered((id) => seen.push(id));
    mod.registerDiscovered('dawn');
    expect(seen).toEqual([]);
  });

  it('quinoaData snapshot ingest merges non-catalog shops but skips catalog-known and standard ones', async () => {
    mockEligibleShopIds = new Set(['dawn']);
    onCatalogsReadyFireOnSubscribe = true;
    const mod = await loadModule();
    await mod.startShopRegistry();
    await flushMicrotasks();

    expect(typeof subscribeAtomCallback).toBe('function');
    subscribeAtomCallback?.({
      shops: {
        dawn: { inventory: [] },
        futureShop: { inventory: [] },
        seeds: { inventory: [] },
      },
    });

    expect([...mod.getWeatherGatedShopIds()].sort()).toEqual(['dawn', 'futureShop']);
  });
});
