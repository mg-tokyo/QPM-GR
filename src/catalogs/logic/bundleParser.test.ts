import { beforeEach, describe, expect, it, vi } from 'vitest';

const X = 'https://magicgarden.gg/version/1/assets/subscribeAtom-X.js';
const Y = 'https://magicgarden.gg/version/1/assets/de-Y.js';
const pad = (s: string): string => `${s};${'/* pad */'.repeat(150)}`;
const TEXTS: Record<string, string> = { [X]: pad('var CYCLE_MARKER=1'), [Y]: pad('var locale=1') };

let candidates: string[] = [];
// Per-URL queue of statuses; empty queue = 200.
let statusQueue: Record<string, number[]> = {};
const fetchImpl = vi.fn(async (url: string) => {
  await Promise.resolve();
  const status = statusQueue[url]?.shift() ?? 200;
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(TEXTS[url] ?? '') };
});

vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) }));
vi.mock('../../core/pageContext', () => ({
  pageWindow: {
    performance: { getEntriesByType: () => candidates.map((name) => ({ name })) },
    fetch: (u: string) => fetchImpl(u),
  },
}));

type Mod = typeof import('./bundleParser');
const load = async (): Promise<Mod> => import('./bundleParser');
const callsTo = (url: string): number => fetchImpl.mock.calls.filter(([u]) => u === url).length;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  fetchImpl.mockClear();
  candidates = [X];
  statusQueue = {};
});

describe('bundleParser fetch failures (REL-7)', () => {
  it('counts one failure per request, not per waiter', async () => {
    const m = await load();
    statusQueue[X] = [503];
    const results = await Promise.all(['CYCLE_MARKER', 'other-a', 'other-b'].map((k) => m.fetchBundleContaining(k)));
    expect(results).toEqual([null, null, null]);
    expect(callsTo(X)).toBe(1);
    expect(m.getBundleFetchStats()).toMatchObject({ failedUrls: ['subscribeAtom-X.js'], givenUpUrls: [] });

    expect(await m.fetchBundleContaining('CYCLE_MARKER')).toBe(TEXTS[X]);
    expect(callsTo(X)).toBe(2);
  });

  it('gives a URL up after three failed requests', async () => {
    const m = await load();
    statusQueue[X] = [503, 503, 503];
    for (let i = 0; i < 4; i += 1) expect(await m.fetchBundleContaining('CYCLE_MARKER')).toBeNull();
    expect(callsTo(X)).toBe(3);
    expect(m.getBundleFetchStats().givenUpUrls).toEqual(['subscribeAtom-X.js']);
    expect(m.getMarkerMissCount('CYCLE_MARKER')).toBe(1);
  });

  it('re-arms a given-up URL for one request when a new candidate appears', async () => {
    const m = await load();
    // Another marker fetched X fine and missed: that miss entry must survive the re-arm.
    expect(await m.fetchBundleContaining('not-in-any-chunk')).toBeNull();
    statusQueue[X] = [503, 503, 503];
    for (let i = 0; i < 3; i += 1) await m.fetchBundleContaining('CYCLE_MARKER');
    const before = callsTo(X);

    candidates = [X, Y];
    expect(await m.fetchBundleContaining('CYCLE_MARKER')).toBe(TEXTS[X]);
    expect(callsTo(X)).toBe(before + 1);
    expect(callsTo(Y)).toBe(0);
    expect(m.getMarkerMissCount('CYCLE_MARKER')).toBe(0);
    expect(m.getMarkerMissCount('not-in-any-chunk')).toBe(1);
    expect(m.getBundleFetchStats().givenUpUrls).toEqual([]);
  });

  it('a re-armed URL that fails again is given up after that one request', async () => {
    const m = await load();
    statusQueue[X] = [503, 503, 503, 503];
    for (let i = 0; i < 3; i += 1) await m.fetchBundleContaining('CYCLE_MARKER');
    candidates = [X, Y];
    await m.fetchBundleContaining('CYCLE_MARKER');
    await m.fetchBundleContaining('CYCLE_MARKER');
    expect(callsTo(X)).toBe(4);
    expect(m.getBundleFetchStats().givenUpUrls).toEqual(['subscribeAtom-X.js']);
  });

  it('a too-small chunk is fetched once, never counted as a failure or re-armed', async () => {
    const T = 'https://magicgarden.gg/version/1/assets/garden-T.js';
    TEXTS[T] = 'export{a as garden};';
    candidates = [T, X];
    const m = await load();
    await Promise.all(['CYCLE_MARKER', 'other-a'].map((k) => m.fetchBundleContaining(k)));
    await m.fetchBundleContaining('other-b');
    candidates = [T, X, Y];
    await m.fetchBundleContaining('other-c');
    expect(callsTo(T)).toBe(1);
    expect(m.getBundleFetchStats()).toMatchObject({ tooSmall: 1, failedUrls: [], givenUpUrls: [] });
    delete TEXTS[T];
  });

  it("a consumer's new-chunk retry reaches the re-armed URL", async () => {
    type ObserverCb = (list: { getEntries: () => Array<{ name: string }> }) => void;
    const observer: { cb: ObserverCb | null } = { cb: null };
    vi.stubGlobal('PerformanceObserver', class {
      constructor(cb: ObserverCb) { observer.cb = cb; }
      observe(): void {}
      disconnect(): void {}
    });
    const m = await load();
    statusQueue[X] = [503, 503, 503];
    for (let i = 0; i < 3; i += 1) await m.fetchBundleContaining('CYCLE_MARKER');

    const retries: Array<Promise<string | null>> = [];
    const off = m.onNewBundleChunk(() => { retries.push(m.fetchBundleContaining('CYCLE_MARKER')); });
    candidates = [X, Y];
    observer.cb?.({ getEntries: () => [{ name: Y }] });
    expect(retries).toHaveLength(1);
    expect(await retries[0]).toBe(TEXTS[X]);
    off();
  });
});
