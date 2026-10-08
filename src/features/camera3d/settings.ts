import { storage } from '../../utils/storage';
import type { FarAnim } from './engine/farAnim';
import { FIRST_PERSON } from './math/zoomCurve';

export type DetailPreset = 'closest' | 'near' | 'medium' | 'far';
export const DETAIL_PRESETS: readonly DetailPreset[] = ['closest', 'near', 'medium', 'far'];
export const FAR_ANIM_MODES: readonly FarAnim[] = ['off', 'full'];
/** Floor bake sharpness (S §4.2): low halves the near and far bake resolution. */
export type Ground = 'low' | 'high';
export const GROUND_LEVELS: readonly Ground[] = ['low', 'high'];
/** simple: standing weather draws as one mesh over World, and a storm stands like rain (no bolts). */
export type Weather3d = 'simple' | 'full';
export const WEATHER3D_MODES: readonly Weather3d[] = ['simple', 'full'];
export const SENSITIVITY_RANGE = { min: 0.5, max: 2, step: 0.1 } as const;
/** Vertical degrees (P8): first person's own FOV; third person shifts by the same amount, faded in with the tilt. */
export const FOV_RANGE = { min: 50, max: 100, step: 1 } as const;

export interface Camera3dSettings {
  enabled: boolean;
  firstPerson: boolean;
  camMove: boolean;
  invertY: boolean;
  sensitivity: number;
  detail: DetailPreset;
  fov: number;
  farAnim: FarAnim;
  ground: Ground;
  weather3d: Weather3d;
}

export type GraphicsRows = Pick<Camera3dSettings, 'detail' | 'farAnim' | 'ground' | 'weather3d'>;
export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export const GRAPHICS_PRESET_NAMES: readonly GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
// Derived, never stored (D5): the lit preset is the first whose rows all match. Medium keeps far pets animating (PC3).
// Low takes the closest distance: the only row that moves the 4× CPU frame (PC16, 2026-10-08: 54–59 → 39–40 ms).
export const GRAPHICS_PRESETS: Readonly<Record<GraphicsPreset, Readonly<GraphicsRows>>> = {
  low: { detail: 'closest', farAnim: 'off', ground: 'low', weather3d: 'simple' },
  medium: { detail: 'near', farAnim: 'full', ground: 'high', weather3d: 'full' },
  high: { detail: 'medium', farAnim: 'full', ground: 'high', weather3d: 'full' },
  ultra: { detail: 'far', farAnim: 'full', ground: 'high', weather3d: 'full' },
};

export const CAMERA3D_DEFAULTS: Readonly<Camera3dSettings> = {
  enabled: true, firstPerson: true, camMove: true, invertY: false, sensitivity: 1, fov: FIRST_PERSON.fov, ...GRAPHICS_PRESETS.high,
};

/** slowSuggested: the one-time "3D is slow" offer (perf Task 11) has been shown. */
export interface Camera3dHints { detent: boolean; firstEntry: boolean; lockError: boolean; slowSuggested: boolean }

const KEYS = {
  enabled: 'qpm.camera3d.enabled.v1',
  firstPerson: 'qpm.camera3d.firstPerson.v1',
  camMove: 'qpm.camera3d.camMove.v1',
  invertY: 'qpm.camera3d.invertY.v1',
  sensitivity: 'qpm.camera3d.sensitivity.v1',
  detail: 'qpm.camera3d.detail.v1',
  fov: 'qpm.camera3d.fov.v1',
  farAnim: 'qpm.camera3d.farAnim.v1',
  ground: 'qpm.camera3d.ground.v1',
  weather3d: 'qpm.camera3d.weather3d.v1',
} as const;
const HINTS_KEY = 'qpm.camera3d.hints.v1';

const listeners = new Set<(s: Camera3dSettings) => void>();

function bool(key: string, dflt: boolean): boolean {
  const v = storage.get<boolean | null>(key, null);
  return v === null ? dflt : v === true;
}

function num(key: string, range: { min: number; max: number }, dflt: number): number {
  const v = storage.get<unknown>(key, null);
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : dflt;
}

function oneOf<T extends string>(key: string, values: readonly T[], dflt: T): T {
  const v = storage.get<unknown>(key, null);
  return values.find((p) => p === v) ?? dflt;
}

export function getCamera3dSettings(): Camera3dSettings {
  const d = CAMERA3D_DEFAULTS;
  return {
    enabled: bool(KEYS.enabled, d.enabled),
    firstPerson: bool(KEYS.firstPerson, d.firstPerson),
    camMove: bool(KEYS.camMove, d.camMove),
    invertY: bool(KEYS.invertY, d.invertY),
    sensitivity: num(KEYS.sensitivity, SENSITIVITY_RANGE, d.sensitivity),
    detail: oneOf(KEYS.detail, DETAIL_PRESETS, d.detail),
    fov: num(KEYS.fov, FOV_RANGE, d.fov),
    farAnim: oneOf(KEYS.farAnim, FAR_ANIM_MODES, d.farAnim),
    ground: oneOf(KEYS.ground, GROUND_LEVELS, d.ground),
    weather3d: oneOf(KEYS.weather3d, WEATHER3D_MODES, d.weather3d),
  };
}

export function graphicsPresetOf(s: GraphicsRows): GraphicsPreset | 'custom' {
  return GRAPHICS_PRESET_NAMES.find((p) => {
    const g = GRAPHICS_PRESETS[p];
    return g.detail === s.detail && g.farAnim === s.farAnim && g.ground === s.ground && g.weather3d === s.weather3d;
  }) ?? 'custom';
}

function storeRows(g: GraphicsRows): void {
  storage.set(KEYS.detail, g.detail);
  storage.set(KEYS.farAnim, g.farAnim);
  storage.set(KEYS.ground, g.ground);
  storage.set(KEYS.weather3d, g.weather3d);
}

function emit(): void {
  const next = getCamera3dSettings();
  for (const cb of listeners) {
    try { cb(next); } catch { /* isolate listeners */ }
  }
}

export function setCamera3dSetting<K extends keyof Camera3dSettings>(key: K, value: Camera3dSettings[K]): void {
  storage.set(KEYS[key], value);
  emit();
}

/** Every option back to its default, with one change event. The Enabled switch is the user's, so it stays. */
export function resetCamera3dSettings(): void {
  const d = CAMERA3D_DEFAULTS;
  storage.set(KEYS.firstPerson, d.firstPerson);
  storage.set(KEYS.camMove, d.camMove);
  storage.set(KEYS.invertY, d.invertY);
  storage.set(KEYS.sensitivity, d.sensitivity);
  storage.set(KEYS.fov, d.fov);
  storeRows(d);
  emit();
}

/** The preset's four rows, with one change event. */
export function applyGraphicsPreset(p: GraphicsPreset): void {
  storeRows(GRAPHICS_PRESETS[p]);
  emit();
}

export function onCamera3dSettingsChange(cb: (s: Camera3dSettings) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getCamera3dHints(): Camera3dHints {
  const h = storage.get<Partial<Camera3dHints> | null>(HINTS_KEY, null) ?? {};
  return { detent: h.detent === true, firstEntry: h.firstEntry === true, lockError: h.lockError === true, slowSuggested: h.slowSuggested === true };
}

export function markCamera3dHint(key: keyof Camera3dHints): void {
  storage.set(HINTS_KEY, { ...getCamera3dHints(), [key]: true });
}

/** Debug: the one-time hints show again (live checks restore what they tripped). */
export function resetCamera3dHints(): void {
  storage.remove(HINTS_KEY);
}
