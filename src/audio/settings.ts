import { storage } from '../utils/storage';

const PREFS_KEY = 'qpm.audio.prefs.v1';

const GAME_MUTE_KEY = 'isSoundEffectsMuteAtom';
const GAME_VOLUME_KEY = 'soundEffectsVolumeAtom';

interface AudioPrefs {
  masterMultiplier?: number;
  featureMultipliers?: Record<string, number>;
}

let prefs: AudioPrefs = {};

export function loadAudioPrefs(): void {
  const raw = storage.get<AudioPrefs | null>(PREFS_KEY, null);
  if (raw && typeof raw === 'object') prefs = raw;
}

/**
 * These are no-ops kept for API compatibility. The game's mute/volume live in
 * localStorage as plain persistedAtom keys (see beta store/utils.ts:90-98 —
 * atoms carry no debugLabel, so atomRegistry cannot find them; localStorage
 * is the source of truth and is read lazily on each isMuted/getSystemVolume
 * call).
 */
export async function startAudioSettingsSubscriptions(): Promise<void> { /* noop */ }
export function stopAudioSettingsSubscriptions(): void { /* noop */ }

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : fallback;
  } catch { return fallback; }
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

export function isMuted(): boolean { return readBool(GAME_MUTE_KEY, false); }
export function getSystemVolume(): number { return readNumber(GAME_VOLUME_KEY, 0.1); }

export function getEffectiveVolume(feature?: string, multiplier?: number, override?: number): number {
  if (override !== undefined) return clamp01(override);
  if (isMuted()) return 0;
  const master = prefs.masterMultiplier ?? 1;
  const perFeature = feature && prefs.featureMultipliers ? (prefs.featureMultipliers[feature] ?? 1) : 1;
  const m = multiplier ?? 1;
  return clamp01(getSystemVolume() * master * perFeature * m);
}

export function setMasterMultiplier(v: number): void {
  prefs.masterMultiplier = clamp01(v);
  persist();
}

export function setFeatureMultiplier(feature: string, v: number): void {
  prefs.featureMultipliers = prefs.featureMultipliers ?? {};
  prefs.featureMultipliers[feature] = clamp01(v);
  persist();
}

export function getPrefsSnapshot(): AudioPrefs {
  return { ...prefs, featureMultipliers: { ...(prefs.featureMultipliers ?? {}) } };
}

function persist(): void { storage.set(PREFS_KEY, prefs); }

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
