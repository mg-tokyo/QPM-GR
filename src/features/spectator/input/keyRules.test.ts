import { describe, expect, it } from 'vitest';
import { SPECTATOR_DEFAULTS, type SpectatorAction } from '../settings';
import { findKeyClashes, holdKeyOf, refuseKey, type OtherKeybind } from './keyRules';

const ALL = Object.keys(SPECTATOR_DEFAULTS.keys) as SpectatorAction[];
const keysWith = (over: Partial<Record<SpectatorAction, string>>): Record<SpectatorAction, string> => ({ ...SPECTATOR_DEFAULTS.keys, ...over });
const clashesOf = (keys: Record<SpectatorAction, string>, a: SpectatorAction, others: OtherKeybind[] = [], shown = ALL) =>
  findKeyClashes(keys, shown, others).get(a) ?? [];

describe('spectator key clashes', () => {
  it('the defaults clash with nothing', () => {
    expect(findKeyClashes(SPECTATOR_DEFAULTS.keys, ALL, []).size).toBe(0);
  });

  it('two actions on one key clash both ways', () => {
    const k = keysWith({ director: 'b' });
    expect(clashesOf(k, 'director')).toEqual([{ kind: 'spectator', action: 'saveWaypoint' }]);
    expect(clashesOf(k, 'saveWaypoint')).toEqual([{ kind: 'spectator', action: 'director' }]);
  });

  it('a bare key also fires with Shift held, so it clashes with its Shift combo; Ctrl/Alt combos are separate', () => {
    expect(clashesOf(keysWith({ director: 'shift+b' }), 'director')).toEqual([{ kind: 'spectator', action: 'saveWaypoint' }]);
    expect(clashesOf(keysWith({ director: 'ctrl+b' }), 'director')).toEqual([]);
    expect(clashesOf(keysWith({ director: 'alt+b', photo: 'alt+b' }), 'director')).toEqual([{ kind: 'spectator', action: 'photo' }]);
    expect(clashesOf(keysWith({ director: 'ctrl+b', photo: 'ctrl+shift+b' }), 'director')).toEqual([]);
  });

  it('a hold key clashes with a press on the same base key, Shift or not', () => {
    expect(clashesOf(keysWith({ director: 'w' }), 'forward')).toEqual([{ kind: 'spectator', action: 'director' }]);
    expect(clashesOf(keysWith({ director: 'shift+w' }), 'forward')).toEqual([{ kind: 'spectator', action: 'director' }]);
    expect(clashesOf(keysWith({ director: 'ctrl+w' }), 'forward')).toEqual([]);
    expect(clashesOf(keysWith({ left: 'shift' }), 'fast')).toEqual([{ kind: 'spectator', action: 'left' }]);
  });

  it('actions the card does not show (later tasks) never count', () => {
    const k = keysWith({ director: 'v' });
    expect(clashesOf(k, 'director')).toEqual([{ kind: 'spectator', action: 'view' }]);
    const shown = ALL.filter((a) => a !== 'view' && a !== 'followStyle');
    expect(clashesOf(k, 'director', [], shown)).toEqual([]);
    expect(findKeyClashes(k, shown, []).has('view')).toBe(false);
  });

  it('another QPM keybind clashes when the binding acts on its exact combo', () => {
    const others: OtherKeybind[] = [{ name: 'Team', combo: 'g' }, { name: 'Shop', combo: 'alt+s' }, { name: 'Sell', combo: 'shift+p' }];
    expect(clashesOf(SPECTATOR_DEFAULTS.keys, 'toggle', others)).toEqual([{ kind: 'other', name: 'Team' }]);
    expect(clashesOf(SPECTATOR_DEFAULTS.keys, 'back', others)).toEqual([]);
    expect(clashesOf(SPECTATOR_DEFAULTS.keys, 'photo', others)).toEqual([{ kind: 'other', name: 'Sell' }]);
    expect(clashesOf(keysWith({ photo: 'alt+s' }), 'photo', others)).toEqual([{ kind: 'other', name: 'Shop' }]);
    expect(clashesOf(keysWith({ photo: 'ctrl+p' }), 'photo', others)).toEqual([]);
  });

  it('a loose keybind (any modifiers, the Hutch) clashes on the base key alone', () => {
    const hutch: OtherKeybind[] = [{ name: 'Hutch', combo: 'h', loose: true }];
    expect(clashesOf(SPECTATOR_DEFAULTS.keys, 'hideUi', hutch)).toEqual([{ kind: 'other', name: 'Hutch' }]);
    expect(clashesOf(keysWith({ hideUi: 'ctrl+h' }), 'hideUi', hutch)).toEqual([{ kind: 'other', name: 'Hutch' }]);
    expect(clashesOf(keysWith({ hideUi: 'j' }), 'hideUi', hutch)).toEqual([]);
  });

  it('empty other keybinds are skipped', () => {
    expect(clashesOf(SPECTATOR_DEFAULTS.keys, 'toggle', [{ name: 'Unset', combo: '' }])).toEqual([]);
  });
});

describe('refused keys', () => {
  it('Esc is fixed with any modifier', () => {
    expect(refuseKey('director', 'escape')).toBe('fixed');
    expect(refuseKey('director', 'ctrl+escape')).toBe('fixed');
  });

  it('seat digits, Enter and Space are fixed bare; Shift or Ctrl makes them free', () => {
    for (const k of ['1', '9', 'enter', 'space']) expect(refuseKey('photo', k)).toBe('fixed');
    for (const k of ['0', 'shift+1', 'ctrl+2', 'shift+space', 'alt+enter']) expect(refuseKey('photo', k)).toBeNull();
  });

  it('arrows mirror WASD, so they are fixed unless Ctrl or Alt is held', () => {
    expect(refuseKey('director', 'arrowup')).toBe('fixed');
    expect(refuseKey('director', 'shift+arrowleft')).toBe('fixed');
    expect(refuseKey('director', 'ctrl+arrowleft')).toBeNull();
  });

  it('a hold row takes a bare key or Shift, never Ctrl or Alt', () => {
    expect(refuseKey('forward', 'ctrl+w')).toBe('holdModifier');
    expect(refuseKey('fast', 'alt+x')).toBe('holdModifier');
    expect(refuseKey('fast', 'shift')).toBeNull();
    expect(refuseKey('forward', 'i')).toBeNull();
    expect(refuseKey('forward', '3')).toBe('fixed');
    expect(refuseKey('director', 'ctrl+w')).toBeNull();
  });
});

describe('hold key from a recorded combo', () => {
  it('drops Shift (a hold key matches its base key), keeps Ctrl/Alt so they can be refused', () => {
    expect(holdKeyOf('shift+w')).toBe('w');
    expect(holdKeyOf('w')).toBe('w');
    expect(holdKeyOf('ctrl+shift+w')).toBe('ctrl+shift+w');
    expect(holdKeyOf('alt+w')).toBe('alt+w');
    expect(holdKeyOf('')).toBe('');
  });
});
