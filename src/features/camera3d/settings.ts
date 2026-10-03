import { storage } from '../../utils/storage';

export type DetailPreset = 'near' | 'medium' | 'far';
const PRESETS: readonly DetailPreset[] = ['near', 'medium', 'far'];

export interface Camera3dSettings {
  enabled: boolean;
  firstPerson: boolean;
  camMove: boolean;
  invertY: boolean;
  sensitivity: number;
  detail: DetailPreset;
}

export interface Camera3dHints { detent: boolean; firstEntry: boolean; lockError: boolean }

const KEYS = {
  enabled: 'qpm.camera3d.enabled.v1',
  firstPerson: 'qpm.camera3d.firstPerson.v1',
  camMove: 'qpm.camera3d.camMove.v1',
  invertY: 'qpm.camera3d.invertY.v1',
  sensitivity: 'qpm.camera3d.sensitivity.v1',
  detail: 'qpm.camera3d.detail.v1',
} as const;
const HINTS_KEY = 'qpm.camera3d.hints.v1';

const listeners = new Set<(s: Camera3dSettings) => void>();

function bool(key: string, dflt: boolean): boolean {
  const v = storage.get<boolean | null>(key, null);
  return v === null ? dflt : v === true;
}

export function getCamera3dSettings(): Camera3dSettings {
  const sens = storage.get<unknown>(KEYS.sensitivity, null);
  const detail = storage.get<unknown>(KEYS.detail, null);
  return {
    enabled: bool(KEYS.enabled, true),
    firstPerson: bool(KEYS.firstPerson, true),
    camMove: bool(KEYS.camMove, true),
    invertY: bool(KEYS.invertY, false),
    sensitivity: typeof sens === 'number' && Number.isFinite(sens) ? Math.min(2, Math.max(0.5, sens)) : 1,
    detail: PRESETS.find((p) => p === detail) ?? 'medium',
  };
}

export function setCamera3dSetting<K extends keyof Camera3dSettings>(key: K, value: Camera3dSettings[K]): void {
  storage.set(KEYS[key], value);
  const next = getCamera3dSettings();
  for (const cb of listeners) {
    try { cb(next); } catch { /* isolate listeners */ }
  }
}

export function onCamera3dSettingsChange(cb: (s: Camera3dSettings) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getCamera3dHints(): Camera3dHints {
  const h = storage.get<Partial<Camera3dHints> | null>(HINTS_KEY, null) ?? {};
  return { detent: h.detent === true, firstEntry: h.firstEntry === true, lockError: h.lockError === true };
}

export function markCamera3dHint(key: keyof Camera3dHints): void {
  storage.set(HINTS_KEY, { ...getCamera3dHints(), [key]: true });
}
