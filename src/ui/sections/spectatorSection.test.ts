// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
const others = vi.hoisted(() => ({
  shopOn: true, shop: {} as Record<string, string>, panel: 'alt+q', feed: {} as Record<number, string>, sell: '',
  teams: [] as Array<{ id: string; name: string }>, teamKeys: {} as Record<string, string>, hutch: 'h',
}));
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
    remove: (k: string) => { mem.delete(k); },
  },
}));
vi.mock('../../i18n', () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));
vi.mock('../../features/spectator', async () => ({
  ...(await import('../../features/spectator/settings')),
  ...(await import('../../features/spectator/input/keyRules')),
}));
vi.mock('../components', async () => ({
  ...(await import('../components/button')),
  ...(await import('../components/toggle')),
  ...(await import('../components/sliderRow')),
  ...(await import('../components/sectionHeader')),
}));
vi.mock('../core/modalWindow', () => ({
  closeWindow: () => undefined, destroyWindow: () => undefined, isWindowOpen: () => false, openWindow: () => undefined,
  windowLog: { warn: () => undefined },
}));
vi.mock('../../features/shop/keybinds', () => ({ isShopKeybindsEnabled: () => others.shopOn, getAllShopKeybinds: () => others.shop }));
vi.mock('../../features/input/panelHotkey', () => ({ getPanelToggleKeybind: () => others.panel, onPanelToggleKeybindChange: () => () => undefined }));
vi.mock('../../features/pets/feedKeybinds', () => ({ getAllFeedKeybinds: () => others.feed }));
vi.mock('../../features/pets/sellAll', () => ({ getSellAllPetsKeybind: () => others.sell }));
vi.mock('../../store/petTeams', () => ({ getKeybinds: () => others.teamKeys, getTeamsConfig: () => ({ teams: others.teams }) }));
vi.mock('../pets/hutchWindow', () => ({ getKeybind: () => others.hutch }));

import { getSpectatorSettings, setSpectatorSetting, SPECTATOR_DEFAULTS } from '../../features/spectator/settings';
import { isKeybindRecording } from '../pets/petsWindow/helpers';
import { createSpectatorSection, getSpectatorCard } from './spectatorSection';

const SHOWN = [
  'toggle', 'forward', 'left', 'back', 'right', 'up', 'down', 'fast', 'prevPlayer', 'nextPlayer', 'detach', 'director',
  'saveWaypoint', 'prevWaypoint', 'nextWaypoint', 'infoCard', 'hideUi', 'photo',
];

let section: { root: HTMLElement; destroy: () => void } | null = null;
const open = (): HTMLElement => {
  section?.destroy();
  section = createSpectatorSection();
  document.body.replaceChildren(section.root);
  return section.root;
};
const keyBtn = (a: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-spec-key="${a}"]`)!;
const note = (a: string): string => document.querySelector(`[data-spec-note="${a}"]`)?.textContent ?? '';
const press = (el: HTMLElement, code: string, key: string, init: KeyboardEventInit = {}): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...init }));
};
const record = (a: string, code: string, key: string, init: KeyboardEventInit = {}): void => {
  keyBtn(a).click();
  press(keyBtn(a), code, key, init);
};
const binding = (a: keyof typeof SPECTATOR_DEFAULTS.keys): string => getSpectatorSettings().keys[a];

beforeEach(() => {
  mem.clear();
  Object.assign(others, { shopOn: true, shop: {}, panel: 'alt+q', feed: {}, sell: '', teams: [], teamKeys: {}, hutch: 'h' });
  open();
});
afterEach(() => { section?.destroy(); section = null; });

describe('spectator settings card', () => {
  it('shows a row for every action that works today, in the approved groups; V, C and auto-start are hidden', () => {
    expect([...document.querySelectorAll('[data-spec-key]')].map((b) => b.getAttribute('data-spec-key'))).toEqual(SHOWN);
    expect(keyBtn('toggle').textContent).toBe('G');
    expect(keyBtn('fast').textContent).toBe('Shift');
    expect(keyBtn('prevPlayer').textContent).toBe('[');
    expect(document.body.textContent).not.toContain('autoStart');
    expect(note('toggle')).toContain('feature.spectator.keys.toggleNote');
  });

  it('a click then a key rebinds that action at once; Backspace puts its default back', () => {
    record('director', 'KeyK', 'k');
    expect(binding('director')).toBe('k');
    expect(keyBtn('director').textContent).toBe('K');
    record('director', 'Backspace', 'Backspace');
    expect(binding('director')).toBe('t');
  });

  it('a fixed key is refused with a note while recording carries on; a free key then lands', () => {
    keyBtn('director').click();
    press(keyBtn('director'), 'Digit1', '1');
    expect(binding('director')).toBe('t');
    expect(note('director')).toContain('feature.spectator.keys.fixedKey');
    expect(isKeybindRecording()).toBe(true);
    press(keyBtn('director'), 'KeyK', 'k');
    expect(binding('director')).toBe('k');
    expect(note('director')).toBe('');
    expect(isKeybindRecording()).toBe(false);
  });

  it('a hold row records the base key (Shift dropped), Shift alone for Faster, and refuses Ctrl/Alt', () => {
    keyBtn('forward').click();
    press(keyBtn('forward'), 'ShiftLeft', 'Shift', { shiftKey: true });
    expect(binding('forward')).toBe('w');
    press(keyBtn('forward'), 'KeyU', 'U', { shiftKey: true });
    expect(binding('forward')).toBe('u');
    record('fast', 'KeyR', 'r');
    expect(binding('fast')).toBe('r');
    record('fast', 'ShiftRight', 'Shift', { shiftKey: true });
    expect(binding('fast')).toBe('shift');
    record('forward', 'KeyW', 'w', { ctrlKey: true });
    expect(binding('forward')).toBe('u');
    expect(note('forward')).toContain('feature.spectator.keys.holdModifier');
    press(keyBtn('forward'), 'Escape', 'Escape');
    expect(note('forward')).toBe('');
  });

  it('two actions on one key are flagged on both rows, and the flag clears when fixed', () => {
    setSpectatorSetting('keys', { ...SPECTATOR_DEFAULTS.keys, director: 'b' });
    expect(note('director')).toContain('feature.spectator.keys.clash');
    expect(note('director')).toContain('feature.spectator.keys.saveWaypoint');
    expect(note('saveWaypoint')).toContain('feature.spectator.keys.director');
    expect(keyBtn('director').style.borderColor).toBe('var(--qpm-warning)');
    setSpectatorSetting('keys', { ...SPECTATOR_DEFAULTS.keys });
    expect(note('director')).toBe('');
    expect(keyBtn('director').style.borderColor).not.toBe('var(--qpm-warning)');
  });

  it('other QPM keybinds: the Hutch on H by default, a pet team on the toggle key, shop keys only while they are on', () => {
    expect(note('hideUi')).toContain('feature.spectator.keys.clashOther');
    expect(note('hideUi')).toContain('feature.spectator.keys.other.hutch');
    others.teams = [{ id: 't1', name: 'Farm' }];
    others.teamKeys = { g: 't1', x: 'gone' };
    others.shop = { seedShop: 'alt+s' };
    setSpectatorSetting('keys', { ...SPECTATOR_DEFAULTS.keys, photo: 'alt+s' });
    expect(note('toggle')).toContain('feature.spectator.keys.clashOtherToggle');
    expect(note('toggle')).toContain('Farm');
    expect(note('photo')).toContain('feature.spectator.keys.other.shop');
    others.shopOn = false;
    open();
    expect(note('photo')).toBe('');
  });

  it('sliders write on commit; Reset restores keys and sliders but keeps Enabled', () => {
    const [fly, every] = [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    fly!.value = '2';
    fly!.dispatchEvent(new Event('change'));
    every!.value = '45';
    every!.dispatchEvent(new Event('change'));
    expect(getSpectatorSettings()).toMatchObject({ flySpeed: 2, directorEverySec: 45 });
    record('director', 'KeyK', 'k');
    setSpectatorSetting('enabled', false);
    const reset = [...document.querySelectorAll('button')].find((b) => b.textContent === 'feature.spectator.settings.reset')!;
    reset.click();
    expect(getSpectatorSettings()).toEqual({ ...SPECTATOR_DEFAULTS, enabled: false });
    expect(keyBtn('director').textContent).toBe('T');
    expect(fly!.value).toBe('1');
  });

  it('Enabled off disables every control below it and ends a recording in progress', () => {
    keyBtn('director').click();
    setSpectatorSetting('enabled', false);
    expect(isKeybindRecording()).toBe(false);
    press(keyBtn('director'), 'KeyK', 'k');
    expect(binding('director')).toBe('t');
    expect(SHOWN.every((a) => keyBtn(a).disabled)).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="range"]')].every((r) => r.disabled)).toBe(true);
    setSpectatorSetting('enabled', true);
    expect(keyBtn('photo').disabled).toBe(false);
  });

  it('destroy stops listening and ends a recording still running', () => {
    const btn = keyBtn('director');
    btn.click();
    section?.destroy();
    section = null;
    press(btn, 'KeyK', 'k');
    expect(binding('director')).toBe('t');
    expect(isKeybindRecording()).toBe(false);
    setSpectatorSetting('keys', { ...SPECTATOR_DEFAULTS.keys, director: 'j' });
    expect(btn.textContent).toBe('T');
  });

  it('the card summary names the toggle key while on', () => {
    const el = document.createElement('div');
    const off = getSpectatorCard().renderSummary(el);
    expect(el.textContent).toBe('feature.spectator.settings.summaryOn {"key":"G"}');
    setSpectatorSetting('enabled', false);
    expect(el.textContent).toBe('common.disabled');
    if (typeof off === 'function') off();
  });
});
