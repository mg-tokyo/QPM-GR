// Dual-source mount tracker: atom subscription (primary) + WS intercept (fallback).
// ridePet/dismountPet mirror the native flow: send WS action, write myRiddenPetIdAtom, send SetRiddenPet.

import { subscribeAtomValue, writeRegistryAtom } from '../core/atomRegistry';
import { onNativeSend } from '../websocket/nativeSendObserver';
import { onActionSent, sendRoomAction } from '../websocket/api';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeMountState', 'mountState');

type RiddenPetChangeCallback = (petId: string | null) => void;

const listeners = new Set<RiddenPetChangeCallback>();
let currentRiddenPetId: string | null = null;
let started = false;

const cleanups: Array<() => void> = [];

function emit(nextId: string | null): void {
  if (currentRiddenPetId === nextId) return;
  currentRiddenPetId = nextId;
  for (const cb of listeners) {
    try { cb(currentRiddenPetId); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'notify' }, error); }
  }
}

/** Write myRiddenPetIdAtom and send SetRiddenPet. Best-effort — failures are logged, not thrown. */
async function syncRiddenState(petId: string | null): Promise<void> {
  try {
    await writeRegistryAtom('riddenPetId', petId);
  } catch (err) {
    diag.warn('QPM-STORE-002', { atom: 'riddenPetId', phase: 'write' }, err);
  }

  sendRoomAction('SetRiddenPet', { petId }, { throttleMs: 0, skipThrottle: true });
}

/** Start tracking ridden pet state. Call after startNativeSendObserver(). */
export function startMountStateTracker(): void {
  if (started) return;
  started = true;
  diag.register('Starting mount state tracker');

  subscribeAtomValue('riddenPetId', (value) => {
    emit(value ?? null);
  }).then((unsub) => {
    if (unsub) {
      cleanups.push(unsub);
    } else {
      diag.warn('QPM-STORE-002', { atom: 'riddenPetId', fallback: 'ws' });
    }
  }).catch((error) => {
    diag.warn('QPM-STORE-002', { atom: 'riddenPetId', phase: 'subscribe', fallback: 'ws' }, error);
  });

  const unsubNative = onNativeSend((type, payload) => {
    if (type === 'RidePet') {
      const petItemId = typeof payload.petItemId === 'string' ? payload.petItemId : null;
      if (petItemId) emit(petItemId);
    } else if (type === 'DismountPet') {
      emit(null);
    }
  });
  cleanups.push(unsubNative);

  const unsubAction = onActionSent((type, payload) => {
    if (type === 'RidePet') {
      const petItemId = typeof payload.petItemId === 'string' ? payload.petItemId : null;
      if (petItemId) emit(petItemId);
    } else if (type === 'DismountPet') {
      emit(null);
    }
  });
  cleanups.push(unsubAction);

  diag.log.debug('Mount state tracker started');
  diag.publishOk('Mount state tracker ready');
}

export function stopMountStateTracker(): void {
  if (!started) return;
  started = false;
  cleanups.forEach((fn) => fn());
  cleanups.length = 0;
  currentRiddenPetId = null;
  listeners.clear();
  diag.log.debug('Mount state tracker stopped');
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

/** Mount a pet: WS RidePet first (server needs it before atom for displacement logic), then atom + sync. */
export function ridePet(petItemId: string): void {
  const result = sendRoomAction('RidePet', { petItemId }, { throttleMs: 500 });
  if (!result.ok) {
    diag.log.debug('RidePet send failed', { reason: result.reason });
    return;
  }

  emit(petItemId);
  void syncRiddenState(petItemId);
}

/** Dismount: WS DismountPet first (server resolves landing tile), then clear atom + sync. */
export function dismountPet(): void {
  const result = sendRoomAction('DismountPet', {}, { throttleMs: 500 });
  if (!result.ok) {
    diag.log.debug('DismountPet send failed', { reason: result.reason });
    return;
  }

  emit(null);
  void syncRiddenState(null);
}
