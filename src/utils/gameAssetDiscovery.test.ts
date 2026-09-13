import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CHUNK_URL = 'https://magicgarden.gg/version/1152/assets/quinoaAssetResolver-BMp5Avdf.js';
const CHUNK_TEXT =
  'V=new Worker(new URL(`/version/1152/assets/ktx2.worker-W7wI-3_c.js`,``+import.meta.url),{type:`module`});' +
  'var It=`/version/1152/assets/libktx-iBGPD5pz.wasm`;';

const fetchBundleHitContaining = vi.fn<(m: RegExp) => Promise<{ url: string; text: string } | null>>();
const onNewBundleChunk = vi.fn<(cb: () => void) => () => void>(() => () => {});
vi.mock('../catalogs/logic/bundleParser', () => ({
  fetchBundleHitContaining: (m: RegExp) => fetchBundleHitContaining(m),
  onNewBundleChunk: (cb: () => void) => onNewBundleChunk(cb),
  ensureResourceTimingBuffer: () => {},
}));

const QUERIES = [
  { key: 'ktx2Worker', filenamePattern: /\bktx2\.worker[\w.-]*\.js\b/ },
  { key: 'libktxWasm', filenamePattern: /\blibktx[\w.-]*\.wasm\b/ },
] as const;

let resources: string[] = [];
beforeEach(() => {
  vi.resetModules();
  resources = [];
  vi.stubGlobal('location', { origin: 'https://magicgarden.gg' });
  vi.stubGlobal('performance', { now: () => 0, getEntriesByType: () => resources.map((name) => ({ name })) });
  fetchBundleHitContaining.mockReset();
  onNewBundleChunk.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('discoverGameAssets', () => {
  it('finds both assets in a non-main chunk through the bundle scanner', async () => {
    fetchBundleHitContaining.mockImplementation(async (m: RegExp) => (m.test(CHUNK_TEXT) ? { url: CHUNK_URL, text: CHUNK_TEXT } : null));
    const { discoverGameAssets } = await import('./gameAssetDiscovery');
    const { hits } = await discoverGameAssets(QUERIES, { lateChunkWaitMs: 0 });
    expect(hits.get('ktx2Worker')).toEqual({ key: 'ktx2Worker', strategy: 'bundle-scan', url: 'https://magicgarden.gg/version/1152/assets/ktx2.worker-W7wI-3_c.js' });
    expect(hits.get('libktxWasm')?.url).toBe('https://magicgarden.gg/version/1152/assets/libktx-iBGPD5pz.wasm');
  });

  it('prefers resource timing and does not scan for a key it already has', async () => {
    resources = ['https://magicgarden.gg/version/1152/assets/ktx2.worker-W7wI-3_c.js'];
    fetchBundleHitContaining.mockImplementation(async (m: RegExp) => (m.test(CHUNK_TEXT) ? { url: CHUNK_URL, text: CHUNK_TEXT } : null));
    const { discoverGameAssets } = await import('./gameAssetDiscovery');
    const { hits } = await discoverGameAssets(QUERIES, { lateChunkWaitMs: 0 });
    expect(hits.get('ktx2Worker')?.strategy).toBe('resource-timing');
    expect(fetchBundleHitContaining).toHaveBeenCalledTimes(1);
  });

  it('waits once for a late chunk and rescans', async () => {
    let fire: (() => void) | null = null;
    onNewBundleChunk.mockImplementation((cb: () => void) => { fire = cb; return () => {}; });
    let loaded = false;
    fetchBundleHitContaining.mockImplementation(async (m: RegExp) => (loaded && m.test(CHUNK_TEXT) ? { url: CHUNK_URL, text: CHUNK_TEXT } : null));
    const { discoverGameAssets } = await import('./gameAssetDiscovery');
    const pending = discoverGameAssets(QUERIES, { lateChunkWaitMs: 5000 });
    while (fire === null) await Promise.resolve();
    loaded = true;
    (fire as () => void)();
    const { hits } = await pending;
    expect(hits.get('ktx2Worker')?.strategy).toBe('bundle-scan');
  });

  it('gives up cleanly when the chunk never appears', async () => {
    vi.useFakeTimers();
    fetchBundleHitContaining.mockResolvedValue(null);
    const { discoverGameAssets } = await import('./gameAssetDiscovery');
    const pending = discoverGameAssets(QUERIES, { lateChunkWaitMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    const { hits } = await pending;
    expect(hits.size).toBe(0);
    vi.useRealTimers();
  });
});
