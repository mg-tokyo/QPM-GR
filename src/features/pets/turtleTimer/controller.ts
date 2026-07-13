import { log } from '../../../utils/logger';
import { pageWindow } from '../../../core/pageContext';
import { type GardenSnapshot, onGardenSnapshot } from '../../garden/bridge';
import { type ActivePetInfo, onActivePetInfos, startPetInfoStore } from '../../../store/pets';
import { debugEggDetection } from './debug';
import { loadManualOverrides } from './overrides';
import { recompute } from './recompute';
import { config, getState, latest, listeners, resetState } from './state';
import type { DebugEggDetectionOptions, TurtleTimerConfig, TurtleTimerState } from './types';

let initialized = false;
let gardenUnsubscribe: (() => void) | null = null;
let petUnsubscribe: (() => void) | null = null;
let lastTurtleGardenFingerprint = '';
let lastTurtlePetFingerprint = '';

// Cheap fingerprint over the pet fields recompute actually reads. Bucketing
// strength / xp / targetScale prevents 1 Hz strength rolls from firing recompute
// every tick while still catching real changes when a pet crosses a bucket.
// Includes species/name/mutations because the published contribution surfaces
// them for downstream display — a rename or mutation swap should recompute.
function getTurtlePetFingerprint(pets: ActivePetInfo[]): string {
  let sig = `${pets.length}|${config.minActiveHungerPct}|${config.maxTargetScale}`;
  for (const pet of pets) {
    if (!pet || typeof pet !== 'object') continue;
    const abilities = Array.isArray(pet.abilities) ? pet.abilities.join(',') : '';
    const mutations = Array.isArray(pet.mutations) ? pet.mutations.join(',') : '';
    const hungerOk = pet.hungerPct == null || pet.hungerPct > config.minActiveHungerPct ? '1' : '0';
    const strengthBucket = Math.floor((pet.strength ?? 0) / 5);
    const xpBucket = Math.floor((pet.xp ?? 0) / 100);
    const level = pet.level ?? 0;
    const targetScale = Math.round((pet.targetScale ?? 0) * 100);
    sig += `#${pet.petId ?? pet.slotId ?? ''}:${pet.species ?? ''}:${pet.name ?? ''}:${abilities}:${mutations}:${hungerOk}:${strengthBucket}:${xpBucket}:${level}:${targetScale}`;
  }
  return sig;
}

// Cheap fingerprint (slot count + endTime sum) to skip recompute when nothing changed.
function getTurtleGardenFingerprint(snapshot: GardenSnapshot): string {
  if (!snapshot?.tileObjects) return '';
  let slotCount = 0;
  let endTimeSum = 0;
  for (const rawTile of Object.values(snapshot.tileObjects)) {
    if (!rawTile || typeof rawTile !== 'object') continue;
    const tile = rawTile as Record<string, unknown>;
    const slots = Array.isArray(tile.slots) ? (tile.slots as Record<string, unknown>[]) : [];
    for (const slot of slots) {
      const endTime = typeof slot?.endTime === 'number' ? slot.endTime : 0;
      slotCount++;
      endTimeSum += endTime;
    }
  }
  return `${slotCount}:${endTimeSum}`;
}

function mergeConfig(next?: TurtleTimerConfig): void {
  if (!next) {
    return;
  }
  if (typeof next.enabled === 'boolean') {
    config.enabled = next.enabled;
  }
  if (typeof next.includeBoardwalk === 'boolean') {
    config.includeBoardwalk = next.includeBoardwalk;
  }
  if (typeof next.minActiveHungerPct === 'number' && Number.isFinite(next.minActiveHungerPct)) {
    const bounded = Math.max(0, Math.min(100, Math.round(next.minActiveHungerPct)));
    config.minActiveHungerPct = bounded;
  }
  if (typeof next.fallbackTargetScale === 'number' && Number.isFinite(next.fallbackTargetScale)) {
    const sanitized = Math.max(1, Math.min(config.maxTargetScale, next.fallbackTargetScale));
    config.fallbackTargetScale = sanitized;
  }
  if (next.focus === 'latest' || next.focus === 'earliest' || next.focus === 'specific') {
    config.focus = next.focus;
  }
  if (typeof next.focusTargetTileId === 'string' || next.focusTargetTileId === null) {
    config.focusTargetTileId = next.focusTargetTileId ?? null;
  }
  if (typeof next.focusTargetSlotIndex === 'number' && Number.isFinite(next.focusTargetSlotIndex)) {
    config.focusTargetSlotIndex = Math.max(0, Math.round(next.focusTargetSlotIndex));
  } else if (next.focusTargetSlotIndex === null) {
    config.focusTargetSlotIndex = null;
  }
  if (next.eggFocus === 'latest' || next.eggFocus === 'earliest' || next.eggFocus === 'specific') {
    config.eggFocus = next.eggFocus;
  }
  if (typeof next.eggFocusTargetTileId === 'string' || next.eggFocusTargetTileId === null) {
    config.eggFocusTargetTileId = next.eggFocusTargetTileId ?? null;
  }
  if (typeof next.eggFocusTargetSlotIndex === 'number' && Number.isFinite(next.eggFocusTargetSlotIndex)) {
    config.eggFocusTargetSlotIndex = Math.max(0, Math.round(next.eggFocusTargetSlotIndex));
  } else if (next.eggFocusTargetSlotIndex === null) {
    config.eggFocusTargetSlotIndex = null;
  }
}

export function initializeTurtleTimer(initialConfig?: TurtleTimerConfig): void {
  if (initialized) {
    if (initialConfig) {
      configureTurtleTimer(initialConfig);
    }
    return;
  }
  initialized = true;

  // Load manual overrides from storage
  loadManualOverrides();

  mergeConfig(initialConfig);

  try {
    const attach = (options?: DebugEggDetectionOptions) => debugEggDetection(options);
    (pageWindow as Window & { debugEggDetection?: (options?: DebugEggDetectionOptions) => void }).debugEggDetection = attach;
    if (typeof window !== 'undefined' && window !== pageWindow) {
      (window as Window & { debugEggDetection?: (options?: DebugEggDetectionOptions) => void }).debugEggDetection = attach;
    }
  } catch (error) {
    log('⚠️ Unable to attach debugEggDetection helper', error);
  }

  void startPetInfoStore();

  gardenUnsubscribe = onGardenSnapshot((snapshot) => {
    latest.garden = snapshot;
    const fp = getTurtleGardenFingerprint(snapshot);
    if (fp === lastTurtleGardenFingerprint) return;
    lastTurtleGardenFingerprint = fp;
    recompute();
  });

  petUnsubscribe = onActivePetInfos((infos) => {
    latest.pets = infos;
    const fp = getTurtlePetFingerprint(infos);
    if (fp === lastTurtlePetFingerprint) return;
    lastTurtlePetFingerprint = fp;
    recompute();
  });

  recompute();
  log('🐢 Turtle timer ready');
}

export function disposeTurtleTimer(): void {
  gardenUnsubscribe?.();
  gardenUnsubscribe = null;
  petUnsubscribe?.();
  petUnsubscribe = null;
  initialized = false;
  lastTurtleGardenFingerprint = '';
  lastTurtlePetFingerprint = '';
  resetState();
}

export function configureTurtleTimer(next: TurtleTimerConfig): void {
  mergeConfig(next);
  // Config changes may affect the pet fingerprint (minActiveHungerPct,
  // maxTargetScale). Reset so the next petInfos push always recomputes.
  lastTurtlePetFingerprint = '';
  recompute();
}

export function setTurtleTimerEnabled(enabled: boolean): void {
  configureTurtleTimer({ enabled });
}

export function getTurtleTimerState(): TurtleTimerState {
  return getState();
}

export function onTurtleTimerState(
  listener: (snapshot: TurtleTimerState) => void,
  fireImmediately = true,
): () => void {
  listeners.add(listener);
  if (fireImmediately) {
    try {
      listener(getState());
    } catch (error) {
      log('⚠️ Turtle timer immediate listener error', error);
    }
  }
  return () => {
    listeners.delete(listener);
  };
}
