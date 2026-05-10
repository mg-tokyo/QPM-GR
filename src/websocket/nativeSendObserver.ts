// src/websocket/nativeSendObserver.ts
// Centralized observer for ALL outgoing sendMessage calls (native game + QPM).
// Wraps MagicCircle_RoomConnection.sendMessage to fire registered listeners
// for every message type + payload. Purely observational — never blocks.

import { pageWindow } from '../core/pageContext';
import { criticalInterval } from '../utils/timerManager';
import { log } from '../utils/logger';

export type NativeSendListener = (type: string, payload: Record<string, unknown>) => void;

interface RoomConnection {
  sendMessage: (payload: unknown) => void;
  [key: string]: unknown;
}

interface PageWithRoom extends Window {
  MagicCircle_RoomConnection?: RoomConnection;
}

const listeners = new Set<NativeSendListener>();
let patchedRoom: RoomConnection | null = null;
let originalSendMessage: ((payload: unknown) => unknown) | null = null;
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

function restorePatch(): void {
  if (!patchedRoom || !originalSendMessage) return;
  try {
    patchedRoom.sendMessage = originalSendMessage as (payload: unknown) => void;
  } catch { /* noop */ }
  patchedRoom = null;
  originalSendMessage = null;
}

function ensurePatched(): void {
  const room = (pageWindow as PageWithRoom).MagicCircle_RoomConnection;
  if (!room || typeof room.sendMessage !== 'function') return;
  if (patchedRoom === room) return;

  // Connection changed — restore previous patch and re-wrap
  restorePatch();

  const original = room.sendMessage.bind(room);
  const wrapped = (payload: unknown): unknown => {
    // Observe before passing through
    if (payload && typeof payload === 'object') {
      const rec = payload as Record<string, unknown>;
      const actionType = typeof rec.type === 'string' ? rec.type : null;
      if (actionType) {
        notifyListeners(actionType, rec);
      }
    }
    return original(payload);
  };

  try {
    room.sendMessage = wrapped;
    patchedRoom = room;
    originalSendMessage = original;
  } catch {
    patchedRoom = null;
    originalSendMessage = null;
  }
}

/** Register a callback that fires for every outgoing WS message. Returns unsubscribe. */
export function onNativeSend(listener: NativeSendListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Start the observer. Must be called before the locker's startNativeHook so it wraps first. */
export function startNativeSendObserver(): void {
  if (started) return;
  started = true;
  ensurePatched();
  stopReconnectTimer = criticalInterval('native-send-observer', ensurePatched, RECONNECT_POLL_MS);
  log('[NativeSendObserver] Started');
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
  log('[NativeSendObserver] Stopped');
}

/** Debug: current listener count + started state */
export function getNativeSendObserverStatus(): { started: boolean; listenerCount: number } {
  return { started, listenerCount: listeners.size };
}
