import { beforeEach, describe, expect, it, vi } from 'vitest';

function fakeWindow(hasCanvas: boolean, globals: Record<string, unknown> = {}): Window {
  return {
    document: { querySelector: () => (hasCanvas ? {} : null) },
    ...globals,
  } as unknown as Window;
}

let findPageReach: typeof import('./pageReach').findPageReach;

beforeEach(async () => {
  vi.stubGlobal('window', {});
  vi.resetModules();
  ({ findPageReach } = await import('./pageReach'));
});

describe('findPageReach', () => {
  it('sees the page when either game global is present', () => {
    expect(findPageReach(fakeWindow(true, { jotaiAtomCache: { cache: new Map() } }))).toBe('page');
    expect(findPageReach(fakeWindow(true, { __jotaiStore: {} }))).toBe('page');
  });

  it('reports unreachable when the game rendered but its globals are not visible', () => {
    expect(findPageReach(fakeWindow(true, { __qpmJotaiAtomCache__: {} }))).toBe('unreachable');
  });

  it('cannot decide before the game canvas exists', () => {
    expect(findPageReach(fakeWindow(false))).toBe('unknown');
  });

  it('cannot decide when the DOM read throws', () => {
    const broken = { document: { querySelector: () => { throw new Error('denied'); } } } as unknown as Window;
    expect(findPageReach(broken)).toBe('unknown');
  });
});
