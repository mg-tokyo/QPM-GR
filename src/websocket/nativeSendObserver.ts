// src/websocket/nativeSendObserver.ts
// Centralized observer for ALL outgoing sendMessage calls (native game + QPM).
// Wraps MagicCircle_RoomConnection.sendMessage to fire registered listeners
// for every message type + payload. Purely observational — never blocks.

import { pageWindow } from '../core/pageContext';
import { criticalInterval } from '../utils/scheduling/timerManager';
import { createNamedLogger } from '../diagnostics/logger';

const diagLog = createNamedLogger('websocket');

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

/** Start the observer. Called automatically by onNativeSend on first registration. */
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
