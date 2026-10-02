import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubResources(urls: string[]): void {
  vi.stubGlobal('performance', { getEntriesByType: () => urls.map((name) => ({ name })) });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCapturedBuildId', () => {
  it('returns the /version/{build} segment', async () => {
    stubResources(['https://magicgarden.gg/version/1361/assets/index-abc.js']);
    const { getCapturedBuildId } = await import('./gameVersionCapture');
    expect(getCapturedBuildId()).toBe('1361');
  });

  it('is null when only the last-resort unparsed URL is available', async () => {
    stubResources(['https://magicgarden.gg/assets/index-abc.js']);
    const { getCapturedBuildId, getCapturedGameVersion } = await import('./gameVersionCapture');
    expect(getCapturedGameVersion()).toMatch(/^\(unparsed: /);
    expect(getCapturedBuildId()).toBeNull();
  });

  it('is null before any asset has loaded', async () => {
    stubResources([]);
    const { getCapturedBuildId } = await import('./gameVersionCapture');
    expect(getCapturedBuildId()).toBeNull();
  });
});
