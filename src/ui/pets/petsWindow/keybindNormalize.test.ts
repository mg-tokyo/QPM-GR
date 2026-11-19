// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../../sprite-v2/compat', () => ({ getAnySpriteDataUrl: () => null }));
vi.mock('../../../features/pets/optimizer', () => ({ calculatePetScore: () => 0 }));
vi.mock('../../../store/xpTracker', () => ({ calculateMaxStrength: () => null }));
vi.mock('../../../features/pets/data/petAbilities', () => ({ getAbilityDefinition: () => null }));

import { canonicalKeyFromEvent, normalizeKeybind } from './helpers';

const press = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

describe('normalizeKeybind', () => {
  it('reads macOS Option dead keys from the physical key', () => {
    expect(normalizeKeybind(press({ key: 'Dead', code: 'KeyE', altKey: true }))).toBe('alt+e');
    expect(normalizeKeybind(press({ key: 'Dead', code: 'KeyU', altKey: true }))).toBe('alt+u');
    expect(normalizeKeybind(press({ key: 'Dead', code: 'Backquote', altKey: true }))).toBe('alt+`');
    expect(normalizeKeybind(press({ key: 'Unidentified', code: 'Digit3', altKey: true }))).toBe('alt+3');
  });

  it('ignores a dead or unidentified key with no known physical key', () => {
    expect(normalizeKeybind(press({ key: 'Dead', code: '', altKey: true }))).toBe('');
    expect(normalizeKeybind(press({ key: 'Unidentified', code: 'IntlRo' }))).toBe('');
  });

  it('records AltGr combos as ctrl+alt and the physical key', () => {
    expect(normalizeKeybind(press({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }))).toBe('ctrl+alt+q');
    expect(normalizeKeybind(press({ key: 'Dead', code: 'BracketRight', ctrlKey: true, altKey: true }))).toBe('ctrl+alt+]');
  });

  it('maps Meta to ctrl and keeps Shift on digits', () => {
    expect(normalizeKeybind(press({ key: 'k', code: 'KeyK', metaKey: true }))).toBe('ctrl+k');
    expect(normalizeKeybind(press({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('shift+1');
  });

  it('records nothing for a modifier alone', () => {
    expect(normalizeKeybind(press({ key: 'Alt', code: 'AltLeft', altKey: true }))).toBe('');
    expect(normalizeKeybind(press({ key: 'AltGraph', code: 'AltRight', ctrlKey: true, altKey: true }))).toBe('');
    expect(normalizeKeybind(press({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBe('');
    expect(normalizeKeybind(press({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBe('');
    expect(normalizeKeybind(press({ key: 'OS', code: 'OSLeft' }))).toBe('');
  });

  it('keeps plain keys unchanged', () => {
    expect(normalizeKeybind(press({ key: 's', code: 'KeyS', altKey: true }))).toBe('alt+s');
    expect(normalizeKeybind(press({ key: 'F5', code: 'F5' }))).toBe('f5');
    expect(normalizeKeybind(press({ key: 'MediaPlayPause', code: '' }))).toBe('mediaplaypause');
  });
});

describe('canonicalKeyFromEvent', () => {
  it('prefers the physical key and falls back to the key name', () => {
    expect(canonicalKeyFromEvent(press({ key: 'Dead', code: 'KeyE' }))).toBe('e');
    expect(canonicalKeyFromEvent(press({ key: 'ArrowUp', code: 'ArrowUp' }))).toBe('arrowup');
    expect(canonicalKeyFromEvent(press({ key: 'Unknown', code: 'IntlYen' }))).toBe('unknown');
  });
});
