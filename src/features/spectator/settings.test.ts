import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
    remove: (k: string) => { mem.delete(k); },
  },
}));

import {
  SPECTATOR_ACTIONS, SPECTATOR_DEFAULTS, getSpectatorHints, getSpectatorSettings, markSpectatorHint, onSpectatorSettingsChange,
  parseSpectatorSettings, resetSpectatorHints, resetSpectatorSettings, setSpectatorSetting,
} from './settings';

const KEY = 'qpm.spectator.settings.v1';

describe('spectator settings', () => {
  beforeEach(() => mem.clear());

  it('defaults match the plan (keys in normalizeKeybind form, 1.0× fly speed, 30 s director)', () => {
    expect(getSpectatorSettings()).toEqual(SPECTATOR_DEFAULTS);
    expect(SPECTATOR_DEFAULTS).toMatchObject({ enabled: true, flySpeed: 1, directorEverySec: 30, directorEarly: true, autoStart: true });
    // Cinematic Mode hides every name tag (live 1448), so photo mode has no tags option (user, 2026-10-10).
    expect('photoTags' in SPECTATOR_DEFAULTS).toBe(false);
    expect(SPECTATOR_ACTIONS.map((a) => SPECTATOR_DEFAULTS.keys[a])).toEqual(
      ['g', 'w', 's', 'a', 'd', 'e', 'q', 'shift', '[', ']', 'f', 'v', 'c', 'b', ',', '.', 't', 'i', 'p', 'h'],
    );
  });

  it('a corrupt stored value falls back per field', () => {
    expect(parseSpectatorSettings('nope')).toEqual(SPECTATOR_DEFAULTS);
    expect(parseSpectatorSettings(null)).toEqual(SPECTATOR_DEFAULTS);
    const s = parseSpectatorSettings({
      enabled: 'yes', flySpeed: 99, directorEverySec: Number.NaN, directorEarly: false,
      keys: { toggle: 'k', forward: '', back: 7, bogus: 'x' },
    });
    expect(s.enabled).toBe(true);
    expect(s.flySpeed).toBe(4);
    expect(s.directorEverySec).toBe(30);
    expect(s.directorEarly).toBe(false);
    expect(s.keys.toggle).toBe('k');
    expect(s.keys.forward).toBe('w');
    expect(s.keys.back).toBe('s');
    expect(Object.keys(s.keys).sort()).toEqual([...SPECTATOR_ACTIONS].sort());
  });

  it('"switch every" is clamped to the card\'s 10–60 s (S §7)', () => {
    expect(parseSpectatorSettings({ directorEverySec: 120 }).directorEverySec).toBe(60);
    expect(parseSpectatorSettings({ directorEverySec: 8 }).directorEverySec).toBe(10);
    expect(parseSpectatorSettings({ directorEverySec: 45 }).directorEverySec).toBe(45);
  });

  it('set persists one field and notifies with the full settings', () => {
    const seen: number[] = [];
    const off = onSpectatorSettingsChange((s) => seen.push(s.flySpeed));
    setSpectatorSetting('flySpeed', 2);
    expect(getSpectatorSettings().flySpeed).toBe(2);
    expect(mem.get(KEY)).toMatchObject({ flySpeed: 2 });
    off();
    setSpectatorSetting('flySpeed', 3);
    expect(seen).toEqual([2]);
  });

  it('reset restores the defaults but keeps the Enabled switch', () => {
    setSpectatorSetting('enabled', false);
    setSpectatorSetting('flySpeed', 2);
    setSpectatorSetting('keys', { ...SPECTATOR_DEFAULTS.keys, toggle: 'k' });
    resetSpectatorSettings();
    expect(getSpectatorSettings()).toEqual({ ...SPECTATOR_DEFAULTS, enabled: false });
  });
});

describe('spectator hints', () => {
  beforeEach(() => mem.clear());

  it('a hint is unseen until marked, survives junk, and reset shows it again', () => {
    expect(getSpectatorHints()).toEqual({ entered: false });
    mem.set('qpm.spectator.hints.v1', 'junk');
    expect(getSpectatorHints()).toEqual({ entered: false });
    markSpectatorHint('entered');
    expect(getSpectatorHints()).toEqual({ entered: true });
    resetSpectatorHints();
    expect(mem.has('qpm.spectator.hints.v1')).toBe(false);
  });
});
