// src/data/customCardPresets.ts
//
// Storage layer + built-in registry for user custom card presets (Phase 2a of
// the native card system). A preset bundles a portrait source (image/video URL
// or data URL) with a phantom InventoryItem that drives the native card view's
// species/mutations/abilities rendering.
//
// Built-in presets (TOKYO etc.) are hardcoded and reference external asset URLs.
// User presets are persisted under `qpm.customCards.presets.v1` and carry a
// canonical data URL so they survive offline.

import type { PhantomInventoryItem, SpeciesOverrides } from '../integrations/nativeCardView';
import { storage } from '../utils/storage';
import { createNamedLogger } from '../diagnostics/logger';

const diagLog = createNamedLogger('customCardPresets');
import {
  TOKYO_CARD,
  TOKYO_CARD_VIDEO_URL,
  TOKYO_CARD_PREVIEW_URL,
} from './tokyoCard';

export const CUSTOM_CARD_PRESETS_KEY = 'qpm.customCards.presets.v1';

/** Hard cap on user presets. Built-ins don't count. */
export const MAX_USER_PRESETS = 20;
/** Soft warning threshold for a single preset's serialized size. */
export const PRESET_SIZE_SOFT_WARN_BYTES = 500 * 1024;
/** Hard refusal threshold for a single preset's serialized size. */
export const PRESET_SIZE_HARD_LIMIT_BYTES = 2 * 1024 * 1024;

export type CustomCardPresetSource =
  | 'builtin'
  | 'export-url'
  | 'file'
  | 'data-url';

export interface CustomCardPreset {
  id: string;
  name: string;
  source: CustomCardPresetSource;
  createdAt: number;
  /**
   * Canonical portrait data URL. Always present on user presets so they survive
   * offline. Optional for built-ins, which reference external URLs.
   */
  portraitDataUrl?: string;
  /** External image URL — used by built-ins and remembered when source === 'export-url'. */
  portraitUrl?: string;
  /** Looping video URL (WebM/MP4). Built-ins only in Phase 2a; opens to users in 2b. */
  videoUrl?: string;
  /** Render as a full-card takeover instead of portrait-only overlay. */
  fullTakeover?: boolean;
  /** Phantom inventory item driving the native card view. */
  item: PhantomInventoryItem;
  /** Stat slider values. If absent on load, defaults preserve legacy hardcoded values
   *  (xp: 999999, hunger: 350, targetScale: 2.5) for visual parity with shipped behavior. */
  stats?: { xp?: number; hunger?: number; targetScale?: number };
  /** Species-property overrides applied at card-open time. If absent, no patches are applied. */
  overrides?: SpeciesOverrides;
}

/**
 * Built-in presets shipped with QPM. Not persisted — they live in code and
 * reference external asset URLs hosted alongside the userscript.
 */
export const BUILT_IN_PRESETS: readonly CustomCardPreset[] = [
  {
    id: 'qpm-builtin-tokyo',
    name: 'TOKYO',
    source: 'builtin',
    createdAt: 0,
    portraitUrl: TOKYO_CARD_PREVIEW_URL,
    videoUrl: TOKYO_CARD_VIDEO_URL,
    fullTakeover: true,
    item: TOKYO_CARD,
  },
] as const;

export type PresetValidationError =
  | { kind: 'shape'; reason: string }
  | { kind: 'size-exceeded'; bytes: number; limit: number }
  | { kind: 'cap-exceeded'; current: number; limit: number };

export interface PresetValidationResult {
  ok: boolean;
  bytes: number;
  softWarn: boolean;
  error?: PresetValidationError;
}

function generatePresetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `qpm-card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPhantomItem(value: unknown): value is PhantomInventoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string') return false;
  if (typeof item.itemType !== 'string') return false;
  if (typeof item.name !== 'string') return false;
  if (typeof item.xp !== 'number') return false;
  if (typeof item.hunger !== 'number') return false;
  if (typeof item.targetScale !== 'number') return false;
  if (!isStringArray(item.mutations)) return false;
  if (!isStringArray(item.abilities)) return false;
  if (!item.abilityCooldowns || typeof item.abilityCooldowns !== 'object') return false;
  return true;
}

function isPresetShape(value: unknown): value is CustomCardPreset {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (typeof p.id !== 'string') return false;
  if (typeof p.name !== 'string') return false;
  if (typeof p.source !== 'string') return false;
  if (typeof p.createdAt !== 'number') return false;
  if (!isPhantomItem(p.item)) return false;
  // Portrait sources are all optional — a preset with no portrait renders the
  // species' native Rive sprite via the bridge's no-overlay path.
  return true;
}

function measureBytes(preset: CustomCardPreset): number {
  try {
    return JSON.stringify(preset).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Validate a candidate preset against size limits and shape. Does NOT check the
 * user-preset cap — pass `existingUserCount` to enforce that separately.
 */
export function validatePreset(
  preset: CustomCardPreset,
  existingUserCount?: number,
): PresetValidationResult {
  if (!isPresetShape(preset)) {
    return { ok: false, bytes: 0, softWarn: false, error: { kind: 'shape', reason: 'invalid preset shape' } };
  }
  const bytes = measureBytes(preset);
  if (bytes > PRESET_SIZE_HARD_LIMIT_BYTES) {
    return {
      ok: false,
      bytes,
      softWarn: false,
      error: { kind: 'size-exceeded', bytes, limit: PRESET_SIZE_HARD_LIMIT_BYTES },
    };
  }
  if (
    typeof existingUserCount === 'number' &&
    preset.source !== 'builtin' &&
    existingUserCount >= MAX_USER_PRESETS
  ) {
    return {
      ok: false,
      bytes,
      softWarn: false,
      error: { kind: 'cap-exceeded', current: existingUserCount, limit: MAX_USER_PRESETS },
    };
  }
  return { ok: true, bytes, softWarn: bytes > PRESET_SIZE_SOFT_WARN_BYTES };
}

/** Load persisted user presets. Malformed entries are dropped silently. */
export function loadUserPresets(): CustomCardPreset[] {
  const raw = storage.get<unknown>(CUSTOM_CARD_PRESETS_KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: CustomCardPreset[] = [];
  for (const entry of raw) {
    if (isPresetShape(entry)) {
      out.push(entry);
    } else {
      diagLog.info('dropped malformed preset on load', { entry });
    }
  }
  return out;
}

function saveUserPresets(presets: CustomCardPreset[]): void {
  storage.set(CUSTOM_CARD_PRESETS_KEY, presets);
}

/** All presets (built-ins first, then user presets in creation order). */
export function listAllPresets(): CustomCardPreset[] {
  return [...BUILT_IN_PRESETS, ...loadUserPresets()];
}

export function getPresetById(id: string): CustomCardPreset | null {
  for (const builtin of BUILT_IN_PRESETS) {
    if (builtin.id === id) return builtin;
  }
  const users = loadUserPresets();
  for (const user of users) {
    if (user.id === id) return user;
  }
  return null;
}

export interface AddPresetInput {
  name: string;
  source: Exclude<CustomCardPresetSource, 'builtin'>;
  /** Canonical data URL — preferred for offline robustness, but optional. */
  portraitDataUrl?: string;
  /** External image URL (e.g. when copying a built-in or remembering the source). */
  portraitUrl?: string;
  /** External video URL — carried through from built-ins; user video upload arrives in 2b. */
  videoUrl?: string;
  fullTakeover?: boolean;
  item: PhantomInventoryItem;
  stats?: { xp?: number; hunger?: number; targetScale?: number };
  overrides?: SpeciesOverrides;
}

export interface AddPresetResult {
  ok: boolean;
  preset?: CustomCardPreset;
  validation: PresetValidationResult;
}

/**
 * Build a new preset, validate it, and persist on success. Returns the
 * validation result either way so callers can surface size/cap warnings.
 */
export function addUserPreset(input: AddPresetInput): AddPresetResult {
  const preset: CustomCardPreset = {
    id: generatePresetId(),
    name: input.name,
    source: input.source,
    createdAt: Date.now(),
    item: input.item,
    ...(input.portraitDataUrl !== undefined ? { portraitDataUrl: input.portraitDataUrl } : {}),
    ...(input.portraitUrl !== undefined ? { portraitUrl: input.portraitUrl } : {}),
    ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
    ...(input.fullTakeover !== undefined ? { fullTakeover: input.fullTakeover } : {}),
    ...(input.stats !== undefined ? { stats: input.stats } : {}),
    ...(input.overrides !== undefined ? { overrides: input.overrides } : {}),
  };
  const existing = loadUserPresets();
  const validation = validatePreset(preset, existing.length);
  if (!validation.ok) {
    return { ok: false, validation };
  }
  saveUserPresets([...existing, preset]);
  return { ok: true, preset, validation };
}

export function removeUserPreset(id: string): boolean {
  const existing = loadUserPresets();
  const next = existing.filter((p) => p.id !== id);
  if (next.length === existing.length) return false;
  saveUserPresets(next);
  return true;
}

export interface UpdatePresetPatch {
  name?: string;
  portraitDataUrl?: string;
  portraitUrl?: string;
  videoUrl?: string;
  fullTakeover?: boolean;
  item?: PhantomInventoryItem;
  stats?: { xp?: number; hunger?: number; targetScale?: number };
  overrides?: SpeciesOverrides;
}

export interface UpdatePresetResult {
  ok: boolean;
  preset?: CustomCardPreset;
  validation?: PresetValidationResult;
  reason?: 'not-found' | 'builtin' | 'invalid';
}

/**
 * Patch a user preset by id. Built-in presets cannot be edited. Validation
 * runs on the merged preset so size limits and shape rules still apply.
 */
export function updateUserPreset(id: string, patch: UpdatePresetPatch): UpdatePresetResult {
  if (BUILT_IN_PRESETS.some((p) => p.id === id)) {
    return { ok: false, reason: 'builtin' };
  }
  const existing = loadUserPresets();
  const index = existing.findIndex((p) => p.id === id);
  if (index === -1) return { ok: false, reason: 'not-found' };
  const base = existing[index]!;
  const merged: CustomCardPreset = {
    ...base,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.portraitDataUrl !== undefined ? { portraitDataUrl: patch.portraitDataUrl } : {}),
    ...(patch.portraitUrl !== undefined ? { portraitUrl: patch.portraitUrl } : {}),
    ...(patch.videoUrl !== undefined ? { videoUrl: patch.videoUrl } : {}),
    ...(patch.fullTakeover !== undefined ? { fullTakeover: patch.fullTakeover } : {}),
    ...(patch.item !== undefined ? { item: patch.item } : {}),
    ...(patch.stats !== undefined ? { stats: patch.stats } : {}),
    ...(patch.overrides !== undefined ? { overrides: patch.overrides } : {}),
  };
  const validation = validatePreset(merged);
  if (!validation.ok) {
    return { ok: false, validation, reason: 'invalid' };
  }
  const next = existing.slice();
  next[index] = merged;
  saveUserPresets(next);
  return { ok: true, preset: merged, validation };
}
