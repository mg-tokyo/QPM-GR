// src/ui/shopRestockAlerts/soundConfig.ts
// Per-item sound configuration storage — CRUD helpers for restock sound alerts.

import { storage } from '../../../utils/storage';
import { canonicalItemId } from '../../../utils/restock/dataService';

// ---------------------------------------------------------------------------
// Key normalization — must match the canonical key format used by the alert
// system (see ownershipTracker.toCanonicalKey). Without this, a config saved
// from the tracker row (raw key like "seed:Rose") would not be found when
// the alert system looks it up with the canonical key ("seed:rose").
// ---------------------------------------------------------------------------

export function normalizeSoundKey(key: string): string {
  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) return key.trim().toLowerCase();
  const shopType = key.slice(0, colonIdx);
  const itemId = key.slice(colonIdx + 1);
  const canonical = canonicalItemId(shopType, itemId).trim().toLowerCase();
  return `${shopType}:${canonical}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOUND_CONFIG_KEY = 'qpm.restock.soundConfig.v1';
const CUSTOM_SOUNDS_KEY = 'qpm.restock.customSounds.v1';
const MAX_CUSTOM_SOUNDS = 10;
const MAX_CUSTOM_SOUND_BYTES = 500 * 1024; // 500KB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ItemSoundConfig {
  soundId: string;
  mode: 'once' | 'loop';
  volume: number; // 0–1, default 0.7
  intervalMs: number; // loop repeat interval in ms, default 3000
}

export interface CustomSoundEntry {
  name: string;
  dataUrl: string;
}

export interface BuiltinSoundDef {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Built-in sound definitions
// ---------------------------------------------------------------------------

export const BUILTIN_SOUNDS: readonly BuiltinSoundDef[] = [
  { id: 'ping',    name: 'Ping' },
  { id: 'chime',   name: 'Chime' },
  { id: 'bell',    name: 'Bell' },
  { id: 'alert',   name: 'Alert' },
  { id: 'gentle',  name: 'Gentle' },
] as const;

export const DEFAULT_LOOP_INTERVAL_MS = 3_000;

export const BUILTIN_SOUND_IDS = new Set(BUILTIN_SOUNDS.map(s => s.id));

// ---------------------------------------------------------------------------
// Sound config CRUD
// ---------------------------------------------------------------------------

function readAllConfigs(): Record<string, ItemSoundConfig> {
  return storage.get<Record<string, ItemSoundConfig>>(SOUND_CONFIG_KEY, {});
}

function writeAllConfigs(configs: Record<string, ItemSoundConfig>): void {
  storage.set(SOUND_CONFIG_KEY, configs);
}

export function getSoundConfig(itemKey: string): ItemSoundConfig | null {
  const all = readAllConfigs();
  return all[normalizeSoundKey(itemKey)] ?? null;
}

export function setSoundConfig(itemKey: string, config: ItemSoundConfig): void {
  const all = readAllConfigs();
  all[normalizeSoundKey(itemKey)] = config;
  writeAllConfigs(all);
}

export function removeSoundConfig(itemKey: string): void {
  const nk = normalizeSoundKey(itemKey);
  const all = readAllConfigs();
  if (!(nk in all)) return;
  delete all[nk];
  writeAllConfigs(all);
}

export function getAllSoundConfigs(): Record<string, ItemSoundConfig> {
  return readAllConfigs();
}

// ---------------------------------------------------------------------------
// Custom sounds CRUD
// ---------------------------------------------------------------------------

function readCustomSounds(): Record<string, CustomSoundEntry> {
  return storage.get<Record<string, CustomSoundEntry>>(CUSTOM_SOUNDS_KEY, {});
}

function writeCustomSounds(sounds: Record<string, CustomSoundEntry>): void {
  storage.set(CUSTOM_SOUNDS_KEY, sounds);
}

export function getCustomSounds(): Record<string, CustomSoundEntry> {
  return readCustomSounds();
}

/**
 * Add a custom sound. Returns the generated ID.
 * Enforces max 500KB per sound and max 10 custom sounds.
 */
export function addCustomSound(name: string, dataUrl: string): string {
  const byteLen = dataUrl.length; // rough — base64 data URLs are ~1.37× raw
  if (byteLen > MAX_CUSTOM_SOUND_BYTES) {
    throw new Error(`Custom sound exceeds ${MAX_CUSTOM_SOUND_BYTES / 1024}KB limit`);
  }
  const all = readCustomSounds();
  if (Object.keys(all).length >= MAX_CUSTOM_SOUNDS) {
    throw new Error(`Maximum of ${MAX_CUSTOM_SOUNDS} custom sounds reached`);
  }
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  all[id] = { name, dataUrl };
  writeCustomSounds(all);
  return id;
}

export function removeCustomSound(id: string): void {
  const all = readCustomSounds();
  if (!(id in all)) return;
  delete all[id];
  writeCustomSounds(all);
}
