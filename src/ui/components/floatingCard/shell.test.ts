// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));

import { getOpenFloatingCards, openFloatingCard } from './shell';
import type { PersistedFloatingCardsState } from './types';

// The shell's registry outlives a test: each test gets its own storage key and closes what it opened.
let KEY = '';
let n = 0;
const stored = (): PersistedFloatingCardsState['cards'] => (mem.get(KEY) as PersistedFloatingCardsState | undefined)?.cards ?? [];
const open = (key: string, retainPosition?: boolean) => openFloatingCard({
  key, persistKey: KEY, header: document.createElement('div'), body: document.createElement('div'),
  defaultPosition: { xPct: 0.25, yPct: 0.5 }, ...(retainPosition === undefined ? {} : { retainPosition }),
});

beforeEach(() => {
  mem.clear();
  KEY = `qpm.test.cards.${++n}`;
});

afterEach(() => {
  for (const c of getOpenFloatingCards()) c.destroy();
  document.body.innerHTML = '';
});

describe('openFloatingCard persistence', () => {
  it('drops a closed card from storage by default (storage lists the open cards)', () => {
    open('a').destroy();
    expect(stored()).toEqual([]);
  });

  it('keeps a closed card\'s spot with retainPosition, beside the cards still open', () => {
    const a = open('a', true);
    open('b');
    a.destroy();
    expect(stored()).toEqual([{ key: 'b', xPct: 0.25, yPct: 0.5 }, { key: 'a', xPct: 0.25, yPct: 0.5 }]);
  });

  it('a retained card that opens again is stored once', () => {
    open('a', true).destroy();
    open('a', true);
    expect(stored()).toEqual([{ key: 'a', xPct: 0.25, yPct: 0.5 }]);
  });

  it('opens a retained card where it was stored by an earlier page', () => {
    mem.set(KEY, { cards: [{ key: 'r', xPct: 0.9, yPct: 0.1 }], updatedAt: 1 });
    open('r', true).destroy();
    expect(stored()).toEqual([{ key: 'r', xPct: 0.9, yPct: 0.1 }]);
  });
});
