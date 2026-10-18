// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginKeybindRecording } from '../../../ui/pets/petsWindow/helpers';
import { SPECTATOR_DEFAULTS, type SpectatorAction } from '../settings';
import { installKeys, type KeyRouter } from './keys';

const ctx = { active: false, ui: false };
let router: KeyRouter;
const pressed: string[] = [];

function key(type: 'keydown' | 'keyup', code: string, k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
const down = (code: string, k: string, init?: KeyboardEventInit, target?: EventTarget): KeyboardEvent => key('keydown', code, k, init, target);
const up = (code: string, k: string, init?: KeyboardEventInit): KeyboardEvent => key('keyup', code, k, init);

beforeEach(() => {
  ctx.active = false;
  ctx.ui = false;
  pressed.length = 0;
  const press: Partial<Record<SpectatorAction, () => void>> = {};
  for (const a of ['toggle', 'up', 'down', 'detach'] as const) press[a] = () => { pressed.push(a); };
  router = installKeys(
    { active: () => ctx.active, uiOwnsInput: () => ctx.ui, bindings: () => SPECTATOR_DEFAULTS.keys },
    { press, escape: () => { pressed.push('escape'); } },
  );
});
afterEach(() => { router.off(); document.body.innerHTML = ''; });

describe('spectator keys', () => {
  it('only the toggle key works while not spectating, only outside the game UI, and it stops at the router', () => {
    const later = vi.fn();
    document.addEventListener('keydown', later);
    down('KeyW', 'w');
    down('KeyE', 'e');
    expect(pressed).toEqual([]);
    expect(later).toHaveBeenCalledTimes(2);
    expect(router.input()).toEqual({ fx: 0, fy: 0, up: 0, fast: false });
    const g = down('KeyG', 'g');
    expect(pressed).toEqual(['toggle']);
    expect(g.defaultPrevented).toBe(true);
    expect(later).toHaveBeenCalledTimes(2);
    ctx.ui = true;
    down('KeyG', 'g');
    expect(pressed).toEqual(['toggle']);
    expect(later).toHaveBeenCalledTimes(3);
    document.removeEventListener('keydown', later);
  });

  it('WASD and the arrows give the same held axes; Shift is fast', () => {
    ctx.active = true;
    const w = down('KeyW', 'w');
    expect(w.defaultPrevented).toBe(true);
    down('ArrowRight', 'ArrowRight');
    expect(router.input()).toEqual({ fx: 1, fy: 1, up: 0, fast: false });
    down('ShiftLeft', 'Shift', { shiftKey: true });
    down('KeyS', 'S', { shiftKey: true });
    expect(router.input()).toEqual({ fx: 1, fy: 0, up: 0, fast: true });
    up('KeyW', 'w');
    up('ShiftLeft', 'Shift');
    expect(router.input()).toEqual({ fx: 1, fy: -1, up: 0, fast: false });
    up('ArrowRight', 'ArrowRight');
    up('KeyS', 's');
    expect(router.input()).toEqual({ fx: 0, fy: 0, up: 0, fast: false });
  });

  it('one-shot actions fire once per press, with Shift held too, never on repeats or Ctrl/Alt combos', () => {
    ctx.active = true;
    down('KeyE', 'e');
    down('KeyE', 'e', { repeat: true });
    down('KeyQ', 'Q', { shiftKey: true });
    down('KeyF', 'f', { ctrlKey: true });
    down('KeyF', 'f', { altKey: true });
    down('KeyG', 'g');
    expect(pressed).toEqual(['up', 'down', 'toggle']);
  });

  it('keys typed into a text field are left alone, and a key released there still lets go', () => {
    ctx.active = true;
    const input = document.createElement('input');
    document.body.appendChild(input);
    down('KeyD', 'd');
    const typed = down('KeyW', 'w', {}, input);
    down('KeyG', 'g', {}, input);
    down('Escape', 'Escape', {}, input);
    expect(typed.defaultPrevented).toBe(false);
    expect(pressed).toEqual([]);
    expect(router.input().fy).toBe(0);
    key('keyup', 'KeyD', 'd', {}, input);
    expect(router.input().fx).toBe(0);
  });

  it('Esc exits only when the game UI does not own input and the pointer is not locked', () => {
    ctx.active = true;
    ctx.ui = true;
    const left = down('Escape', 'Escape');
    expect(left.defaultPrevented).toBe(false);
    expect(pressed).toEqual([]);
    ctx.ui = false;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => document.body });
    down('Escape', 'Escape');
    expect(pressed).toEqual([]);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
    const taken = down('Escape', 'Escape');
    expect(pressed).toEqual(['escape']);
    expect(taken.defaultPrevented).toBe(true);
  });

  it('while the game UI owns input nothing is held or fired', () => {
    ctx.active = true;
    ctx.ui = true;
    const w = down('KeyW', 'w');
    down('KeyE', 'e');
    expect(w.defaultPrevented).toBe(false);
    expect(pressed).toEqual([]);
    ctx.ui = false;
    expect(router.input().fy).toBe(0);
  });

  it('blur and release() drop every held key; off() removes the listeners', () => {
    ctx.active = true;
    down('KeyA', 'a');
    window.dispatchEvent(new Event('blur'));
    expect(router.input().fx).toBe(0);
    down('KeyA', 'a');
    router.release();
    expect(router.input().fx).toBe(0);
    router.off();
    router.off();
    down('KeyG', 'g');
    expect(pressed).toEqual([]);
  });

  it('while spectating, keys it acts on stop at the router (other QPM keybinds share them) and count as game activity', () => {
    router.off();
    let activity = 0;
    router = installKeys(
      { active: () => ctx.active, uiOwnsInput: () => false, bindings: () => SPECTATOR_DEFAULTS.keys, activity: () => { activity++; } },
      { press: { toggle: () => { pressed.push('toggle'); }, up: () => { pressed.push('up'); } }, escape: vi.fn() },
    );
    const later = vi.fn();
    document.addEventListener('keydown', later);
    ctx.active = true;
    down('KeyS', 'S', { shiftKey: true });
    down('ArrowLeft', 'ArrowLeft');
    down('KeyE', 'e');
    down('KeyG', 'g');
    expect(later).not.toHaveBeenCalled();
    expect(activity).toBe(4);
    down('ShiftLeft', 'Shift', { shiftKey: true });
    down('KeyP', 'p');
    down('KeyX', 'x');
    expect(later).toHaveBeenCalledTimes(3);
    document.removeEventListener('keydown', later);
  });

  it('with the feature off the toggle key stays with everyone else (another QPM keybind may share it)', () => {
    router.off();
    let on = false;
    router = installKeys(
      { active: () => ctx.active, enabled: () => on, uiOwnsInput: () => false, bindings: () => SPECTATOR_DEFAULTS.keys },
      { press: { toggle: () => { pressed.push('toggle'); } }, escape: vi.fn() },
    );
    const later = vi.fn();
    document.addEventListener('keydown', later);
    expect(down('KeyG', 'g').defaultPrevented).toBe(false);
    expect(pressed).toEqual([]);
    expect(later).toHaveBeenCalledTimes(1);
    on = true;
    expect(down('KeyG', 'g').defaultPrevented).toBe(true);
    expect(pressed).toEqual(['toggle']);
    document.removeEventListener('keydown', later);
  });

  it('while any keybind recorder waits for a key, keys go to it (focus or not), idle or spectating', () => {
    const end = beginKeybindRecording();
    expect(down('KeyG', 'g').defaultPrevented).toBe(false);
    ctx.active = true;
    expect(down('KeyW', 'w').defaultPrevented).toBe(false);
    down('Escape', 'Escape');
    down('KeyE', 'e');
    expect(pressed).toEqual([]);
    expect(router.input().fy).toBe(0);
    end();
    end();
    expect(down('KeyE', 'e').defaultPrevented).toBe(true);
    expect(pressed).toEqual(['up']);
  });

  it('a rebound action follows the binding, with its modifiers', () => {
    router.off();
    const keys = { ...SPECTATOR_DEFAULTS.keys, toggle: 'alt+g', forward: 'i' };
    router = installKeys(
      { active: () => ctx.active, uiOwnsInput: () => false, bindings: () => keys },
      { press: { toggle: () => { pressed.push('toggle'); } }, escape: vi.fn() },
    );
    down('KeyG', 'g');
    down('KeyG', 'g', { altKey: true });
    expect(pressed).toEqual(['toggle']);
    ctx.active = true;
    down('KeyI', 'i');
    down('KeyW', 'w');
    expect(router.input().fy).toBe(1);
    up('KeyI', 'i');
    expect(router.input().fy).toBe(0);
  });
});

describe('seat digits', () => {
  let seatRouter: KeyRouter;
  const seats: number[] = [];
  const taken = new Set([2, 4]);
  beforeEach(() => {
    router.off();
    seats.length = 0;
    seatRouter = installKeys(
      { active: () => ctx.active, uiOwnsInput: () => ctx.ui, bindings: () => SPECTATOR_DEFAULTS.keys },
      { press: {}, escape: () => {}, seat: (n) => { seats.push(n); return taken.has(n); } },
    );
  });
  afterEach(() => { seatRouter.off(); });

  it('a digit asks for that seat while spectating; only a seat it follows keeps the key', () => {
    ctx.active = true;
    const later = vi.fn();
    document.addEventListener('keydown', later);
    expect(down('Digit2', '2').defaultPrevented).toBe(true);
    expect(down('Digit3', '3').defaultPrevented).toBe(false);
    expect(seats).toEqual([2, 3]);
    expect(later).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', later);
  });

  it('no seats while idle, with a modifier, on a repeat, in a text field or while a game window owns input', () => {
    down('Digit2', '2');
    ctx.active = true;
    down('Digit2', '@', { shiftKey: true });
    down('Digit2', '2', { ctrlKey: true });
    down('Digit2', '2', { repeat: true });
    const input = document.createElement('input');
    document.body.append(input);
    down('Digit2', '2', {}, input);
    ctx.ui = true;
    down('Digit2', '2');
    down('Digit0', '0');
    expect(seats).toEqual([]);
  });
});

describe('steer (a movement key pressed)', () => {
  let steerRouter: KeyRouter;
  let steers = 0;
  beforeEach(() => {
    router.off();
    steers = 0;
    steerRouter = installKeys(
      { active: () => ctx.active, uiOwnsInput: () => ctx.ui, bindings: () => SPECTATOR_DEFAULTS.keys },
      { press: {}, escape: () => {}, steer: () => { steers++; } },
    );
  });
  afterEach(() => { steerRouter.off(); });

  it('fires once per press of WASD or an arrow, even a tap released before any frame', () => {
    ctx.active = true;
    down('KeyD', 'd');
    up('KeyD', 'd');
    down('ArrowUp', 'ArrowUp');
    down('ArrowUp', 'ArrowUp', { repeat: true });
    down('KeyE', 'e');
    expect(steers).toBe(2);
  });

  it('never while idle, in a text field or while a game window owns input', () => {
    down('KeyW', 'w');
    ctx.active = true;
    const input = document.createElement('input');
    document.body.append(input);
    down('KeyW', 'w', {}, input);
    ctx.ui = true;
    down('KeyW', 'w');
    expect(steers).toBe(0);
  });
});

describe('capture (Enter and Space, fixed while photo mode is on)', () => {
  let photoRouter: KeyRouter;
  let photoOn = false;
  const shots: boolean[] = [];
  beforeEach(() => {
    router.off();
    photoOn = false;
    shots.length = 0;
    photoRouter = installKeys(
      { active: () => ctx.active, uiOwnsInput: () => ctx.ui, bindings: () => SPECTATOR_DEFAULTS.keys },
      { press: {}, escape: () => {}, capture: (repeat) => { if (!photoOn) return false; shots.push(repeat); return true; } },
    );
  });
  afterEach(() => { photoRouter.off(); });

  it('takes Enter and Space only while photo mode owns them, repeats included, never with a modifier', () => {
    ctx.active = true;
    expect(down('Enter', 'Enter').defaultPrevented).toBe(false);
    photoOn = true;
    expect(down('Enter', 'Enter').defaultPrevented).toBe(true);
    expect(down('Space', ' ').defaultPrevented).toBe(true);
    expect(down('Space', ' ', { repeat: true }).defaultPrevented).toBe(true);
    down('Enter', 'Enter', { ctrlKey: true });
    down('Enter', 'Enter', { shiftKey: true });
    expect(shots).toEqual([false, false, true]);
  });

  it('never while idle, in a text field or while a game window owns input', () => {
    photoOn = true;
    down('Enter', 'Enter');
    ctx.active = true;
    const input = document.createElement('input');
    document.body.append(input);
    down('Enter', 'Enter', {}, input);
    ctx.ui = true;
    down('Space', ' ');
    expect(shots).toEqual([]);
  });

  it('a focused button keeps Enter and Space, so the keyboard can press it', () => {
    ctx.active = true;
    photoOn = true;
    const btn = document.createElement('button');
    document.body.append(btn);
    expect(down('Enter', 'Enter', {}, btn).defaultPrevented).toBe(false);
    expect(down('Space', ' ', {}, btn).defaultPrevented).toBe(false);
    expect(shots).toEqual([]);
  });
});
