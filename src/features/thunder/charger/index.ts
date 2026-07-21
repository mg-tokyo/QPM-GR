// Tracks Thundercharger ability cooldowns per ThunderWolf, preferring live
// PetSlot.abilityCooldowns over derived timestamp math. Mirrors DawnCapture
// (src/features/dawn/capture/).

import { subscribeAtomValue } from '../../../core/atomRegistry';
import { onWeatherSnapshot, type WeatherSnapshot } from '../../../store/weatherHub';
import { onActivePetInfos, getActivePetInfos } from '../../../store/pets';
import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';
import {
  THUNDERCHARGER_ABILITY_ID,
  THUNDERCHARGER_ACTION,
  THUNDERCHARGER_COOLDOWN_MS,
} from './constants';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:thunderCharger';
const { diag, ensureBusRegistered, publishOk, warnFeature } =
  createFeatureDiagnostics(FEATURE_SUBSYSTEM, 'thunderCharger');

// Types

export interface ThunderchargerPetState {
  petSlotId: string;
  petName: string;
  lastActivation: number;
  cooldownMs: number;
  /** Last live remaining ms from PetSlot.abilityCooldowns (preferred over derived). */
  liveRemainingMs: number | null;
  affectedCropsTotal: number;
  activations: number;
}

export interface ThunderchargerSnapshot {
  perPet: Map<string, ThunderchargerPetState>;
  isThunderstormActive: boolean;
  sessionActivations: number;
  sessionAffectedCrops: number;
}

// State

const perPet = new Map<string, ThunderchargerPetState>();
let isThunderstormActive = false;
let sessionActivations = 0;
let sessionAffectedCrops = 0;

let myDataUnsubscribe: (() => void) | null = null;
let weatherUnsubscribe: (() => void) | null = null;
let petsUnsubscribe: (() => void) | null = null;
let lastSeenLogLength = 0;
let initialized = false;

const listeners = new Set<(snapshot: ThunderchargerSnapshot) => void>();

// Snapshot

function buildSnapshot(): ThunderchargerSnapshot {
  return {
    perPet: new Map(perPet),
    isThunderstormActive,
    sessionActivations,
    sessionAffectedCrops,
  };
}

function emit(): void {
  const snapshot = buildSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      warnFeature('QPM-FEATURE-004', { what: 'listener:snapshot' }, error);
    }
  }
}

// Activity log processing

function processActivityLogs(rawValue: unknown): void {
  if (!rawValue || typeof rawValue !== 'object') return;

  const data = rawValue as Record<string, unknown>;
  const activityLog = data.activityLog;
  if (!Array.isArray(activityLog)) return;

  if (activityLog.length <= lastSeenLogLength) {
    lastSeenLogLength = activityLog.length;
    return;
  }

  const newEntries = activityLog.slice(lastSeenLogLength);
  lastSeenLogLength = activityLog.length;

  let changed = false;
  for (const entry of newEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const logEntry = entry as Record<string, unknown>;

    if (logEntry.action !== THUNDERCHARGER_ACTION) continue;

    const params = logEntry.parameters as Record<string, unknown> | undefined;
    if (!params) continue;

    const pet = params.pet as Record<string, unknown> | undefined;
    if (!pet) continue;

    const petSlotId = typeof pet.id === 'string' ? pet.id : String(pet.id ?? 'unknown');
    const petName = typeof pet.name === 'string' ? pet.name : 'Thunder Wolf';
    const affectedCrops = typeof params.affectedCrops === 'number' ? params.affectedCrops : 0;

    const timestamp =
      typeof logEntry.timestamp === 'number'
        ? logEntry.timestamp < 1_000_000_000_000
          ? logEntry.timestamp * 1000
          : logEntry.timestamp
        : Date.now();

    const existing = perPet.get(petSlotId);
    const petState: ThunderchargerPetState = {
      petSlotId,
      petName,
      lastActivation: timestamp,
      cooldownMs: THUNDERCHARGER_COOLDOWN_MS,
      liveRemainingMs: existing?.liveRemainingMs ?? null,
      affectedCropsTotal: (existing?.affectedCropsTotal ?? 0) + affectedCrops,
      activations: (existing?.activations ?? 0) + 1,
    };
    perPet.set(petSlotId, petState);

    sessionActivations++;
    sessionAffectedCrops += affectedCrops;
    changed = true;

    diag.debug(`${petName} fired: ${affectedCrops} crops affected`);
  }

  if (changed) emit();
}

// Live cooldown sync (prefer server-authoritative value from PetSlot atom)

function syncLiveCooldownsFromPets(): void {
  let changed = false;
  for (const pet of getActivePetInfos()) {
    if (pet.slotId == null) continue;
    const raw = pet.raw as Record<string, unknown> | null;
    const cd = raw && typeof raw === 'object' ? raw.abilityCooldowns : null;
    if (!cd || typeof cd !== 'object' || Array.isArray(cd)) continue;
    const remaining = (cd as Record<string, unknown>)[THUNDERCHARGER_ABILITY_ID];
    if (typeof remaining !== 'number') continue;

    const existing = perPet.get(pet.slotId);
    if (existing && existing.liveRemainingMs === remaining) continue;

    if (existing) {
      existing.liveRemainingMs = remaining;
    } else {
      perPet.set(pet.slotId, {
        petSlotId: pet.slotId,
        petName: pet.name ?? 'Thunder Wolf',
        lastActivation: Date.now() - (THUNDERCHARGER_COOLDOWN_MS - remaining),
        cooldownMs: THUNDERCHARGER_COOLDOWN_MS,
        liveRemainingMs: remaining,
        affectedCropsTotal: 0,
        activations: 0,
      });
    }
    changed = true;
  }
  if (changed) emit();
}

// Weather tracking

function handleWeather(snapshot: WeatherSnapshot): void {
  const nowThunder = snapshot.kind === 'thunderstorm';
  if (isThunderstormActive !== nowThunder) {
    isThunderstormActive = nowThunder;
    emit();
  }
}

// Public API

export function startThunderchargerTracker(): void {
  if (initialized) return;
  initialized = true;
  lastSeenLogLength = 0;
  perPet.clear();
  sessionActivations = 0;
  sessionAffectedCrops = 0;
  ensureBusRegistered();

  void subscribeAtomValue('myData', (value) => {
    processActivityLogs(value);
  })
    .then((unsubscribe) => {
      if (!unsubscribe) return;
      if (!initialized) {
        unsubscribe();
        return;
      }
      myDataUnsubscribe = unsubscribe;
    })
    .catch((error) => {
      warnFeature('QPM-FEATURE-003', { what: 'subscribe:myData' }, error);
    });

  weatherUnsubscribe = onWeatherSnapshot(handleWeather, true);
  petsUnsubscribe = onActivePetInfos(() => {
    syncLiveCooldownsFromPets();
  });

  publishOk('Started', { isThunderstormActive: isThunderstormActive ? 1 : 0 });
}

export function stopThunderchargerTracker(): void {
  if (!initialized) return;
  initialized = false;
  myDataUnsubscribe?.();
  myDataUnsubscribe = null;
  weatherUnsubscribe?.();
  weatherUnsubscribe = null;
  petsUnsubscribe?.();
  petsUnsubscribe = null;
  listeners.clear();
  perPet.clear();
  lastSeenLogLength = 0;
}

export function subscribeThundercharger(listener: (snapshot: ThunderchargerSnapshot) => void): () => void {
  listeners.add(listener);
  if (initialized) {
    try {
      listener(buildSnapshot());
    } catch (error) {
      warnFeature('QPM-FEATURE-004', { what: 'listener:immediate' }, error);
    }
  }
  return () => { listeners.delete(listener); };
}

export function getThunderchargerSnapshot(): ThunderchargerSnapshot {
  return buildSnapshot();
}

/** Remaining cooldown ms; prefers live PetSlot.abilityCooldowns over derived math. */
export function getCooldownRemainingMs(petSlotId: string): number {
  const pet = perPet.get(petSlotId);
  if (!pet) return 0;
  if (pet.liveRemainingMs != null) return Math.max(0, pet.liveRemainingMs);
  const elapsed = Date.now() - pet.lastActivation;
  return Math.max(0, pet.cooldownMs - elapsed);
}
