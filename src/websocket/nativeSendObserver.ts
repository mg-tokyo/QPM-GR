// src/websocket/nativeSendObserver.ts
// Centralized observer for ALL outgoing sends (native game + QPM). Wraps
// MagicCircle_RoomConnection.sendMessage AND trySendMessageNow (v1040 routes
// every gameplay command through the latter as a QuinoaCommand envelope) and
// fires listeners with the UNWRAPPED action type. Purely observational.

import { pageWindow } from '../core/pageContext';
import { criticalInterval } from '../utils/scheduling/timerManager';
import { createNamedLogger } from '../diagnostics/logger';
import { unwrapQuinoaCommand } from './envelope';
import { ensureCommandSequencerAttached } from './commandSequencer';

const diagLog = createNamedLogger('websocket');

export type NativeSendListener = (type: string, payload: Record<string, unknown>) => void;

interface RoomConnection {
  sendMessage: (payload: unknown) => void;
  trySendMessageNow?: (payload: unknown) => boolean;
  [key: string]: unknown;
}

interface PageWithRoom extends Window {
  MagicCircle_RoomConnection?: RoomConnection;
}

const listeners = new Set<NativeSendListener>();
let patchedRoom: RoomConnection | null = null;
let originalSendMessage: ((payload: unknown) => unknown) | null = null;
let originalTrySend: ((payload: unknown) => boolean) | null = null;
let patchedWrapper: ((payload: unknown) => unknown) | null = null;
let patchedTryWrapper: ((payload: unknown) => boolean) | null = null;
let stopReconnectTimer: (() => void) | null = null;
let started = false;

const RECONNECT_POLL_MS = 2000;

function notifyListeners(type: string, payload: Record<string, unknown>): void {
  for (const cb of listeners) {
    try {
      cb(type, payload);
    } catch {
      // ignore listener errors
    }
  }
}

function observe(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const rec = payload as Record<string, unknown>;
  const outerType = typeof rec.type === 'string' ? rec.type : null;
  if (!outerType) return;
  const { actionType, payload: inner } = unwrapQuinoaCommand(outerType, rec);
  notifyListeners(actionType, inner);
}

function restorePatch(): void {
  if (!patchedRoom) return;
  try {
    // Identity guard: only restore if OUR wrapper is still installed. A
    // third party that wrapped after us stays; our wrapper keeps delegating
    // to the saved original, so the chain remains sound.
    if (originalSendMessage && patchedRoom.sendMessage === patchedWrapper) {
      patchedRoom.sendMessage = originalSendMessage as (payload: unknown) => void;
    } else if (originalSendMessage) {
      diagLog.debug('sendMessage re-wrapped by third party — leaving chain intact');
    }
    if (originalTrySend && patchedTryWrapper && patchedRoom.trySendMessageNow === patchedTryWrapper) {
      patchedRoom.trySendMessageNow = originalTrySend;
    }
  } catch { /* noop */ }
  patchedRoom = null;
  originalSendMessage = null;
  originalTrySend = null;
  patchedWrapper = null;
  patchedTryWrapper = null;
}

function ensurePatched(): void {
  // CS-2: make the sequencer attach first so its wrapper is INNERMOST
  // regardless of which of {sequencer, locker, observer} timer fires first.
  ensureCommandSequencerAttached();

  const room = (pageWindow as PageWithRoom).MagicCircle_RoomConnection;
  if (!room || typeof room.sendMessage !== 'function') return;
  if (patchedRoom === room) return;

  // Connection changed — restore previous patch and re-wrap
  restorePatch();

  const original = room.sendMessage.bind(room);
  const wrapped = (payload: unknown): unknown => {
    observe(payload);
    return original(payload);
  };
  const rawTry = room.trySendMessageNow;
  const originalTry = typeof rawTry === 'function' ? rawTry.bind(room) : null;
  const wrappedTry = originalTry
    ? (payload: unknown): boolean => {
        observe(payload);
        return originalTry(payload);
      }
    : null;

  try {
    room.sendMessage = wrapped;
    if (wrappedTry) room.trySendMessageNow = wrappedTry;
    patchedRoom = room;
    originalSendMessage = original;
    originalTrySend = originalTry;
    patchedWrapper = wrapped;
    patchedTryWrapper = wrappedTry;
  } catch {
    patchedRoom = null;
    originalSendMessage = null;
    originalTrySend = null;
    patchedWrapper = null;
    patchedTryWrapper = null;
  }
}

/**
 * Register a callback that fires for every outgoing WS message. Returns unsubscribe.
 * Auto-starts the observer on first listener registration (on-demand).
 */
export function onNativeSend(listener: NativeSendListener): () => void {
  if (!started) {
    startNativeSendObserver();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Start the observer. Called automatically by onNativeSend on first registration.
 *
 * Ordering invariant: this observer must start AFTER startLocker() in
 * src/features/locker/index.ts, so that the observer's captured "original"
 * is the locker wrapper (chain: observer → locker → sequencer → raw).
 * Reversing this order silently drops observer visibility on every
 * locker-blocked send.
 */
export function startNativeSendObserver(): void {
  if (started) return;
  started = true;
  ensurePatched();
  stopReconnectTimer = criticalInterval('native-send-observer', ensurePatched, RECONNECT_POLL_MS);
  diagLog.debug('NativeSendObserver started');
}

export function stopNativeSendObserver(): void {
  if (!started) return;
  started = false;
  if (stopReconnectTimer) {
    stopReconnectTimer();
    stopReconnectTimer = null;
  }
  restorePatch();
  listeners.clear();
  diagLog.debug('NativeSendObserver stopped');
}

/** Debug: current listener count + started state */
export function getNativeSendObserverStatus(): { started: boolean; listenerCount: number } {
  return { started, listenerCount: listeners.size };
}
