import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));

import {
  GRAPHICS_PRESETS, GRAPHICS_PRESET_NAMES, applyGraphicsPreset, getCamera3dHints, getCamera3dSettings, graphicsPresetOf, markCamera3dHint,
  onCamera3dSettingsChange, resetCamera3dSettings, setCamera3dSetting,
} from './settings';

describe('camera3d settings', () => {
  beforeEach(() => mem.clear());

  it('defaults: on by default, first person on, camera-relative movement on, 70° field of view, the High graphics rows', () => {
    expect(getCamera3dSettings()).toEqual({
      enabled: true, firstPerson: true, camMove: true, invertY: false, sensitivity: 1, detail: 'medium', fov: 70,
      farAnim: 'full', ground: 'high', weather3d: 'full',
    });
    expect(graphicsPresetOf(getCamera3dSettings())).toBe('high');
  });

  it('clamps sensitivity and rejects unknown presets', () => {
    mem.set('qpm.camera3d.sensitivity.v1', 9);
    mem.set('qpm.camera3d.detail.v1', 'ultra');
    expect(getCamera3dSettings().sensitivity).toBe(2);
    expect(getCamera3dSettings().detail).toBe('medium');
  });

  it('clamps the field of view to 50–100° and ignores anything that is not a number (P8)', () => {
    const fovOf = (v: unknown): number => { mem.set('qpm.camera3d.fov.v1', v); return getCamera3dSettings().fov; };
    expect(fovOf(300)).toBe(100);
    expect(fovOf(10)).toBe(50);
    expect(fovOf(85)).toBe(85);
    expect(fovOf('wide')).toBe(70);
    expect(fovOf(Number.NaN)).toBe(70);
  });

  it('reset puts the field of view back with the other options and keeps Enabled', () => {
    setCamera3dSetting('enabled', false);
    setCamera3dSetting('fov', 95);
    resetCamera3dSettings();
    expect(getCamera3dSettings()).toMatchObject({ enabled: false, fov: 70 });
  });

  it('setCamera3dSetting persists and notifies listeners', () => {
    const seen: boolean[] = [];
    const off = onCamera3dSettingsChange((s) => seen.push(s.enabled));
    setCamera3dSetting('enabled', false);
    off();
    setCamera3dSetting('enabled', true);
    expect(seen).toEqual([false]);
    expect(mem.get('qpm.camera3d.enabled.v1')).toBe(true);
  });

  it('hint flags are per key and sticky', () => {
    markCamera3dHint('detent');
    expect(getCamera3dHints()).toEqual({ detent: true, firstEntry: false, lockError: false, slowSuggested: false });
    markCamera3dHint('slowSuggested');
    expect(getCamera3dHints().slowSuggested).toBe(true);
  });
});

describe('graphics presets (perf Task 9, S §4.1)', () => {
  beforeEach(() => mem.clear());

  it('the table: Low trades every row and the closest distance (PC16), Medium only the distance, High is today, Ultra the farthest distance (PC3: no Half)', () => {
    expect(GRAPHICS_PRESETS).toEqual({
      low: { detail: 'closest', farAnim: 'off', ground: 'low', weather3d: 'simple' },
      medium: { detail: 'near', farAnim: 'full', ground: 'high', weather3d: 'full' },
      high: { detail: 'medium', farAnim: 'full', ground: 'high', weather3d: 'full' },
      ultra: { detail: 'far', farAnim: 'full', ground: 'high', weather3d: 'full' },
    });
  });

  it('every preset round-trips: applied, its four rows are stored and it is the one lit', () => {
    for (const p of GRAPHICS_PRESET_NAMES) {
      applyGraphicsPreset(p);
      expect(getCamera3dSettings()).toMatchObject(GRAPHICS_PRESETS[p]);
      expect(graphicsPresetOf(getCamera3dSettings())).toBe(p);
    }
  });

  it('any row off its preset lights Custom', () => {
    applyGraphicsPreset('low');
    setCamera3dSetting('ground', 'high');
    expect(graphicsPresetOf(getCamera3dSettings())).toBe('custom');
    applyGraphicsPreset('ultra');
    setCamera3dSetting('farAnim', 'off');
    expect(graphicsPresetOf(getCamera3dSettings())).toBe('custom');
  });

  it('an old stored distance keeps its value and lights the preset it now equals; nothing else is written (Review focus 6)', () => {
    const lit = { near: 'medium', medium: 'high', far: 'ultra' } as const;
    for (const [detail, preset] of Object.entries(lit)) {
      mem.clear();
      mem.set('qpm.camera3d.detail.v1', detail);
      const s = getCamera3dSettings();
      expect(s.detail).toBe(detail);
      expect(graphicsPresetOf(s)).toBe(preset);
      expect([...mem.keys()]).toEqual(['qpm.camera3d.detail.v1']);
    }
  });

  it('applyGraphicsPreset emits one change event carrying all four rows', () => {
    const seen: string[] = [];
    const off = onCamera3dSettingsChange((s) => seen.push(`${s.detail}/${s.farAnim}/${s.ground}/${s.weather3d}`));
    applyGraphicsPreset('low');
    off();
    expect(seen).toEqual(['closest/off/low/simple']);
  });

  it('a stored closest distance is kept; with the other rows at High it lights Custom', () => {
    mem.set('qpm.camera3d.detail.v1', 'closest');
    const s = getCamera3dSettings();
    expect(s.detail).toBe('closest');
    expect(graphicsPresetOf(s)).toBe('custom');
  });

  it('Reset returns every graphics row to High and emits once', () => {
    applyGraphicsPreset('low');
    let events = 0;
    const off = onCamera3dSettingsChange(() => { events++; });
    resetCamera3dSettings();
    off();
    expect(events).toBe(1);
    expect(graphicsPresetOf(getCamera3dSettings())).toBe('high');
  });

  it('invalid stored rows fall back to High\'s values', () => {
    mem.set('qpm.camera3d.farAnim.v1', 'half');
    mem.set('qpm.camera3d.ground.v1', 42);
    mem.set('qpm.camera3d.weather3d.v1', null);
    expect(getCamera3dSettings()).toMatchObject({ farAnim: 'full', ground: 'high', weather3d: 'full' });
  });
});
