// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({
  t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
  formatRelativeTime: () => '',
}));
vi.mock('../../../ui/components', async () => ({
  createButton: (await import('../../../ui/components/button')).createButton,
  createEmptyState: (await import('../../../ui/components/emptyState')).createEmptyState,
}));
vi.mock('../../bloblingCustomiser', () => ({ COLOR_HEX: {} }));

import { WAYPOINT_CAP, type Waypoint } from '../waypoints';
import { createWaypointMenu, type WaypointMenu, type WaypointMenuSource } from './waypointMenu';

const wp = (id: string, name = id.toUpperCase()): Waypoint => ({ id, name, x: 1, y: 2, alt: 64, view: '2d', yaw: 0, pitch: 0 });

let list: Waypoint[];
let current: string | null;
let calls: string[];
let menu: WaypointMenu;

function source(): WaypointMenuSource {
  return {
    list: () => list,
    currentId: () => current,
    saveKey: () => 'B',
    fly: (id) => { calls.push(`fly:${id}`); },
    save: () => { calls.push('save'); },
    rename: (id, name) => {
      calls.push(`rename:${id}:${name}`);
      list = list.map((w) => (w.id === id && name.trim() ? { ...w, name: name.trim() } : w));
      menu.render();
    },
    remove: (id) => { calls.push(`remove:${id}`); },
  };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => menu.el.querySelector<T>(sel);
const rows = (): HTMLElement[] => [...menu.el.querySelectorAll<HTMLElement>('.qpm-spec-wp-row')];
const row = (id: string): HTMLElement => rows().find((r) => r.dataset.wpId === id)!;
const nameOf = (r: HTMLElement): string => r.querySelector('.qpm-spec-wp-name')?.textContent ?? '';
const act = (r: HTMLElement, key: string): HTMLButtonElement => r.querySelector<HTMLButtonElement>(`button[aria-label="${key}"]`)!;
const input = (): HTMLInputElement | null => q<HTMLInputElement>('.qpm-spec-wp-input');
const key = (el: Element, k: string): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  document.body.innerHTML = '';
  list = [wp('a', 'Spot 1'), wp('b', 'Near the shop')];
  current = 'b';
  calls = [];
  menu = createWaypointMenu(source());
  document.body.append(menu.el);
});

describe('spectator waypoints menu', () => {
  it('shows Save with the key, the count, and one row per waypoint with the current one marked', () => {
    expect(q('.qpm-spec-wp-hd button')?.textContent).toBe('feature.spectator.wp.save {"key":"B"}');
    expect(q('.qpm-spec-wp-count')?.textContent).toBe(`feature.spectator.wp.count {"n":2,"max":${WAYPOINT_CAP}}`);
    expect(rows().map(nameOf)).toEqual(['Spot 1', 'Near the shop']);
    expect(rows().map((r) => r.getAttribute('aria-current'))).toEqual(['false', 'true']);
    expect(row('a').querySelector('.qpm-spec-wp-fly')?.getAttribute('aria-label')).toBe('feature.spectator.wp.fly {"name":"Spot 1"}');
    q<HTMLButtonElement>('.qpm-spec-wp-hd button')?.click();
    row('a').querySelector<HTMLButtonElement>('.qpm-spec-wp-fly')?.click();
    act(row('b'), 'feature.spectator.wp.delete').click();
    expect(calls).toEqual(['save', 'fly:a', 'remove:b']);
  });

  it('empty: the empty state says how to save; at the cap Save is off', () => {
    list = [];
    menu.render();
    expect(rows()).toEqual([]);
    expect(menu.el.textContent).toContain('feature.spectator.wp.empty {"key":"B"}');
    list = Array.from({ length: WAYPOINT_CAP }, (_, i) => wp(`w${i}`));
    menu.render();
    expect(rows()).toHaveLength(WAYPOINT_CAP);
    expect(q<HTMLButtonElement>('.qpm-spec-wp-hd button')?.disabled).toBe(true);
    list = list.slice(1);
    menu.render();
    expect(q<HTMLButtonElement>('.qpm-spec-wp-hd button')?.disabled).toBe(false);
  });

  it('rows are kept and updated in place; a removed one goes, a new one is added', () => {
    const a = row('a');
    current = 'a';
    list = [{ ...wp('a'), name: 'Home' }, wp('c')];
    menu.render();
    expect(row('a')).toBe(a);
    expect(rows().map(nameOf)).toEqual(['Home', 'C']);
    expect(a.getAttribute('aria-current')).toBe('true');
  });

  it('Rename: the name becomes a focused field; Enter saves it and the row comes back', () => {
    act(row('b'), 'feature.spectator.wp.rename').click();
    const f = input()!;
    expect(f.value).toBe('Near the shop');
    expect(document.activeElement).toBe(f);
    expect(row('b').hasAttribute('data-editing')).toBe(true);
    f.value = 'Market';
    const e = key(f, 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(calls).toEqual(['rename:b:Market']);
    expect(input()).toBeNull();
    expect(nameOf(row('b'))).toBe('Market');
    expect(row('b').hasAttribute('data-editing')).toBe(false);
  });

  it('Rename: Esc cancels without saving; clicking away (blur) saves; a redraw while typing keeps the field', () => {
    act(row('a'), 'feature.spectator.wp.rename').click();
    input()!.value = 'Nope';
    key(input()!, 'Escape');
    expect(calls).toEqual([]);
    expect(nameOf(row('a'))).toBe('Spot 1');
    act(row('a'), 'feature.spectator.wp.rename').click();
    const f = input()!;
    f.value = 'Pond';
    menu.render();
    expect(input()).toBe(f);
    expect(document.activeElement).toBe(f);
    f.blur();
    expect(calls).toEqual(['rename:a:Pond']);
    expect(input()).toBeNull();
  });

  it('endEdit commits a rename being typed and brings the row back (the popover closing); with none open it does nothing', () => {
    menu.endEdit();
    act(row('a'), 'feature.spectator.wp.rename').click();
    input()!.value = 'Pond';
    menu.endEdit();
    expect(calls).toEqual(['rename:a:Pond']);
    expect(input()).toBeNull();
    expect(row('a').hasAttribute('data-editing')).toBe(false);
    expect(row('a').querySelector<HTMLButtonElement>('.qpm-spec-wp-fly')?.hidden).toBe(false);
    menu.endEdit();
    expect(calls).toHaveLength(1);
  });

  it('a reorder while renaming commits the field first, so no row is left half in edit', () => {
    act(row('b'), 'feature.spectator.wp.rename').click();
    input()!.value = 'Market';
    list = [list[1]!, list[0]!];
    menu.render();
    expect(calls).toEqual(['rename:b:Market']);
    expect(rows().map(nameOf)).toEqual(['Market', 'Spot 1']);
    expect(rows().some((r) => r.hasAttribute('data-editing'))).toBe(false);
    expect(input()).toBeNull();
  });

  it('Enter and Esc in the field stop there: no outer key listener sees them', () => {
    act(row('a'), 'feature.spectator.wp.rename').click();
    const seen: string[] = [];
    const onKey = (e: KeyboardEvent): void => { seen.push(e.key); };
    document.addEventListener('keydown', onKey);
    key(input()!, 'Enter');
    act(row('a'), 'feature.spectator.wp.rename').click();
    key(input()!, 'Escape');
    document.removeEventListener('keydown', onKey);
    expect(seen).toEqual([]);
  });

  it('destroy removes the menu and later renders do nothing', () => {
    menu.destroy();
    menu.destroy();
    expect(document.querySelector('.qpm-spec-wp')).toBeNull();
    list = [];
    expect(() => { menu.render(); }).not.toThrow();
  });
});
