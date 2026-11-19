import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModalPeekRefusal, ModalPeekResult } from '../../core/gameState';

const SHOPS = ['seedShop', 'eggShop', 'rainShop'];

class FakeShopView {
  static destroyed: string[] = [];
  ui = {};
  renderer = {};
  riveBatchRenderer = {};
  constructor(public shopConfig: { modalName: string }) {}
  open(): void {}
  close(): void {}
  draw(): void {}
  destroy(): void { FakeShopView.destroyed.push(this.shopConfig.modalName); }
  invalidateLayout(): void {}
  handleKeyDown(): void {}
}

interface FakeHost { built: Map<string, unknown>; read?: () => unknown; draw: () => void }

let host: FakeHost;
let engine: { getSystem: (name: string) => unknown };
let shopIds: string[] | null;
let peekCalls: string[][];
let peekRefusal: ModalPeekRefusal | null;
let created: string[];
let openName: string | null;

function makeHost(): FakeHost {
  return {
    built: new Map(),
    draw: () => {},
    read: () => {
      const name = openName;
      if (!name || !SHOPS.includes(name)) return null;
      return { create: () => { created.push(name); return new FakeShopView({ modalName: name }); } };
    },
  };
}

function useHost(next: FakeHost): void {
  host = next;
  engine = { getSystem: (name) => (name === 'modals' ? host : null) };
}

vi.mock('../../catalogs/logic/gamePanelsCatalog', () => ({ getShopPanelIds: () => shopIds }));
vi.mock('../../core/gameState', () => ({
  readSync: () => engine,
  peekModalRequests: (names: string[], readRequest: () => unknown): ModalPeekResult<unknown> => {
    peekCalls.push(names);
    if (peekRefusal) return { ok: false, reason: peekRefusal };
    const requests = new Map<string, unknown>();
    for (const name of names) { openName = name; requests.set(name, readRequest()); }
    openName = null;
    return { ok: true, requests };
  },
}));

const {
  checkModalHost, checkShopView, dropShopBuilds, ensureShopConfigs, getCachedShopBuilds, setSimulatedHostMissing,
} = await import('./quietBuild');

beforeEach(() => {
  dropShopBuilds();
  FakeShopView.destroyed = [];
  shopIds = [...SHOPS];
  peekCalls = [];
  peekRefusal = null;
  created = [];
  openName = null;
  useHost(makeHost());
  setSimulatedHostMissing(null);
});

describe('capability checks', () => {
  it('names what the modal host lacks; a missing read only switches the peek off', () => {
    expect(checkModalHost(null)).toEqual({ ok: false, missing: ['modals'] });
    expect(checkModalHost({ built: {}, read: () => null })).toEqual({ ok: false, missing: ['modals.built', 'modals.draw'] });
    const noRead = checkModalHost({ built: new Map(), draw: () => {} });
    expect(noRead.ok && noRead.canPeek).toBe(false);
    const full = checkModalHost(host);
    expect(full.ok && full.canPeek).toBe(true);
  });

  it('names what a shop view lacks', () => {
    expect(checkShopView(new FakeShopView({ modalName: 'seedShop' }))).toEqual([]);
    expect(checkShopView(null)).toEqual(['view']);
    const bare = { shopConfig: { modalName: 7 }, open: () => {}, renderer: {} };
    expect(checkShopView(bare)).toEqual([
      'view.constructor', 'view.shopConfig', 'view.close', 'view.draw', 'view.destroy', 'view.invalidateLayout',
      'view.handleKeyDown', 'view.riveBatchRenderer', 'view.ui',
    ]);
  });
});

describe('ensureShopConfigs', () => {
  it('peeks every unbuilt shop in one batch, keeps config and class, destroys each peeked view', () => {
    const result = ensureShopConfigs(SHOPS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(peekCalls).toEqual([SHOPS]);
    expect([...result.builds.keys()]).toEqual(SHOPS);
    expect(result.skipped).toEqual({});
    expect(result.builds.get('rainShop')).toMatchObject({ name: 'rainShop', config: { modalName: 'rainShop' }, ViewClass: FakeShopView });
    expect(FakeShopView.destroyed).toEqual(SHOPS);
    expect(host.built.size).toBe(0);
  });

  it('serves a second call from the cache without a peek', () => {
    ensureShopConfigs(SHOPS);
    const again = ensureShopConfigs(['eggShop', 'seedShop']);
    expect(peekCalls).toHaveLength(1);
    expect(again.ok && [...again.builds.keys()]).toEqual(['eggShop', 'seedShop']);
    expect(created).toEqual(SHOPS);
  });

  it('reads a shop the game already built off its view, leaving the view alone', () => {
    const real = new FakeShopView({ modalName: 'seedShop' });
    host.built.set('seedShop', real);
    const result = ensureShopConfigs(['seedShop', 'eggShop']);
    expect(peekCalls).toEqual([['eggShop']]);
    expect(result.ok && result.builds.get('seedShop')?.config).toBe(real.shopConfig);
    expect(FakeShopView.destroyed).toEqual(['eggShop']);
  });

  it('drops the cache when the engine or the modal host is replaced', () => {
    ensureShopConfigs(SHOPS);
    useHost(makeHost());
    expect(ensureShopConfigs(['seedShop']).ok).toBe(true);
    expect(peekCalls).toEqual([SHOPS, ['seedShop']]);
    expect([...getCachedShopBuilds().keys()]).toEqual(['seedShop']);
  });

  it('without read, uses only shops the game already built', () => {
    const next = makeHost();
    delete next.read;
    next.built.set('eggShop', new FakeShopView({ modalName: 'eggShop' }));
    useHost(next);
    const result = ensureShopConfigs(SHOPS);
    expect(peekCalls).toEqual([]);
    expect(result.ok && [...result.builds.keys()]).toEqual(['eggShop']);
    expect(result.ok && result.skipped).toEqual({ seedShop: 'no-read', rainShop: 'no-read' });
  });

  it('keeps the UI container and renderer the view was built with', () => {
    const real = new FakeShopView({ modalName: 'seedShop' });
    host.built.set('seedShop', real);
    const result = ensureShopConfigs(['seedShop']);
    expect(result.ok && result.builds.get('seedShop')).toMatchObject({ ui: real.ui, renderer: real.renderer });
  });

  it('a simulated missing read switches the peek off; any other simulated handle fails the host check', () => {
    setSimulatedHostMissing(['modals.read']);
    host.built.set('eggShop', new FakeShopView({ modalName: 'eggShop' }));
    const result = ensureShopConfigs(SHOPS);
    expect(peekCalls).toEqual([]);
    expect(result.ok && [...result.builds.keys()]).toEqual(['eggShop']);
    setSimulatedHostMissing(['modals.draw']);
    expect(ensureShopConfigs(SHOPS)).toEqual({ ok: false, missing: ['modals.draw'] });
  });

  it('never peeks a name outside the game shop list', () => {
    const result = ensureShopConfigs(['journal', 'seedShop']);
    expect(peekCalls).toEqual([['seedShop']]);
    expect(result.ok && result.skipped).toEqual({ journal: 'not-a-shop' });
    shopIds = null;
    dropShopBuilds();
    expect(ensureShopConfigs(['eggShop'])).toMatchObject({ ok: true, skipped: { eggShop: 'not-a-shop' }, peeked: [] });
  });

  it('skips with the refusal when the peek is refused, and retries on the next call', () => {
    peekRefusal = 'modal-open';
    const refused = ensureShopConfigs(['seedShop']);
    expect(refused.ok && refused.skipped).toEqual({ seedShop: 'peek:modal-open' });
    expect(refused.ok && refused.builds.size).toBe(0);
    peekRefusal = null;
    const retried = ensureShopConfigs(['seedShop']);
    expect(retried.ok && [...retried.builds.keys()]).toEqual(['seedShop']);
  });

  it('destroys and skips a built view that is not this shop', () => {
    host.read = () => ({ create: () => new FakeShopView({ modalName: 'otherShop' }) });
    const result = ensureShopConfigs(['seedShop']);
    expect(result.ok && result.skipped).toEqual({ seedShop: 'view-mismatch' });
    expect(FakeShopView.destroyed).toEqual(['otherShop']);
    host.read = () => ({ create: () => { throw new Error('ctor'); } });
    const thrown = ensureShopConfigs(['eggShop']);
    expect(thrown.ok && thrown.skipped).toEqual({ eggShop: 'build-failed' });
  });

  it('reports a missing host instead of opening anything', () => {
    engine = { getSystem: () => null };
    expect(ensureShopConfigs(SHOPS)).toEqual({ ok: false, missing: ['modals'] });
    expect(peekCalls).toEqual([]);
  });
});
