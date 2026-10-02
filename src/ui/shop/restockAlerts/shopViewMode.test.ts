import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../core/playerContext', () => ({ getPlayerIdSync: () => null }));

import { defaultShopViewMode, resolveShopViewMode } from './shopViewMode';

// Golden values captured from the live game's `shop-view-default-v1` assignVariant (v1294).
const GAME_DEFAULTS: Record<string, 'list' | 'grid'> = {
  '511094276613210122': 'list',
  p1: 'grid',
  p2: 'grid',
  abc: 'list',
  '123456789012345678': 'grid',
  'player-xyz': 'list',
  zzz: 'grid',
};

function stubLocalStorage(entries: Record<string, string>): void {
  vi.stubGlobal('localStorage', { getItem: (k: string) => entries[k] ?? null });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('defaultShopViewMode', () => {
  it('matches the game variant assignment', () => {
    for (const [playerId, expected] of Object.entries(GAME_DEFAULTS)) {
      expect(defaultShopViewMode(playerId)).toBe(expected);
    }
  });
});

describe('resolveShopViewMode', () => {
  it('prefers the persisted per-shop toggle', () => {
    stubLocalStorage({ 'shop:abc:seed:viewMode': '"grid"' });
    expect(resolveShopViewMode('seed', 'abc')).toBe('grid');
    expect(resolveShopViewMode('egg', 'abc')).toBe('list');
  });

  it('ignores an invalid persisted value', () => {
    stubLocalStorage({ 'shop:p1:seed:viewMode': '"tiles"' });
    expect(resolveShopViewMode('seed', 'p1')).toBe('grid');
  });

  it('falls back to list without a player id', () => {
    stubLocalStorage({});
    expect(resolveShopViewMode('seed', null)).toBe('list');
  });
});
