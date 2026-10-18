// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({
  t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
  formatRelativeTime: (value: number, unit: string) => `${value} ${unit}`,
}));
vi.mock('../../../ui/components', async () => ({
  createButton: (await import('../../../ui/components/button')).createButton,
  createEmptyState: (await import('../../../ui/components/emptyState')).createEmptyState,
}));
vi.mock('../../bloblingCustomiser', () => ({ COLOR_HEX: { Black: '#1a1a1a' } }));

import type { SeatedPlayer } from '../players';
import { createSpectatorStore, initialSpectatorState, type SpectatorStore } from '../state';
import { mountBar, type BarActions, type SpectatorBar } from './bar';

const player = (id: string, over: Partial<SeatedPlayer> = {}): SeatedPlayer => ({
  id, name: id.toUpperCase(), seat: 2, online: true, colour: 'Black', discordAvatarUrl: null,
  lastAction: { action: 'plantSeed', at: Date.now() - 12_000 }, ...over,
});

let store: SpectatorStore;
let roster: SeatedPlayer[];
let rosterSubs: Set<(l: readonly SeatedPlayer[]) => void>;
let calls: string[];
let hotbarTop: number | null;
let bar: SpectatorBar | null;

function actions(extra: Partial<BarActions> = {}): BarActions {
  return {
    players: () => roster,
    onPlayers: (cb) => { rosterSubs.add(cb); return () => { rosterSubs.delete(cb); }; },
    follow: (id) => { calls.push(`follow:${id}`); store.patch({ mode: 'follow', targetId: id }); },
    cycle: (dir) => { calls.push(`cycle:${dir}`); },
    exit: () => { calls.push('exit'); },
    exitKey: () => 'G',
    hotbarTop: () => hotbarTop,
    ...extra,
  };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const barEl = (): HTMLElement => q('.qpm-spec-bar')!;
const buttons = (): HTMLButtonElement[] => [...barEl().querySelectorAll<HTMLButtonElement>(':scope > button')];
const byLabel = (key: string): HTMLButtonElement | undefined => buttons().find((b) => b.getAttribute('aria-label')?.startsWith(key));
const press = (el: Element): void => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); (el as HTMLElement).click(); };
const setRoster = (list: SeatedPlayer[]): void => { roster = list; for (const cb of [...rosterSubs]) cb(list); };

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  store = createSpectatorStore();
  roster = [player('b'), player('c', { seat: 4, online: false })];
  rosterSubs = new Set();
  calls = [];
  hotbarTop = 504;
  bar = mountBar(store, actions());
  store.patch({ ...initialSpectatorState(), active: true });
});

afterEach(() => {
  bar?.destroy();
  vi.useRealTimers();
});

describe('spectator bar', () => {
  it('is hidden until spectating, then shows the mode, the switcher and Exit with the toggle key', () => {
    bar?.destroy();
    store = createSpectatorStore();
    bar = mountBar(store, actions());
    expect(barEl().hidden).toBe(true);
    store.patch({ active: true });
    expect(barEl().hidden).toBe(false);
    expect(q('.qpm-spec-chip')?.textContent).toBe('feature.spectator.bar.free · 2D');
    expect(byLabel('feature.spectator.bar.players')?.textContent).toBe('feature.spectator.bar.choose');
    expect(byLabel('feature.spectator.bar.exit')?.getAttribute('aria-label')).toBe('feature.spectator.bar.exit {"key":"G"}');
    expect(q('#qpm-spectator-styles')).not.toBeNull();
  });

  it('Exit\'s key label follows a rebind at once, and destroy stops listening', () => {
    bar?.destroy();
    let key = 'G';
    const subs = new Set<() => void>();
    bar = mountBar(store, actions({ exitKey: () => key, onKeys: (cb) => { subs.add(cb); return () => { subs.delete(cb); }; } }));
    key = 'K';
    for (const cb of subs) cb();
    expect(byLabel('feature.spectator.bar.exit')?.getAttribute('aria-label')).toBe('feature.spectator.bar.exit {"key":"K"}');
    bar.destroy();
    expect(subs.size).toBe(0);
  });

  // Live 1448: the hotbar springs into place over ~360 ms after a resize (772 → 491 → 504).
  it('sits 8 px above the hotbar, and measures again once a resize has settled', () => {
    vi.advanceTimersByTime(500);
    expect(barEl().style.bottom).toBe(`${window.innerHeight - 504 + 8}px`);
    hotbarTop = 400;
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(499);
    expect(barEl().style.bottom).toBe(`${window.innerHeight - 504 + 8}px`);
    vi.advanceTimersByTime(1);
    expect(barEl().style.bottom).toBe(`${window.innerHeight - 400 + 8}px`);
  });

  // Live 1448: the expanded inventory's panel springs back over ~360 ms after it closes, from top 170 to 504.
  it('back from a game window it keeps its spot, then measures once the hotbar has sprung back', () => {
    const rest = `${window.innerHeight - 504 + 8}px`;
    store.patch({ paused: 'ui' });
    hotbarTop = 170;
    store.patch({ paused: null });
    expect(barEl().style.bottom).toBe(rest);
    hotbarTop = 504;
    vi.advanceTimersByTime(500);
    expect(barEl().style.bottom).toBe(rest);
    hotbarTop = 400;
    store.patch({ uiHidden: true });
    store.patch({ uiHidden: false });
    vi.advanceTimersByTime(499);
    expect(barEl().style.bottom).toBe(rest);
    vi.advanceTimersByTime(1);
    expect(barEl().style.bottom).toBe(`${window.innerHeight - 400 + 8}px`);
  });

  it('names the followed player; the arrows cycle; with nobody seated they are off', () => {
    store.patch({ mode: 'follow', targetId: 'b' });
    expect(q('.qpm-spec-name')?.textContent).toBe('B');
    expect(barEl().querySelector('.qpm-spec-av')).not.toBeNull();
    byLabel('feature.spectator.bar.next')?.click();
    byLabel('feature.spectator.bar.prev')?.click();
    expect(calls).toEqual(['cycle:1', 'cycle:-1']);
    store.patch({ mode: 'free', targetId: null });
    setRoster([]);
    expect(q('.qpm-spec-name')?.textContent).toBe('feature.spectator.bar.nobody');
    expect(byLabel('feature.spectator.bar.next')?.disabled).toBe(true);
    setRoster([player('b')]);
    expect(byLabel('feature.spectator.bar.next')?.disabled).toBe(false);
  });

  it('says Paused while the game has the camera; H and a game window hide the bar', () => {
    store.patch({ paused: 'cutscene' });
    const chip = q('.qpm-spec-chip')!;
    expect(chip.textContent).toBe('feature.spectator.bar.paused');
    expect(chip.hasAttribute('data-paused')).toBe(true);
    expect(chip.title).toBe('feature.spectator.bar.pausedHint');
    expect(barEl().hidden).toBe(false);
    store.patch({ paused: 'ui' });
    expect(barEl().hidden).toBe(true);
    store.patch({ paused: null, uiHidden: true });
    expect(barEl().hidden).toBe(true);
    store.patch({ uiHidden: false });
    expect(barEl().hidden).toBe(false);
  });

  it('the name opens the player list; a row follows and closes it; offline rows are off', () => {
    press(byLabel('feature.spectator.bar.players')!);
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.qpm-spec-pop .qpm-spec-row')];
    expect(rows.map((r) => r.dataset.playerId)).toEqual(['b', 'c']);
    expect(rows[0]?.querySelector('.qpm-spec-row-sub')?.textContent).toBe('feature.spectator.list.activity {"action":"Plant seed","ago":"-12 second"}');
    expect(rows[1]?.disabled).toBe(true);
    expect(rows[1]?.querySelector('.qpm-spec-row-sub')?.textContent).toBe('feature.spectator.list.offline');
    expect(rows[0]?.querySelector('.qpm-spec-row-seat')?.textContent).toBe('feature.spectator.list.seat {"n":2}');
    press(rows[0]!);
    expect(calls).toEqual(['follow:b']);
    expect(q('.qpm-spec-pop')).toBeNull();
  });

  it('the open list follows the roster and the target; outside presses, the name again, a game window and Esc close it', () => {
    const name = byLabel('feature.spectator.bar.players')!;
    press(name);
    setRoster([player('b'), player('d', { seat: 5 })]);
    expect([...document.querySelectorAll<HTMLElement>('.qpm-spec-row')].map((r) => r.dataset.playerId)).toEqual(['b', 'd']);
    store.patch({ mode: 'follow', targetId: 'd' });
    expect(q('.qpm-spec-row[data-player-id="d"]')?.getAttribute('aria-current')).toBe('true');
    press(q('.qpm-spec-pop')!);
    expect(q('.qpm-spec-pop')).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(q('.qpm-spec-pop')).toBeNull();
    press(name);
    press(name);
    expect(q('.qpm-spec-pop')).toBeNull();
    press(name);
    store.patch({ paused: 'ui' });
    expect(q('.qpm-spec-pop')).toBeNull();
    store.patch({ paused: null });
    press(name);
    expect(bar?.closePopover()).toBe(true);
    expect(bar?.closePopover()).toBe(false);
  });

  // A player acting re-emits the roster (lastAction.at): rows must survive it, or a press across the rebuild is lost.
  it('the open list updates its rows in place; only a changed picture is swapped', () => {
    setRoster([player('b', { discordAvatarUrl: 'https://cdn.example/b.png' }), player('c', { seat: 4, online: false })]);
    press(byLabel('feature.spectator.bar.players')!);
    const row = q<HTMLButtonElement>('.qpm-spec-row[data-player-id="b"]')!;
    const img = row.querySelector('img');
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    setRoster([player('b', { discordAvatarUrl: 'https://cdn.example/b.png', lastAction: { action: 'harvest', at: Date.now() - 2_000 } }), player('c', { seat: 4 })]);
    expect(q('.qpm-spec-row[data-player-id="b"]')).toBe(row);
    expect(row.querySelector('img')).toBe(img);
    expect(row.querySelector('.qpm-spec-row-sub')?.textContent).toBe('feature.spectator.list.activity {"action":"Harvest","ago":"-2 second"}');
    expect(q<HTMLButtonElement>('.qpm-spec-row[data-player-id="c"]')?.disabled).toBe(false);
    setRoster([player('b', { discordAvatarUrl: 'https://cdn.example/b2.png' }), player('c', { seat: 4 })]);
    expect(row.querySelector('img')).not.toBe(img);
    row.click();
    expect(calls).toEqual(['follow:b']);
  });

  it('the Director button shows the director state, whoever turned it on or off', () => {
    bar?.destroy();
    bar = mountBar(store, actions({ director: () => { store.patch({ director: !store.get().director }); } }));
    store.patch({ active: true });
    const pressed = (): string | null | undefined => byLabel('feature.spectator.bar.director')?.getAttribute('aria-pressed');
    expect(pressed()).toBe('false');
    byLabel('feature.spectator.bar.director')?.click();
    expect(pressed()).toBe('true');
    store.patch({ director: false });
    expect(pressed()).toBe('false');
  });

  it('an empty roster shows the empty state', () => {
    setRoster([]);
    press(byLabel('feature.spectator.bar.players')!);
    expect(q('.qpm-spec-pop')?.textContent).toBe('feature.spectator.list.empty');
  });

  it('Director, Waypoints and Photo appear only once a later task hands them in', () => {
    expect(byLabel('feature.spectator.bar.director')).toBeUndefined();
    expect(byLabel('feature.spectator.bar.photo')).toBeUndefined();
    bar?.destroy();
    bar = mountBar(store, actions({ director: () => { calls.push('director'); }, photo: () => { calls.push('photo'); } }));
    const labels = (): string[] => buttons().map((b) => (b.getAttribute('aria-label') ?? '').split(' ')[0]!);
    expect(labels().slice(-3)).toEqual(['feature.spectator.bar.director', 'feature.spectator.bar.photo', 'feature.spectator.bar.exit']);
    byLabel('feature.spectator.bar.director')?.click();
    store.patch({ director: true });
    expect(byLabel('feature.spectator.bar.director')?.getAttribute('aria-pressed')).toBe('true');
    byLabel('feature.spectator.bar.director')?.click();
    expect(calls).toEqual(['director', 'director']);
    const menu = document.createElement('div');
    menu.dataset.test = 'menu';
    bar.setWaypointsMenu(menu);
    expect(labels().slice(-4)).toEqual([
      'feature.spectator.bar.director', 'feature.spectator.bar.waypoints', 'feature.spectator.bar.photo', 'feature.spectator.bar.exit',
    ]);
    press(byLabel('feature.spectator.bar.waypoints')!);
    expect(q('.qpm-spec-pop > [data-test="menu"]')).toBe(menu);
    bar.setWaypointsMenu(null);
    expect(q('.qpm-spec-pop')).toBeNull();
    expect(byLabel('feature.spectator.bar.waypoints')).toBeUndefined();
  });

  it('the Waypoints popover tells its menu before it goes, however it closes (an outside press, Esc, the menu taken away)', () => {
    const menu = document.createElement('div');
    const closes: string[] = [];
    bar?.setWaypointsMenu(menu, () => { closes.push(menu.isConnected ? 'connected' : 'removed'); });
    store.patch({ active: true });
    const open = (): void => { press(byLabel('feature.spectator.bar.waypoints')!); };
    open();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    open();
    expect(bar?.closePopover()).toBe(true);
    open();
    bar?.setWaypointsMenu(null);
    expect(q('.qpm-spec-pop')).toBeNull();
    expect(closes).toEqual(['connected', 'connected', 'connected']);
    // The player list has no close hook.
    press(byLabel('feature.spectator.bar.players')!);
    bar?.closePopover();
    expect(closes).toHaveLength(3);
  });

  it('Exit asks to leave; destroy removes every node, listener and the sheet, and twice is harmless', () => {
    byLabel('feature.spectator.bar.exit')?.click();
    expect(calls).toEqual(['exit']);
    press(byLabel('feature.spectator.bar.players')!);
    window.dispatchEvent(new Event('resize'));
    press(byLabel('feature.spectator.bar.players')!);
    const off = vi.spyOn(window, 'removeEventListener');
    bar?.destroy();
    bar?.destroy();
    expect(q('.qpm-spec-bar')).toBeNull();
    expect(q('.qpm-spec-pop')).toBeNull();
    expect(q('#qpm-spectator-styles')).toBeNull();
    expect(rosterSubs.size).toBe(0);
    expect(off.mock.calls.map((c) => c[0]).sort()).toEqual(['pointerdown', 'resize']);
    expect(vi.getTimerCount()).toBe(0);
    store.patch({ paused: 'cutscene' });
    expect(q('.qpm-spec-bar')).toBeNull();
  });
});
