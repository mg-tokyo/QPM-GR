import { describe, expect, it } from 'vitest';
import { hasMyIdxPlaceholder, matchesPathPrefix } from './pathMatcher';

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
  it('matches a patch at an ANCESTOR of the subscribed subtree (seat fill replaces the slot)', () => {
    const prefix = '/child/data/userSlots/{myIdx}/data/petTeams';
    expect(matchesPathPrefix('/child/data/userSlots/2', prefix, 2)).toBe(true);
    expect(matchesPathPrefix('/child/data/userSlots', prefix, 2)).toBe(true);
    expect(matchesPathPrefix('', prefix, 2)).toBe(true);                       // root replace
    expect(matchesPathPrefix('/child/data/userSlots/3', prefix, 2)).toBe(false); // another seat
    expect(matchesPathPrefix('/child/data/userSlot', prefix, 2)).toBe(false);   // segment boundary
    expect(matchesPathPrefix('/child/data/userSlots/2/data/petTeamsX', prefix, 2)).toBe(false);
  });
});

describe('hasMyIdxPlaceholder', () => {
  it('detects the {myIdx} placeholder', () => {
    expect(hasMyIdxPlaceholder('/child/data/userSlots/{myIdx}/data')).toBe(true);
    expect(hasMyIdxPlaceholder('/child/data/shops')).toBe(false);
  });
});
