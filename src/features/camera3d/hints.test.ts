// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
    remove: (k: string) => { mem.delete(k); },
  },
}));
vi.mock('../../i18n', () => ({ t: (key: string, vars?: Record<string, string>) => (vars ? `${key}|${vars.preset}` : key) }));

import { clearNotifications, onNotifications, type NotificationEvent } from '../../core/notifications';
import { showCamera3dSlowOffer } from './hints';
import { getCamera3dHints, getCamera3dSettings, graphicsPresetOf, setCamera3dSetting } from './settings';

const toastText = (): string[] => Array.from(document.querySelectorAll('.qpm-toast')).map((el) => el.textContent ?? '');

describe('the slow offer (perf Task 11, PC14)', () => {
  let events: NotificationEvent[] = [];
  let off: () => void = () => undefined;
  beforeEach(() => {
    mem.clear();
    clearNotifications();
    off = onNotifications((e) => { events = e; });
  });
  afterEach(() => { off(); for (const el of document.querySelectorAll('.qpm-toast')) el.remove(); });

  it('marks the hint, shows the toast with Apply and keeps the same action in the notification list', () => {
    showCamera3dSlowOffer('medium');
    expect(getCamera3dHints().slowSuggested).toBe(true);
    expect(toastText()).toEqual(['feature.camera3d.slow.offer|feature.camera3d.graphics.mediumfeature.camera3d.slow.apply']);
    const mine = events.filter((e) => e.feature === 'camera3d');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.message).toBe('feature.camera3d.slow.offer|feature.camera3d.graphics.medium');
    expect(mine[0]!.actions?.map((a) => a.label)).toEqual(['feature.camera3d.slow.apply']);
  });

  it('Apply sets exactly the offered preset (the four rows, nothing else) and confirms', () => {
    setCamera3dSetting('fov', 85);
    setCamera3dSetting('invertY', true);
    const before = getCamera3dSettings();
    showCamera3dSlowOffer('medium');
    document.querySelector<HTMLButtonElement>('.qpm-toast button')!.click();
    const after = getCamera3dSettings();
    expect(graphicsPresetOf(after)).toBe('medium');
    expect({ ...after, detail: before.detail, farAnim: before.farAnim, ground: before.ground, weather3d: before.weather3d }).toEqual(before);
    expect(toastText()).toEqual(['feature.camera3d.slow.applied|feature.camera3d.graphics.medium']);
  });

  it('a late Apply from the list leaves graphics the player changed since alone', () => {
    showCamera3dSlowOffer('medium');
    setCamera3dSetting('ground', 'low');
    const changed = getCamera3dSettings();
    events.find((e) => e.feature === 'camera3d')!.actions![0]!.onClick();
    expect(getCamera3dSettings()).toEqual(changed);
    expect(toastText().some((s) => s.startsWith('feature.camera3d.slow.applied'))).toBe(false);
  });
});
