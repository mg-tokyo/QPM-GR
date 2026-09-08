import { describe, expect, it } from 'vitest';
import { atomSource, customSource, defineKey, stateSource } from '../define';
import type { SourceRuntime } from '../runtime';
import type { IdentityContext } from '../types';
import type { QuinoaStateSnapshot } from '../../../types/gameAtoms';
import { createHandles } from './index';

export interface FakeRuntime extends SourceRuntime {
  setSnapshot(s: QuinoaStateSnapshot | null): void;
  setAtoms(atoms: Record<string, unknown>): void;
  setIdentity(id: IdentityContext): void;
  fireState(): void;
  fireAtom(label: string): void;
  readonly stateSubscribeOpts: ReadonlyArray<{ label: string; opts: { trustPatches?: boolean; ignorePatchSuffixes?: readonly string[] } | undefined }>;
  readonly findAtomsCalls: number;
  resetFindAtomsCalls(): void;
}

export function createFakeRuntime(): FakeRuntime {
  let snapshot: QuinoaStateSnapshot | null = null;
  let atoms: Record<string, unknown> = {};
  let identity: IdentityContext = { playerId: null, myIdx: null };
  const stateSubs = new Set<() => void>();
  const atomSubs = new Map<string, Set<() => void>>();
  const stateSubscribeOpts: Array<{ label: string; opts: { trustPatches?: boolean; ignorePatchSuffixes?: readonly string[] } | undefined }> = [];
  let findAtomsCalls = 0;
  const atomObj = (label: string): unknown => ({ debugLabel: label });
  const rt: FakeRuntime = {
    stateTree: {
      ready: () => snapshot !== null,
      selectSync: (sel) => (snapshot ? sel(snapshot) : undefined),
      subscribe: (sel, cb, label, _statePath, opts) => {
        stateSubscribeOpts.push({ label, opts });
        const run = (): void => { cb(snapshot ? sel(snapshot) : undefined); };
        stateSubs.add(run);
        if (snapshot) run();
        return () => { stateSubs.delete(run); };
      },
    },
    atoms: {
      findAtoms: (re) => { findAtomsCalls++; return Object.keys(atoms).filter((l) => re.test(l)).map(atomObj); },
      labelOf: (a) => String((a as { debugLabel: string }).debugLabel),
      readSync: (a) => {
        const l = (a as { debugLabel: string }).debugLabel;
        if (!(l in atoms)) throw new Error('missing');
        return atoms[l];
      },
      read: (a) => Promise.resolve(rt.atoms.readSync(a)),
      subscribe: (a, cb) => {
        const l = (a as { debugLabel: string }).debugLabel;
        const run = (): void => { cb(atoms[l]); };
        if (!atomSubs.has(l)) atomSubs.set(l, new Set());
        atomSubs.get(l)!.add(run);
        return Promise.resolve().then(() => {
          run();
          return () => { atomSubs.get(l)?.delete(run); };
        });
      },
      write: (a, v) => { atoms[(a as { debugLabel: string }).debugLabel] = v; return Promise.resolve(); },
      cacheSize: () => Object.keys(atoms).length,
    },
    identity: () => identity,
    now: () => 1000,
    setSnapshot: (s) => { snapshot = s; },
    setAtoms: (a) => { atoms = a; },
    setIdentity: (id) => { identity = id; },
    fireState: () => { for (const r of stateSubs) r(); },
    fireAtom: (label) => { for (const r of atomSubs.get(label) ?? []) r(); },
    stateSubscribeOpts,
    get findAtomsCalls() { return findAtomsCalls; },
    resetFindAtomsCalls: () => { findAtomsCalls = 0; },
  };
  return rt;
}

const snap = (coins: number): QuinoaStateSnapshot => ({
  scope: 'Room', data: {}, child: { scope: 'Quinoa', data: { userSlots: [{ userId: 'p1', data: { coinsCount: coins } }] } },
});

const def = defineKey<number>({
  policy: 'authoritative',
  doc: 'coins',
  sources: [
    stateSource('/child/data/userSlots/{myIdx}/data/coinsCount', (s, id) => {
      if (id.myIdx === null) return undefined;
      const v = s.child?.data?.userSlots?.[id.myIdx]?.data?.coinsCount;
      return typeof v === 'number' ? v : undefined;
    }),
    atomSource(/^myCoinsCountAtom$/, 'authoritative', { project: (raw) => (typeof raw === 'number' ? raw : undefined) }),
    customSource<number>({ id: 'const', available: () => true, read: () => 7 }),
  ],
});

describe('source handles', () => {
  it('stateTree handle is unavailable until snapshot + identity resolve, then reads', () => {
    const rt = createFakeRuntime();
    const [st] = createHandles('coins', def, rt);
    expect(st!.available()).toBe(false);
    rt.setSnapshot(snap(5));
    expect(st!.available()).toBe(false);
    rt.setIdentity({ playerId: 'p1', myIdx: 0 });
    expect(st!.available()).toBe(true);
    expect(st!.readSync()).toEqual({ ok: true, value: 5 });
  });
  it('atom handle resolves lazily and rejects wrong shapes', () => {
    const rt = createFakeRuntime();
    const [, at] = createHandles('coins', def, rt);
    expect(at!.available()).toBe(false);
    rt.setAtoms({ myCoinsCountAtom: 'oops' });
    at!.invalidate?.();
    expect(at!.available()).toBe(false);
    rt.setAtoms({ myCoinsCountAtom: 12 });
    at!.invalidate?.();
    expect(at!.available()).toBe(true);
    expect(at!.readSync()).toEqual({ ok: true, value: 12 });
    expect(at!.describe()).toBe('atom:myCoinsCountAtom');
  });

  it('caches the resolved atom until invalidate is called', () => {
    const rt = createFakeRuntime();
    rt.setAtoms({ myCoinsCountAtom: 5 });
    const [, at] = createHandles('coins', def, rt);
    rt.resetFindAtomsCalls();
    expect(at!.readSync()).toEqual({ ok: true, value: 5 });
    expect(at!.readSync()).toEqual({ ok: true, value: 5 });
    expect(rt.findAtomsCalls).toBe(1);
    at!.invalidate?.();
    expect(at!.readSync()).toEqual({ ok: true, value: 5 });
    expect(rt.findAtomsCalls).toBe(2);
  });
  it('a cached miss is re-scanned as soon as the atom cache grows, without a topology signal', () => {
    const rt = createFakeRuntime();
    rt.setAtoms({ unrelatedAtom: 1 });
    const [, at] = createHandles('coins', def, rt);
    rt.resetFindAtomsCalls();
    expect(at!.readSync().ok).toBe(false);
    expect(at!.readSync().ok).toBe(false);
    expect(rt.findAtomsCalls).toBe(1);
    // Lazy chunk registers the atom: same handle, no invalidate() call.
    rt.setAtoms({ unrelatedAtom: 1, myCoinsCountAtom: 9 });
    expect(at!.readSync()).toEqual({ ok: true, value: 9 });
    expect(rt.findAtomsCalls).toBe(2);
    expect(at!.readSync()).toEqual({ ok: true, value: 9 });
    expect(rt.findAtomsCalls).toBe(2);
  });
  it('atom subscribe attaches asynchronously and honours early unsubscribe', async () => {
    const rt = createFakeRuntime();
    rt.setAtoms({ myCoinsCountAtom: 1 });
    const [, at] = createHandles('coins', def, rt);
    const seen: Array<number | null> = [];
    const off = at!.subscribe((v) => seen.push(v));
    off();
    await Promise.resolve(); await Promise.resolve();
    rt.fireAtom('myCoinsCountAtom');
    expect(seen).toEqual([]);
    const seen2: Array<number | null> = [];
    at!.subscribe((v) => seen2.push(v));
    await Promise.resolve(); await Promise.resolve();
    rt.setAtoms({ myCoinsCountAtom: 2 });
    rt.fireAtom('myCoinsCountAtom');
    expect(seen2).toEqual([1, 2]);
  });
  it('custom handle reads and reports availability', () => {
    const rt = createFakeRuntime();
    const [, , cu] = createHandles('coins', def, rt);
    expect(cu!.available()).toBe(true);
    expect(cu!.readSync()).toEqual({ ok: true, value: 7 });
    expect(cu!.describe()).toBe('custom:const');
  });
});

describe('stateTree source trustPatches forwarding', () => {
  it('forwards trustPatches: true to runtime.subscribe when set on the spec', () => {
    const rt = createFakeRuntime();
    const trusted = defineKey<QuinoaStateSnapshot>({
      policy: 'authoritative', doc: 'trusted',
      sources: [stateSource<QuinoaStateSnapshot>('/child', (s) => s, { trustPatches: true })],
    });
    const [st] = createHandles('trusted', trusted, rt);
    st!.subscribe(() => {});
    const call = rt.stateSubscribeOpts.find((c) => c.label === 'gameState:trusted');
    expect(call).toBeDefined();
    expect(call?.opts).toEqual({ trustPatches: true });
  });
  it('forwards ignorePatchSuffixes alongside trustPatches', () => {
    const rt = createFakeRuntime();
    const shops = defineKey<QuinoaStateSnapshot>({
      policy: 'authoritative', doc: 'shops',
      sources: [stateSource<QuinoaStateSnapshot>('/child', (s) => s, { trustPatches: true, ignorePatchSuffixes: ['/secondsUntilRestock'] })],
    });
    const [st] = createHandles('shops', shops, rt);
    st!.subscribe(() => {});
    const call = rt.stateSubscribeOpts.find((c) => c.label === 'gameState:shops');
    expect(call?.opts).toEqual({ trustPatches: true, ignorePatchSuffixes: ['/secondsUntilRestock'] });
  });
  it('forwards trustPatches: false when unset on the spec (default path)', () => {
    const rt = createFakeRuntime();
    const [st] = createHandles('coins', def, rt);
    st!.subscribe(() => {});
    const call = rt.stateSubscribeOpts.find((c) => c.label === 'gameState:coins');
    expect(call).toBeDefined();
    expect(call?.opts).toEqual({ trustPatches: false });
  });
});
