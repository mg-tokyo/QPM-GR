// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../../../i18n', () => ({
  t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
  formatRelativeTime: (value: number, unit: string) => `${value} ${unit}`,
}));
vi.mock('../../../ui/components', async () => ({
  createButton: (await import('../../../ui/components/button')).createButton,
  createProgressBar: (await import('../../../ui/components/progressBar')).createProgressBar,
  createSectionHeader: (await import('../../../ui/components/sectionHeader')).createSectionHeader,
  createCurrencyAmount: (currency: string, amount: number) => {
    const el = document.createElement('span');
    el.dataset.currency = currency;
    el.textContent = String(amount);
    return el;
  },
}));
vi.mock('../../bloblingCustomiser', () => ({ COLOR_HEX: { Black: '#1a1a1a' } }));

import type { SeatedPlayer } from '../players';
import { createSpectatorStore, type SpectatorStore } from '../state';
import { mountInfoCard, type CardCatalog, type InfoCard, type InfoCardSource } from './infoCard';

const NOW = 2_000_000_000_000;
let spritesReady = true;
const readyCbs = new Set<() => void>();
const catalog: CardCatalog = {
  onReady: (cb) => { readyCbs.add(cb); return () => { readyCbs.delete(cb); }; },
  itemName: (id) => ({ Lily: 'Lily Seed', RareEgg: 'Rare Egg' }[id] ?? null),
  petName: (sp) => sp,
  cropName: (sp) => sp,
  plantName: (sp) => `${sp} Plant`,
  abilityName: (id) => (id === 'HungerRestoreII' ? 'Hunger Restore II' : null),
  hungerCap: (sp) => (sp === 'Turtle' ? 100_000 : null),
  ready: () => spritesReady,
  petSprite: (sp, m) => (spritesReady ? `data:pet/${sp}/${m.join('+')}` : ''),
  cropSprite: (sp, m) => `data:crop/${sp}/${m.join('+')}`,
  plantSprite: (sp, m) => `data:plant/${sp}/${m.map((x) => x.join('+')).join('|')}`,
  itemSprite: (id) => `data:item/${id}`,
  abilityColour: (id) => (id === 'HungerRestoreII' ? 'rgb(1, 2, 3)' : 'rgb(9, 9, 9)'),
};

const player = (id: string, over: Partial<SeatedPlayer> = {}): SeatedPlayer => ({
  id, name: id.toUpperCase(), seat: 2, online: true, colour: 'Black', discordAvatarUrl: null, lastAction: null, ...over,
});
const turtle = { id: 't1', petSpecies: 'Turtle', name: null, hunger: 50_000, mutations: ['Rainbow'], abilities: ['HungerRestoreII', 'Other'] };
const slotFor = (id: string, over: Record<string, unknown> = {}) => ({
  userId: id, riddenPetId: null, heldItem: { itemId: 'Lily' },
  data: {
    coinsCount: 1234, magicDustCount: 56, petSlots: [turtle], inventory: { items: [] },
    activityLogs: [{ action: 'purchaseEgg', parameters: { eggIds: ['RareEgg'] }, timestamp: NOW - 12_300 }],
  },
  ...over,
});

let store: SpectatorStore;
let players: Map<string, SeatedPlayer>;
let slots: Map<string, unknown>;
let watchers: Set<() => void>;
let slotReads: number;
let hidden: boolean;
let card: InfoCard | null;

function source(): InfoCardSource {
  return {
    player: (id) => players.get(id) ?? null,
    slot: (id) => { slotReads++; return slots.get(id) ?? null; },
    watch: (cb) => { watchers.add(cb); return () => { watchers.delete(cb); }; },
    catalog,
    closeKey: () => 'I',
    hidden: () => hidden,
    setHidden: (h) => { hidden = h; },
  };
}

const cardEl = (): HTMLElement | null => document.querySelector('.qpm-spec-card');
const text = (sel: string): string => cardEl()?.querySelector(sel)?.textContent ?? '';
const follow = (id: string): void => { store.patch({ active: true, mode: 'follow', targetId: id }); };
const emit = (): void => { for (const cb of [...watchers]) cb(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mem.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  store = createSpectatorStore();
  players = new Map([['b', player('b')], ['c', player('c', { seat: 4, name: 'Cee' })]]);
  slots = new Map<string, unknown>([['b', slotFor('b')], ['c', slotFor('c', { heldItem: { itemId: null } })]]);
  watchers = new Set();
  slotReads = 0;
  hidden = false;
  spritesReady = true;
  card = mountInfoCard(store, source());
});

afterEach(() => {
  card?.destroy();
  vi.useRealTimers();
});

describe('when the card shows', () => {
  it('only while following someone', () => {
    store.patch({ active: true });
    expect(cardEl()).toBeNull();
    follow('b');
    expect(text('.qpm-spec-card-name')).toBe('B');
    store.patch({ mode: 'free', targetId: null });
    expect(cardEl()).toBeNull();
    expect(watchers.size).toBe(0);
  });

  it('hides with the bar (H, a game window) and comes back', () => {
    follow('b');
    store.patch({ uiHidden: true });
    expect(cardEl()).toBeNull();
    store.patch({ uiHidden: false, paused: 'ui' });
    expect(cardEl()).toBeNull();
    store.patch({ paused: 'cutscene' });
    expect(cardEl()).not.toBeNull();
  });

  it('I and × hide it until I brings it back, and the choice is kept by the source', () => {
    follow('b');
    card?.toggle();
    expect(cardEl()).toBeNull();
    expect(hidden).toBe(true);
    card?.toggle();
    expect(cardEl()).not.toBeNull();
    cardEl()?.querySelector<HTMLButtonElement>('.qpm-spec-card-x')?.click();
    expect(cardEl()).toBeNull();
    expect(hidden).toBe(true);
  });

  it('in free cam, I never hides a card nobody can see, but brings a hidden one back for the next follow', () => {
    store.patch({ active: true });
    card?.toggle();
    expect(hidden).toBe(false);
    hidden = true;
    card?.toggle();
    expect(hidden).toBe(false);
    follow('b');
    expect(cardEl()).not.toBeNull();
  });

  it('switches to the new player when the target changes, and drops a picture it can no longer match', () => {
    players.set('b', player('b', { discordAvatarUrl: 'https://cdn/b.png' }));
    follow('b');
    expect(cardEl()?.querySelector('.qpm-spec-card-hd img')?.getAttribute('src')).toBe('https://cdn/b.png');
    follow('c');
    expect(text('.qpm-spec-card-name')).toBe('Cee');
    expect(text('.qpm-spec-card-held')).toBe('feature.spectator.card.empty');
    players.delete('b');
    slots.set('b', slotFor('b'));
    follow('b');
    expect(text('.qpm-spec-card-name')).toBe('b');
    expect(cardEl()?.querySelector('.qpm-spec-card-hd img')).toBeNull();
  });
});

describe('content', () => {
  it('a held potted plant is drawn by the plant stitcher with each slot\'s mutations', () => {
    const plant = { id: 'g1', itemType: 'Plant', species: 'Grape', slots: [{ mutations: ['Wet'] }, { mutations: [] }] };
    slots.set('b', slotFor('b', { heldItem: { itemId: 'g1' }, data: { inventory: { items: [plant] } } }));
    follow('b');
    expect(text('.qpm-spec-card-held')).toBe('feature.spectator.card.holding {"item":"Grape Plant"}');
    expect(cardEl()?.querySelector('.qpm-spec-card-held img')?.getAttribute('src')).toBe('data:plant/Grape/Wet|');
  });

  it('header, pets with mutations, ability colours and hunger, held item, lines and currencies', () => {
    slots.set('b', slotFor('b', { riddenPetId: 't1' }));
    follow('b');
    expect(text('.qpm-spec-card-sub')).toBe('feature.spectator.card.online · feature.spectator.list.seat {"n":2} · feature.spectator.card.riding {"name":"Turtle"}');
    const pet = cardEl()?.querySelector<HTMLElement>('.qpm-spec-card-pet');
    expect(pet?.querySelector('img')?.getAttribute('src')).toBe('data:pet/Turtle/Rainbow');
    expect(pet?.title).toBe('feature.spectator.card.petHunger {"name":"Turtle","pct":50}');
    const squares = [...(pet?.querySelectorAll<HTMLElement>('.qpm-spec-card-ab') ?? [])];
    expect(squares.map((s) => s.style.background)).toEqual(['rgb(1, 2, 3)', 'rgb(9, 9, 9)']);
    expect(squares[0]?.title).toBe('Hunger Restore II');
    expect(text('.qpm-spec-card-held')).toBe('feature.spectator.card.holding {"item":"Lily Seed"}');
    expect(cardEl()?.querySelector('.qpm-spec-card-held img')?.getAttribute('src')).toBe('data:item/Lily');
    expect(text('.qpm-spec-card-line')).toBe('Purchase egg · Rare Egg-12 second');
    expect([...(cardEl()?.querySelectorAll<HTMLElement>('[data-currency]') ?? [])].map((e) => `${e.dataset.currency}:${e.textContent}`))
      .toEqual(['coins:1234', 'magicDust:56']);
  });

  it('empty states and a generic line for an action it cannot name', () => {
    slots.set('b', slotFor('b', { data: { petSlots: [], activityLogs: [{ action: 7, timestamp: NOW - 1000 }] } }));
    follow('b');
    expect(text('.qpm-spec-card-pets')).toBe('feature.spectator.card.noPets');
    expect(text('.qpm-spec-card-line')).toBe('feature.spectator.card.activity-1 second');
    slots.set('b', slotFor('b', { data: { petSlots: [], activityLogs: [] } }));
    vi.advanceTimersByTime(250);
    emit();
    expect(text('.qpm-spec-card-lines')).toBe('feature.spectator.list.noActivity');
  });

  it('an offline player reads as offline', () => {
    players.set('b', player('b', { online: false }));
    follow('b');
    expect(text('.qpm-spec-card-sub')).toBe('feature.spectator.list.offline · feature.spectator.list.seat {"n":2}');
  });
});

describe('updates', () => {
  it('renders at most once per 250 ms however often the game state changes', () => {
    follow('b');
    const after = slotReads;
    for (let i = 0; i < 10; i++) { emit(); vi.advanceTimersByTime(20); }
    expect(slotReads - after).toBe(0);
    vi.advanceTimersByTime(60);
    expect(slotReads - after).toBe(1);
    vi.advanceTimersByTime(250);
    expect(slotReads - after).toBe(1);
  });

  it('rewrites a time label the moment it would read differently, without reading the game state', () => {
    follow('b');
    const after = slotReads;
    vi.advanceTimersByTime(699);
    expect(text('.qpm-spec-card-when')).toBe('-12 second');
    vi.advanceTimersByTime(1);
    expect(text('.qpm-spec-card-when')).toBe('-13 second');
    expect(slotReads).toBe(after);
  });

  it('a change elsewhere in the room leaves the card\'s nodes alone; a change in this slot updates only what changed', () => {
    follow('b');
    const line = cardEl()?.querySelector('.qpm-spec-card-line');
    const pet = cardEl()?.querySelector('.qpm-spec-card-pet');
    const before = slotFor('b');
    slots.set('b', { ...(slots.get('b') as object) });
    vi.advanceTimersByTime(300);
    emit();
    expect(cardEl()?.querySelector('.qpm-spec-card-line')).toBe(line);
    slots.set('b', { ...before, data: { ...before.data, coinsCount: 99 } });
    vi.advanceTimersByTime(300);
    emit();
    expect(cardEl()?.querySelector('[data-currency="coins"]')?.textContent).toBe('99');
    expect(cardEl()?.querySelector('.qpm-spec-card-line')).toBe(line);
    expect(cardEl()?.querySelector('.qpm-spec-card-pet')).toBe(pet);
  });

  it('crossing the compact breakpoint opens the card afresh with one line, and stops listening when it closes', () => {
    const listeners = new Set<() => void>();
    const mql = {
      matches: false,
      addEventListener: (_t: string, cb: () => void) => { listeners.add(cb); },
      removeEventListener: (_t: string, cb: () => void) => { listeners.delete(cb); },
    };
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => mql });
    try {
      const logs = [1, 2, 3].map((i) => ({ action: 'purchaseEgg', parameters: {}, timestamp: NOW - i * 60_000 }));
      slots.set('b', slotFor('b', { data: { ...slotFor('b').data, activityLogs: logs } }));
      follow('b');
      expect(cardEl()?.querySelectorAll('.qpm-spec-card-line')).toHaveLength(3);
      const first = cardEl();
      mql.matches = true;
      for (const cb of [...listeners]) cb();
      expect(cardEl()).not.toBe(first);
      expect(cardEl()?.querySelectorAll('.qpm-spec-card-line')).toHaveLength(1);
      expect(listeners.size).toBe(1);
      store.patch({ mode: 'free', targetId: null });
      expect(listeners.size).toBe(0);
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('draws the sprites and names once sprites and catalogs are ready, and only waits for that while they are not', () => {
    spritesReady = false;
    follow('b');
    expect(cardEl()?.querySelector('.qpm-spec-card-pet img')).toBeNull();
    expect(readyCbs.size).toBe(1);
    spritesReady = true;
    vi.advanceTimersByTime(300);
    for (const cb of [...readyCbs]) cb();
    expect(cardEl()?.querySelector('.qpm-spec-card-pet img')?.getAttribute('src')).toBe('data:pet/Turtle/Rainbow');
    store.patch({ mode: 'free', targetId: null });
    expect(readyCbs.size).toBe(0);
    follow('b');
    expect(readyCbs.size).toBe(0);
  });
});

describe('destroy', () => {
  it('leaves no node, listener, timer or sheet, keeps the card spot, and is idempotent', () => {
    follow('b');
    emit();
    card?.destroy();
    card?.destroy();
    expect(cardEl()).toBeNull();
    expect(watchers.size).toBe(0);
    expect(document.getElementById('qpm-spectator-styles')).toBeNull();
    const reads = slotReads;
    vi.advanceTimersByTime(5000);
    expect(slotReads).toBe(reads);
    expect((mem.get('qpm.spectator.infoCard.v1') as { cards: Array<{ key: string }> }).cards.map((c) => c.key)).toEqual(['spectator-info']);
    store.patch({ uiHidden: true });
    store.patch({ uiHidden: false });
    expect(cardEl()).toBeNull();
    card = null;
  });
});
