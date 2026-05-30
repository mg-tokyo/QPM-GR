// src/features/dawnCapture/index.ts
// Tracks DawnCapture ability cooldowns per Hedgehog.
// Listens for 'dawnCapture' activity log entries and maintains per-pet
// cooldown timers. Provides a subscribable snapshot for UI overlays.

import { log } from '../../../utils/logger';
import { getAtomByLabel, subscribeAtom } from '../../../core/jotaiBridge';
import { onWeatherSnapshot, type WeatherSnapshot } from '../../../store/weatherHub';
import { DAWN_CAPTURE_ACTION } from '../capsule/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DawnCapturePetState {
  petSlotId: string;
  petName: string;
  lastActivation: number;
  cooldownMs: number;
  dawnlitRemoved: number;
  dawnboundRemoved: number;
  capsulesProduced: number;
}

export interface DawnCaptureSnapshot {
  perPet: Map<string, DawnCapturePetState>;
  isDawnActive: boolean;
  sessionCaptures: number;
  sessionCapsulesProduced: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** DawnCapture cooldown in ms (5 minutes, from beta faunaAbilitiesDex). */
const DAWN_CAPTURE_COOLDOWN_MS = 300_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const perPet = new Map<string, DawnCapturePetState>();
let isDawnActive = false;
let sessionCaptures = 0;
let sessionCapsulesProduced = 0;

let myDataUnsubscribe: (() => void) | null = null;
let weatherUnsubscribe: (() => void) | null = null;
let lastSeenLogLength = 0;
let initialized = false;

const listeners = new Set<(snapshot: DawnCaptureSnapshot) => void>();

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function buildSnapshot(): DawnCaptureSnapshot {
  return {
    perPet: new Map(perPet),
    isDawnActive,
    sessionCaptures,
    sessionCapsulesProduced,
  };
}

function emit(): void {
  const snapshot = buildSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      log('[DawnCapture] listener error', error);
    }
  }
}

// ---------------------------------------------------------------------------
// Activity log processing
// ---------------------------------------------------------------------------

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

    if (logEntry.action !== DAWN_CAPTURE_ACTION) continue;

    const params = logEntry.parameters as Record<string, unknown> | undefined;
    if (!params) continue;

    const pet = params.pet as Record<string, unknown> | undefined;
    if (!pet) continue;

    const petSlotId = typeof pet.id === 'string' ? pet.id : String(pet.id ?? 'unknown');
    const petName = typeof pet.name === 'string' ? pet.name : 'Hedgehog';
    const dawnlitRemoved = typeof params.dawnlitRemoved === 'number' ? params.dawnlitRemoved : 0;
    const dawnboundRemoved = typeof params.dawnboundRemoved === 'number' ? params.dawnboundRemoved : 0;
    const capsulesAdded = typeof params.capsulesAdded === 'number' ? params.capsulesAdded : 0;

    const timestamp =
      typeof logEntry.timestamp === 'number'
        ? logEntry.timestamp < 1_000_000_000_000
          ? logEntry.timestamp * 1000
          : logEntry.timestamp
        : Date.now();

    const existing = perPet.get(petSlotId);
    const petState: DawnCapturePetState = {
      petSlotId,
      petName,
      lastActivation: timestamp,
      cooldownMs: DAWN_CAPTURE_COOLDOWN_MS,
      dawnlitRemoved: (existing?.dawnlitRemoved ?? 0) + dawnlitRemoved,
      dawnboundRemoved: (existing?.dawnboundRemoved ?? 0) + dawnboundRemoved,
      capsulesProduced: (existing?.capsulesProduced ?? 0) + capsulesAdded,
    };
    perPet.set(petSlotId, petState);

    sessionCaptures++;
    sessionCapsulesProduced += capsulesAdded;
    changed = true;

    log(
      `[DawnCapture] ${petName} captured: ${capsulesAdded} capsule(s), ` +
      `removed ${dawnlitRemoved} dawnlit + ${dawnboundRemoved} dawnbound`,
    );
  }

  if (changed) {
    emit();
  }
}

// ---------------------------------------------------------------------------
// Weather tracking
// ---------------------------------------------------------------------------

function handleWeather(snapshot: WeatherSnapshot): void {
  const nowDawn = snapshot.kind === 'dawn';
  if (isDawnActive !== nowDawn) {
    isDawnActive = nowDawn;
    emit();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startDawnCaptureTracker(): void {
  if (initialized) return;
  initialized = true;
  lastSeenLogLength = 0;
  perPet.clear();
  sessionCaptures = 0;
  sessionCapsulesProduced = 0;

  const myDataAtom = getAtomByLabel('myDataAtom');
  if (myDataAtom) {
    void subscribeAtom<unknown>(myDataAtom, (value) => {
      processActivityLogs(value);
    })
      .then((unsubscribe) => {
        if (!initialized) {
          unsubscribe();
          return;
        }
        myDataUnsubscribe = unsubscribe;
      })
      .catch((error) => {
        log('[DawnCapture] Failed to subscribe to myDataAtom', error);
      });
  }

  weatherUnsubscribe = onWeatherSnapshot(handleWeather, true);
  log('[DawnCapture] Tracker started');
}

export function stopDawnCaptureTracker(): void {
  if (!initialized) return;
  initialized = false;
  myDataUnsubscribe?.();
  myDataUnsubscribe = null;
  weatherUnsubscribe?.();
  weatherUnsubscribe = null;
  listeners.clear();
  perPet.clear();
  lastSeenLogLength = 0;
}

export function subscribeDawnCapture(listener: (snapshot: DawnCaptureSnapshot) => void): () => void {
  listeners.add(listener);
  if (initialized) {
    try {
      listener(buildSnapshot());
    } catch (error) {
      log('[DawnCapture] immediate listener error', error);
    }
  }
  return () => { listeners.delete(listener); };
}

export function getDawnCaptureSnapshot(): DawnCaptureSnapshot {
  return buildSnapshot();
}

/**
 * Get remaining cooldown in ms for a specific pet.
 * Returns 0 if ready (cooldown elapsed or no record).
 */
export function getCooldownRemainingMs(petSlotId: string): number {
  const pet = perPet.get(petSlotId);
  if (!pet) return 0;
  const elapsed = Date.now() - pet.lastActivation;
  return Math.max(0, pet.cooldownMs - elapsed);
}
