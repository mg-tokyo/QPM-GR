// src/store/mountState.ts
// Reactive mount state tracker. Dual-source: atom subscription (primary) + WS intercept (fallback).
// Also provides ridePet/dismountPet helpers that replicate the native game flow:
//   1. Send RidePet/DismountPet WS message
//   2. Write myRiddenPetIdAtom (client-authoritative)
//   3. Send SetRiddenPet to sync to server

import { subscribeAtomValue, writeRegistryAtom } from '../core/atomRegistry';
import { onNativeSend } from '../websocket/nativeSendObserver';
import { onActionSent, sendRoomAction } from '../websocket/api';
import { log } from '../utils/logger';

type RiddenPetChangeCallback = (petId: string | null) => void;

const listeners = new Set<RiddenPetChangeCallback>();
let currentRiddenPetId: string | null = null;
let started = false;

const cleanups: Array<() => void> = [];

function emit(nextId: string | null): void {
  if (currentRiddenPetId === nextId) return;
  currentRiddenPetId = nextId;
  for (const cb of listeners) {
    try { cb(currentRiddenPetId); } catch { /* ignore listener errors */ }
  }
}

/**
 * Write myRiddenPetIdAtom and send SetRiddenPet.
 * Best-effort — failures are logged but don't block the action.
 */
async function syncRiddenState(petId: string | null): Promise<void> {
  // Write client-authoritative atom
  try {
    await writeRegistryAtom('riddenPetId', petId);
  } catch (err) {
    log('[MountState] Failed to write riddenPetId atom:', err);
  }

  // Sync to server (mirrors the native QuinoaCanvasWrapper subscription)
  sendRoomAction('SetRiddenPet', { petId }, { throttleMs: 0, skipThrottle: true });
}

/** Start tracking ridden pet state. Call after startNativeSendObserver(). */
export function startMountStateTracker(): void {
  if (started) return;
  started = true;

  // Primary: atom subscription
  subscribeAtomValue('riddenPetId', (value) => {
    emit(value ?? null);
  }).then((unsub) => {
    if (unsub) {
      cleanups.push(unsub);
    } else {
      log('[MountState] riddenPetId atom not found — relying on WS fallback');
    }
  }).catch(() => {
    log('[MountState] riddenPetId atom subscription failed — relying on WS fallback');
  });

  // Fallback: watch native WS sends (covers both game and QPM sends)
  const unsubNative = onNativeSend((type, payload) => {
    if (type === 'RidePet') {
      const petItemId = typeof payload.petItemId === 'string' ? payload.petItemId : null;
      if (petItemId) emit(petItemId);
    } else if (type === 'DismountPet') {
      emit(null);
    }
  });
  cleanups.push(unsubNative);

  // Optimistic: also listen for QPM's own sends for instant local update
  const unsubAction = onActionSent((type, payload) => {
    if (type === 'RidePet') {
      const petItemId = typeof payload.petItemId === 'string' ? payload.petItemId : null;
      if (petItemId) emit(petItemId);
    } else if (type === 'DismountPet') {
      emit(null);
    }
  });
  cleanups.push(unsubAction);

  log('[MountState] Started');
}

export function stopMountStateTracker(): void {
  if (!started) return;
  started = false;
  cleanups.forEach((fn) => fn());
  cleanups.length = 0;
  currentRiddenPetId = null;
  listeners.clear();
  log('[MountState] Stopped');
}

/** Get the slotId of the currently ridden pet, or null if not riding. */
export function getRiddenPetId(): string | null {
  return currentRiddenPetId;
}

/** Subscribe to ridden pet changes. Returns unsubscribe function. */
export function onRiddenPetChange(cb: RiddenPetChangeCallback): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * Mount a pet. Replicates the native game flow:
 *   1. Send RidePet to server
 *   2. Set myRiddenPetIdAtom locally (client-authoritative)
 *   3. Send SetRiddenPet to sync
 */
export function ridePet(petItemId: string): void {
  // Step 1: WS message first (server needs it before atom for displacement logic)
  const result = sendRoomAction('RidePet', { petItemId }, { throttleMs: 500 });
  if (!result.ok) {
    log(`[MountState] RidePet send failed: ${result.reason}`);
    return;
  }

  // Step 2+3: Write atom + sync (fires in background)
  emit(petItemId);
  void syncRiddenState(petItemId);
}

/**
 * Dismount the current pet. Replicates the native game flow:
 *   1. Send DismountPet to server
 *   2. Clear myRiddenPetIdAtom locally
 *   3. Send SetRiddenPet(null) to sync
 */
export function dismountPet(): void {
  // Step 1: WS message first (server resolves landing tile)
  const result = sendRoomAction('DismountPet', {}, { throttleMs: 500 });
  if (!result.ok) {
    log(`[MountState] DismountPet send failed: ${result.reason}`);
    return;
  }

  // Step 2+3: Write atom + sync
  emit(null);
  void syncRiddenState(null);
}
