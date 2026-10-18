import { storage } from '../../utils/storage';

export type SpectatorAction =
  | 'toggle' | 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'fast' | 'prevPlayer' | 'nextPlayer'
  | 'detach' | 'view' | 'followStyle' | 'saveWaypoint' | 'prevWaypoint' | 'nextWaypoint' | 'director' | 'infoCard'
  | 'photo' | 'hideUi';

export interface SpectatorSettings {
  enabled: boolean;
  /** normalizeKeybind form (src/ui/pets/petsWindow/helpers.ts); 'shift' for fast is the held modifier. */
  keys: Record<SpectatorAction, string>;
  /** × 600 CSS px/s on screen. */
  flySpeed: number;
  directorEverySec: number;
  directorEarly: boolean;
  autoStart: boolean;
}

// Arrow keys mirror WASD and Esc / seat digits are fixed (plan Global constraints), so they are not rows here.
const DEFAULT_KEYS: Readonly<Record<SpectatorAction, string>> = {
  toggle: 'g', forward: 'w', back: 's', left: 'a', right: 'd', up: 'e', down: 'q', fast: 'shift',
  prevPlayer: '[', nextPlayer: ']', detach: 'f', view: 'v', followStyle: 'c', saveWaypoint: 'b',
  prevWaypoint: ',', nextWaypoint: '.', director: 't', infoCard: 'i', photo: 'p', hideUi: 'h',
};
export const SPECTATOR_ACTIONS = Object.keys(DEFAULT_KEYS) as readonly SpectatorAction[];

// Clamp bounds for stored values, and the settings card's slider ends. "Switch every" spans S §7's ~10–60 s.
export const FLY_SPEED_RANGE = { min: 0.25, max: 4 } as const;
export const DIRECTOR_EVERY_RANGE = { min: 10, max: 60 } as const;

export const SPECTATOR_DEFAULTS: Readonly<SpectatorSettings> = {
  enabled: true, keys: { ...DEFAULT_KEYS }, flySpeed: 1, directorEverySec: 30, directorEarly: true, autoStart: true,
};

const KEY = 'qpm.spectator.settings.v1';
const listeners = new Set<(s: SpectatorSettings) => void>();

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, r: { min: number; max: number }, d: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : d);

/** Per-field fallback, so one corrupt field never resets the rest. */
export function parseSpectatorSettings(raw: unknown): SpectatorSettings {
  const d = SPECTATOR_DEFAULTS;
  const o = isObj(raw) ? raw : {};
  const storedKeys = isObj(o.keys) ? o.keys : {};
  const keys = { ...d.keys };
  for (const a of SPECTATOR_ACTIONS) {
    const k = storedKeys[a];
    if (typeof k === 'string' && k.length > 0) keys[a] = k;
  }
  return {
    enabled: bool(o.enabled, d.enabled),
    keys,
    flySpeed: num(o.flySpeed, FLY_SPEED_RANGE, d.flySpeed),
    directorEverySec: num(o.directorEverySec, DIRECTOR_EVERY_RANGE, d.directorEverySec),
    directorEarly: bool(o.directorEarly, d.directorEarly),
    autoStart: bool(o.autoStart, d.autoStart),
  };
}

export function getSpectatorSettings(): SpectatorSettings {
  return parseSpectatorSettings(storage.get<unknown>(KEY, null));
}

function save(next: SpectatorSettings): void {
  storage.set(KEY, next);
  const snapshot = getSpectatorSettings();
  for (const cb of [...listeners]) {
    try { cb(snapshot); } catch { /* isolate listeners */ }
  }
}

export function setSpectatorSetting<K extends keyof SpectatorSettings>(key: K, value: SpectatorSettings[K]): void {
  save({ ...getSpectatorSettings(), [key]: value });
}

/** Every option back to its default, with one change event. The Enabled switch is the user's, so it stays. */
export function resetSpectatorSettings(): void {
  save({ ...SPECTATOR_DEFAULTS, keys: { ...DEFAULT_KEYS }, enabled: getSpectatorSettings().enabled });
}

export function onSpectatorSettingsChange(cb: (s: SpectatorSettings) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const HINTS_KEY = 'qpm.spectator.hints.v1';
export interface SpectatorHints { entered: boolean }

export function getSpectatorHints(): SpectatorHints {
  const h = storage.get<unknown>(HINTS_KEY, null);
  return { entered: isObj(h) && h.entered === true };
}

export function markSpectatorHint(key: keyof SpectatorHints): void {
  storage.set(HINTS_KEY, { ...getSpectatorHints(), [key]: true });
}

/** Debug: the one-time hints show again (live checks restore what they tripped). */
export function resetSpectatorHints(): void {
  storage.remove(HINTS_KEY);
}
