import { describe, expect, it } from 'vitest';
import type { AtomSourceSpec, SourceSpec } from '../types';
import { CAMERA_KEYS } from './camera';
import { GAME_STATE_KEYS, validateKeyTable } from './index';

const rung = (key: keyof typeof CAMERA_KEYS): AtomSourceSpec<unknown> =>
  (CAMERA_KEYS[key].sources as readonly SourceSpec<unknown>[])[0] as AtomSourceSpec<unknown>;
const accepts = (key: keyof typeof CAMERA_KEYS, v: unknown): boolean => rung(key).structure?.(v) ?? true;

describe('camera keys', () => {
  it('are merged into the key table and pass the ladder policy', () => {
    for (const k of Object.keys(CAMERA_KEYS)) expect(GAME_STATE_KEYS[k as keyof typeof GAME_STATE_KEYS]).toBeDefined();
    expect(validateKeyTable()).toEqual([]);
  });
  it('bind exact labels', () => {
    expect(rung('cutsceneCameraTarget').label.test('cutsceneCameraTargetAtom')).toBe(true);
    expect(rung('cameraTarget').label.test('cutsceneCameraTargetAtom')).toBe(false);
    expect(rung('keyboardCaptureOwners').label.test('isQuinoaKeyboardCapturedAtom')).toBe(false);
  });
  it('mark only the game-writable atoms writable', () => {
    const writable = Object.keys(CAMERA_KEYS).filter((k) => rung(k as keyof typeof CAMERA_KEYS).writable === true).sort();
    expect(writable).toEqual(['cutsceneCameraTarget', 'freelookCameraPosition', 'keyboardCaptureOwners', 'zoomIntent']);
  });
  it('guard grid points', () => {
    expect(accepts('cameraTarget', { x: 24, y: 23.75 })).toBe(true);
    expect(accepts('cameraTarget', null)).toBe(true);
    expect(accepts('cutsceneCameraTarget', { x: 'a', y: 1 })).toBe(false);
    expect(accepts('cutsceneCameraTarget', { x: Number.NaN, y: 1 })).toBe(false);
    expect(accepts('freelookCameraPosition', { x: 50, y: 30 })).toBe(true);
    expect(accepts('freelookCameraPosition', null)).toBe(false);
  });
  it('guard zoom, owners, presence and the step-aside handles', () => {
    expect(accepts('zoomIntent', null)).toBe(true);
    expect(accepts('zoomIntent', 64)).toBe(true);
    expect(accepts('zoomIntent', '64')).toBe(false);
    expect(accepts('keyboardCaptureOwners', [])).toBe(true);
    expect(accepts('keyboardCaptureOwners', [{ ownerName: 'x', token: 'x:1', allowMovementKeys: 'none' }])).toBe(true);
    expect(accepts('keyboardCaptureOwners', ['x'])).toBe(false);
    expect(accepts('keyboardCaptureOwners', {})).toBe(false);
    for (const p of ['seated', 'spectating', 'unseated']) expect(accepts('localPresence', p)).toBe(true);
    expect(accepts('localPresence', 'player')).toBe(false);
    expect(accepts('activeCutscene', null)).toBe(true);
    expect(accepts('activeCutscene', { id: 'c' })).toBe(true);
    expect(accepts('tramJourney', 3)).toBe(false);
  });
  it('read the HUD-hidden pair photo mode tells Cinematic Mode from (read-only booleans)', () => {
    expect(rung('hudChromeHidden').label.test('isChromeHiddenAtom')).toBe(true);
    expect(rung('hudChromeHidden').label.test('isCutsceneChromeHiddenAtom')).toBe(false);
    expect(rung('cutsceneChromeHidden').label.test('isCutsceneChromeHiddenAtom')).toBe(true);
    for (const k of ['hudChromeHidden', 'cutsceneChromeHidden'] as const) {
      expect(accepts(k, true)).toBe(true);
      expect(accepts(k, false)).toBe(true);
      expect(accepts(k, null)).toBe(false);
      expect(accepts(k, 'true')).toBe(false);
    }
  });
});
