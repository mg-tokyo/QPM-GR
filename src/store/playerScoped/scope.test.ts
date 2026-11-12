import { describe, expect, it, vi } from 'vitest';
import { createPlayerScopedWith, PLAYER_SCOPED_CLAIMS_KEY, PLAYER_SCOPED_UNCHANGED } from './scope';
import type { ClaimMarker, PlayerScopedDeps, PlayerScopedLayout, PlayerScopedSpec } from './types';

interface Hist { items: string[] }

const BASE = 'qpm.test.history.v1';
const EMPTY: Hist = { items: [] };

function union(a: Hist, b: Hist): Hist {
  const extra = b.items.filter((i) => !a.items.includes(i));
  return extra.length === 0 ? a : { items: [...a.items, ...extra] };
}

/** One script-manager GM store shared by every site; each site has its own mirror. */
class World {
  gm = new Map<string, unknown>();
  mirrors = new Map<string, Map<string, unknown>>();
  failDurable = false;
  mirror(site: string): Map<string, unknown> {
    let m = this.mirrors.get(site);
    if (!m) { m = new Map(); this.mirrors.set(site, m); }
    return m;
  }
}

class Site {
  playerId: string | null = null;
  listeners = new Set<(id: string | null) => void>();
  sets: string[] = [];
  dynamic: string[] = [];
  errors: string[] = [];
  constructor(readonly world: World, readonly name: string) {}

  deps(): PlayerScopedDeps {
    const mirror = this.world.mirror(this.name);
    return {
      storageGet: <V>(key: string, fallback: V): V => (mirror.has(key) ? mirror.get(key) : this.world.gm.has(key) ? this.world.gm.get(key) : fallback) as V,
      storageSet: (key, value) => { this.sets.push(key); mirror.set(key, value); this.world.gm.set(key, value); },
      readDurable: <V>(key: string, fallback: V): Promise<V> => (
        this.world.failDurable ? Promise.reject(new Error('gm down')) : Promise.resolve((this.world.gm.has(key) ? this.world.gm.get(key) : fallback) as V)
      ),
      registerDynamicKey: (key) => { this.dynamic.push(key); },
      currentPlayerId: () => this.playerId,
      onIdentityChange: (cb) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; },
      siteId: () => this.name,
      onError: (phase) => { this.errors.push(phase); },
    };
  }

  emit(id: string): void {
    this.playerId = id;
    for (const l of [...this.listeners]) l(id);
  }
}

function makeSpec(extra: Partial<PlayerScopedSpec<Hist>> = {}): PlayerScopedSpec<Hist> & { ready: Array<[Hist, string]> } {
  const ready: Array<[Hist, string]> = [];
  return { baseKey: BASE, fallback: EMPTY, merge: union, onReady: (v, id) => { ready.push([v, id]); }, ready, ...extra };
}

const settle = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
const marker = (w: World): ClaimMarker => w.gm.get(PLAYER_SCOPED_CLAIMS_KEY) as ClaimMarker;

describe('playerScoped', () => {
  it('binds when the id is known at start, merging the legacy copy once', async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['old'] });
    world.mirror('web').set(BASE, { items: ['old'] });
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const spec = makeSpec();
    const h = createPlayerScopedWith(spec, site.deps());
    h.start();
    expect(h.isReady()).toBe(false);
    await settle();
    expect(spec.ready).toEqual([[{ items: ['old'] }, 'A']]);
    expect(world.gm.get(`${BASE}.A`)).toEqual({ items: ['old'] });
    expect(world.gm.get(BASE)).toEqual({ items: ['old'] });
    expect(marker(world)).toEqual({ shared: { [BASE]: 'A' }, sites: { web: { [BASE]: 'A' } } });
    expect(site.dynamic).toEqual([`${BASE}.A`]);
    expect(h.scopedKey()).toBe(`${BASE}.A`);
  });

  it('holds writes until the id arrives, then merges them in', async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['old'] });
    const site = new Site(world, 'web');
    const spec = makeSpec();
    const h = createPlayerScopedWith(spec, site.deps());
    h.start();
    h.write({ items: ['early'] });
    expect(h.read()).toEqual({ items: ['early'] });
    expect(site.sets).toEqual([]);
    await settle();
    expect(spec.ready).toEqual([]);
    site.emit('A');
    await settle();
    expect(spec.ready[0]?.[0]).toEqual({ items: ['old', 'early'] });
    h.write({ items: ['old', 'early', 'late'] });
    expect(world.gm.get(`${BASE}.A`)).toEqual({ items: ['old', 'early', 'late'] });
  });

  it('never gives a claimed legacy copy to a second player on the same site', async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['old'] });
    const site = new Site(world, 'web');
    site.playerId = 'A';
    createPlayerScopedWith(makeSpec(), site.deps()).start();
    await settle();
    const siteB = new Site(world, 'web');
    siteB.playerId = 'B';
    const specB = makeSpec();
    createPlayerScopedWith(specB, siteB.deps()).start();
    await settle();
    expect(specB.ready).toEqual([[EMPTY, 'B']]);
    expect(world.gm.has(`${BASE}.B`)).toBe(false);
    expect(siteB.dynamic).toEqual([`${BASE}.B`]);
  });

  it("merges another site's own legacy copy into the same player", async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['web'] });
    world.mirror('web').set(BASE, { items: ['web'] });
    world.mirror('discord').set(BASE, { items: ['discord'] });
    const web = new Site(world, 'web');
    web.playerId = 'A';
    createPlayerScopedWith(makeSpec(), web.deps()).start();
    await settle();
    const discord = new Site(world, 'discord');
    discord.playerId = 'A';
    const spec = makeSpec();
    createPlayerScopedWith(spec, discord.deps()).start();
    await settle();
    expect(spec.ready[0]?.[0]).toEqual({ items: ['web', 'discord'] });
    expect(marker(world).sites).toEqual({ web: { [BASE]: 'A' }, discord: { [BASE]: 'A' } });
  });

  it('does not hand the shared copy to a second player through a site with no copy of its own', async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['web'] });
    const web = new Site(world, 'web');
    web.playerId = 'A';
    createPlayerScopedWith(makeSpec(), web.deps()).start();
    await settle();
    const discord = new Site(world, 'discord');
    discord.playerId = 'B';
    const spec = makeSpec();
    createPlayerScopedWith(spec, discord.deps()).start();
    await settle();
    expect(spec.ready).toEqual([[EMPTY, 'B']]);
  });

  it('merges the local and durable scoped copies and skips the write when nothing changed', async () => {
    const world = new World();
    world.mirror('web').set(`${BASE}.A`, { items: ['local'] });
    world.gm.set(`${BASE}.A`, { items: ['durable'] });
    world.gm.set(PLAYER_SCOPED_CLAIMS_KEY, { shared: { [BASE]: 'A' }, sites: { web: { [BASE]: 'A' } } });
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const spec = makeSpec();
    createPlayerScopedWith(spec, site.deps()).start();
    await settle();
    expect(spec.ready[0]?.[0]).toEqual({ items: ['local', 'durable'] });
    expect(site.sets).toEqual([`${BASE}.A`]);

    const again = new Site(world, 'web');
    again.playerId = 'A';
    createPlayerScopedWith(makeSpec(), again.deps()).start();
    await settle();
    expect(again.sets).toEqual([]);
  });

  it('flushes to the old key on an id change and keeps writing there until the new id binds', async () => {
    const world = new World();
    const site = new Site(world, 'web');
    site.playerId = 'A';
    let handle: ReturnType<typeof createPlayerScopedWith<Hist>> | null = null;
    const flushedTo: Array<string | null> = [];
    const spec = makeSpec({ flush: () => { flushedTo.push(handle?.scopedKey() ?? null); handle?.write({ items: ['a-pending'] }); } });
    handle = createPlayerScopedWith(spec, site.deps());
    handle.start();
    await settle();
    site.emit('B');
    expect(flushedTo).toEqual([`${BASE}.A`]);
    expect(world.gm.get(`${BASE}.A`)).toEqual({ items: ['a-pending'] });
    handle.write({ items: ['a-during'] });
    expect(world.gm.get(`${BASE}.A`)).toEqual({ items: ['a-during'] });
    await settle();
    expect(handle.scopedKey()).toBe(`${BASE}.B`);
    expect(spec.ready.map(([, id]) => id)).toEqual(['A', 'B']);
    expect(world.gm.has(`${BASE}.B`)).toBe(false);
  });

  it('is safe to start twice and stop twice, and drops a bind that resolves after stop', async () => {
    const world = new World();
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const spec = makeSpec();
    const h = createPlayerScopedWith(spec, site.deps());
    h.start();
    h.start();
    expect(site.listeners.size).toBe(1);
    h.stop();
    h.stop();
    expect(site.listeners.size).toBe(0);
    await settle();
    expect(spec.ready).toEqual([]);
    expect(h.isReady()).toBe(false);
    h.start();
    await settle();
    expect(spec.ready).toEqual([[EMPTY, 'A']]);
  });

  it('drops a stale bind when restarted before it resolves', async () => {
    const world = new World();
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const spec = makeSpec();
    const h = createPlayerScopedWith(spec, site.deps());
    h.start();
    h.stop();
    h.start();
    await settle();
    expect(spec.ready).toEqual([[EMPTY, 'A']]);
  });

  it('claims nothing when the durable read fails', async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['old'] });
    world.failDurable = true;
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const spec = makeSpec();
    createPlayerScopedWith(spec, site.deps()).start();
    await settle();
    expect(spec.ready).toEqual([[EMPTY, 'A']]);
    expect(world.gm.has(PLAYER_SCOPED_CLAIMS_KEY)).toBe(false);
    expect(site.errors).toEqual(['bind']);
  });

  it('isolates a throwing onReady', async () => {
    const world = new World();
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const onReady = vi.fn(() => { throw new Error('store bug'); });
    const h = createPlayerScopedWith({ ...makeSpec(), onReady }, site.deps());
    h.start();
    await settle();
    expect(onReady).toHaveBeenCalledOnce();
    expect(h.isReady()).toBe(true);
    expect(site.errors).toEqual(['bind']);
  });
});

interface Split { items: string[]; log: string[] }

const LOG = 'qpm.test.history.log.v1';

function unionSplit(a: Split, b: Split): Split {
  const items = b.items.filter((i) => !a.items.includes(i));
  const log = b.log.filter((i) => !a.log.includes(i));
  return items.length === 0 && log.length === 0 ? a : { items: [...a.items, ...items], log: [...a.log, ...log] };
}

function makeLayout(): PlayerScopedLayout<Split> & { logDirty: boolean } {
  const layout = {
    logDirty: false,
    parts: [BASE, LOG],
    join: ([state, log]: readonly unknown[]): Split | undefined => (state === undefined ? undefined
      : { items: (state as Hist).items, log: (log as { log?: string[] } | undefined)?.log ?? [] }),
    split: (value: Split, reason: 'bind' | 'write'): readonly unknown[] => [
      { items: value.items },
      reason === 'bind' || layout.logDirty ? { log: value.log } : PLAYER_SCOPED_UNCHANGED,
    ],
  };
  return layout;
}

function splitSpec(): PlayerScopedSpec<Split> & { ready: Array<[Split, string]> } {
  const ready: Array<[Split, string]> = [];
  return { baseKey: BASE, fallback: { items: [], log: [] }, merge: unionSplit, onReady: (v, id) => { ready.push([v, id]); }, ready };
}

describe('playerScoped layout', () => {
  it('merges legacy parts into every scoped part key and registers each', async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['old'] });
    world.gm.set(LOG, { log: ['l1'] });
    world.mirror('web').set(LOG, { log: ['l2'] });
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const spec = splitSpec();
    createPlayerScopedWith(spec, site.deps(), makeLayout()).start();
    await settle();
    expect(spec.ready).toEqual([[{ items: ['old'], log: ['l1', 'l2'] }, 'A']]);
    expect(world.gm.get(`${BASE}.A`)).toEqual({ items: ['old'] });
    expect(world.gm.get(`${LOG}.A`)).toEqual({ log: ['l1', 'l2'] });
    expect(site.dynamic).toEqual([`${BASE}.A`, `${LOG}.A`]);
    expect(marker(world).shared).toEqual({ [BASE]: 'A' });
  });

  it('skips an UNCHANGED part on a store write', async () => {
    const world = new World();
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const layout = makeLayout();
    const h = createPlayerScopedWith(splitSpec(), site.deps(), layout);
    h.start();
    await settle();
    site.sets = [];
    expect(h.write({ items: ['x'], log: ['y'] })).toBe(true);
    expect(site.sets).toEqual([`${BASE}.A`]);
    layout.logDirty = true;
    h.write({ items: ['x'], log: ['y'] });
    expect(site.sets).toEqual([`${BASE}.A`, `${BASE}.A`, `${LOG}.A`]);
    expect(world.gm.get(`${LOG}.A`)).toEqual({ log: ['y'] });
  });

  it('returns false when a part fails to save, and claims nothing for an unsaved merge', async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['old'] });
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const deps = site.deps();
    const h = createPlayerScopedWith(splitSpec(), { ...deps, storageSet: () => { throw new Error('quota'); } }, makeLayout());
    h.start();
    await settle();
    expect(world.gm.has(PLAYER_SCOPED_CLAIMS_KEY)).toBe(false);
    expect(h.write({ items: [], log: [] })).toBe(false);
    expect(site.errors).toEqual(['persist', 'persist', 'persist']);
  });

  it('writes nothing when every part already holds the bound value', async () => {
    const world = new World();
    world.gm.set(`${BASE}.A`, { items: ['a'] });
    world.gm.set(`${LOG}.A`, { log: ['l'] });
    world.gm.set(PLAYER_SCOPED_CLAIMS_KEY, { shared: { [BASE]: 'A' }, sites: { web: { [BASE]: 'A' } } });
    const site = new Site(world, 'web');
    site.playerId = 'A';
    const spec = splitSpec();
    createPlayerScopedWith(spec, site.deps(), makeLayout()).start();
    await settle();
    expect(spec.ready[0]?.[0]).toEqual({ items: ['a'], log: ['l'] });
    expect(site.sets).toEqual([]);
  });

  it('does not hand shared parts to a second player through a site with no copy of its own', async () => {
    const world = new World();
    world.gm.set(BASE, { items: ['web'] });
    world.gm.set(LOG, { log: ['web-log'] });
    const web = new Site(world, 'web');
    web.playerId = 'A';
    createPlayerScopedWith(splitSpec(), web.deps(), makeLayout()).start();
    await settle();
    const discord = new Site(world, 'discord');
    discord.playerId = 'B';
    const spec = splitSpec();
    createPlayerScopedWith(spec, discord.deps(), makeLayout()).start();
    await settle();
    expect(spec.ready).toEqual([[{ items: [], log: [] }, 'B']]);
  });
});
