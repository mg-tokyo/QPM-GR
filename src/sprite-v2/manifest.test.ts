import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://magicgarden.gg';
const BASE = `${ORIGIN}/version/2082/assets`;

const page = vi.hoisted(() => ({ entries: [] as Array<{ name: string }> }));
vi.mock('../core/pageContext', () => ({
  pageWindow: { performance: { getEntriesByType: () => page.entries } },
}));

const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, text: async () => '{"bundles":[]}' }));

class ThrowingObserver {
  observe(): void { throw new Error('resource timing unavailable'); }
  disconnect(): void { /* noop */ }
}

async function loadModule(): Promise<typeof import('./manifest')> {
  vi.resetModules();
  return import('./manifest');
}

beforeEach(() => {
  page.entries = [];
  fetchMock.mockClear();
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/r/zzz`, origin: ORIGIN } });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('PerformanceObserver', ThrowingObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAssetManifest', () => {
  it('falls back to manifest.rgba8.json when the game fetched no format manifest', async () => {
    const m = await loadModule();
    await m.getAssetManifest(BASE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/manifest.rgba8.json`);
    expect(m.resolvedManifestFilename(BASE)).toBe('manifest.rgba8.json');
  });

  it('follows the format manifest the game itself fetched', async () => {
    page.entries = [{ name: `${BASE}/manifest.bc7.json` }];
    const m = await loadModule();
    await m.getAssetManifest(BASE);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/manifest.bc7.json`);
    expect(m.resolvedManifestFilename(BASE)).toBe('manifest.bc7.json');
  });

  it('never requests the removed plain manifest.json', async () => {
    const m = await loadModule();
    expect(m.resolvedManifestFilename(BASE)).not.toBe('manifest.json');
    await m.getAssetManifest(BASE);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/manifest.json'))).toBe(false);
  });

  it('shares one in-flight lookup between concurrent callers', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 404, text: async () => '' }));
    const m = await loadModule();
    const results = await Promise.allSettled([m.getAssetManifest(BASE), m.getAssetManifest(BASE), m.getAssetManifest(BASE)]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await m.getAssetManifest(BASE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
