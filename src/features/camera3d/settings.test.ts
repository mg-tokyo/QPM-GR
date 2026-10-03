import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));

import { getCamera3dHints, getCamera3dSettings, markCamera3dHint, onCamera3dSettingsChange, setCamera3dSetting } from './settings';

describe('camera3d settings', () => {
  beforeEach(() => mem.clear());

  it('defaults: on by default, first person on, camera-relative movement on, medium detail', () => {
    expect(getCamera3dSettings()).toEqual({ enabled: true, firstPerson: true, camMove: true, invertY: false, sensitivity: 1, detail: 'medium' });
  });

  it('clamps sensitivity and rejects unknown presets', () => {
    mem.set('qpm.camera3d.sensitivity.v1', 9);
    mem.set('qpm.camera3d.detail.v1', 'ultra');
    expect(getCamera3dSettings().sensitivity).toBe(2);
    expect(getCamera3dSettings().detail).toBe('medium');
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
    expect(getCamera3dHints()).toEqual({ detent: true, firstEntry: false, lockError: false });
  });
});
