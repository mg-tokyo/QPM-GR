import { describe, expect, it } from 'vitest';
import { matchesPathPrefix } from './pathMatcher';

describe('matchesPathPrefix', () => {
  it('matches exact and segment-boundary prefixes only', () => {
    expect(matchesPathPrefix('/child/data/shops', '/child/data/shops', null)).toBe(true);
    expect(matchesPathPrefix('/child/data/shops/seed', '/child/data/shops', null)).toBe(true);
    expect(matchesPathPrefix('/child/data/shopsX', '/child/data/shops', null)).toBe(false);
  });
  it('substitutes {myIdx} and refuses to match while unresolved', () => {
    const prefix = '/child/data/userSlots/{myIdx}/data/inventory';
    expect(matchesPathPrefix('/child/data/userSlots/2/data/inventory/items/0', prefix, 2)).toBe(true);
    expect(matchesPathPrefix('/child/data/userSlots/2/data/inventory/items/0', prefix, 3)).toBe(false);
    expect(matchesPathPrefix('/child/data/userSlots/2/data/inventory/items/0', prefix, null)).toBe(false);
  });
  it('treats the empty prefix as match-all', () => {
    expect(matchesPathPrefix('/anything', '', null)).toBe(true);
  });
});
