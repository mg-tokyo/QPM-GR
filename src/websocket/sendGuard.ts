import { getRoomConnection, type RoomConnection } from './api';
import { createNamedLogger } from '../diagnostics/logger';
import { unwrapQuinoaCommand } from './envelope';
import { brandWrapper, captureSendSlot, restoreSendSlot, type CapturedSlot, type SendFn } from './sendChain';
import { isQpmOriginSend, markQpmSendRefused } from './transport';
import { isRecord } from '../utils/typeGuards';

const log = createNamedLogger('websocket');

// Wraps MagicCircle_RoomConnection.sendMessage + trySendMessageNow to drop
// outgoing messages a registered predicate refuses (pattern verified live
// 2026-08-04, battleship spike findings §7). Judges the UNWRAPPED type: on
// v1040 gameplay commands travel as QuinoaCommand envelopes via
// trySendMessageNow. Sees the game's native sends and QPM's own alike.

export type BlockedSendPayload = Record<string, unknown>;
export type GuardVerdict = { allow: true } | { allow: false; reason: string };
export type GuardOrigin = 'qpm' | 'native';
export type GuardPredicate = (type: string, payload: BlockedSendPayload, origin: GuardOrigin) => GuardVerdict;
type BlockedListener = (type: string, payload: BlockedSendPayload, reason: string) => void;

interface GuardEntry {
  name: string;
  predicate: GuardPredicate;
  onBlocked: BlockedListener | null;
  blockedCount: number;
}

interface WrapSlot {
  captured: CapturedSlot;
  // Null once restored; a slot another layer wrapped above stays installed as a pass-through.
  installed: SendFn | null;
}

const BATTLESHIP_GUARD = 'battleship';
const guards: GuardEntry[] = [];
let wrap: { connection: RoomConnection; send: WrapSlot; trySend: WrapSlot | null } | null = null;

function judge(payload: unknown): { entry: GuardEntry; type: string; inner: BlockedSendPayload; reason: string } | null {
  if (guards.length === 0 || !isRecord(payload) || typeof payload.type !== 'string') return null;
  const { actionType, payload: inner } = unwrapQuinoaCommand(payload.type, payload);
  const origin: GuardOrigin = isQpmOriginSend() ? 'qpm' : 'native';
  for (const entry of guards) {
    let verdict: GuardVerdict;
    try {
      verdict = entry.predicate(actionType, inner, origin);
    } catch {
      verdict = { allow: false, reason: 'guard-error' };
    }
    if (!verdict.allow) return { entry, type: actionType, inner, reason: verdict.reason };
  }
  return null;
}

function refused(payload: unknown): boolean {
  const hit = judge(payload);
  if (!hit) return false;
  hit.entry.blockedCount++;
  markQpmSendRefused();
  log.info('QPM-WS-GUARD', { blocked: hit.type, guard: hit.entry.name, reason: hit.reason });
  try {
    hit.entry.onBlocked?.(hit.type, hit.inner, hit.reason);
  } catch {
    /* listener errors never break the guard */
  }
  return true;
}

function wrapSlot(connection: RoomConnection, key: 'sendMessage' | 'trySendMessageNow'): WrapSlot | null {
  const captured = captureSendSlot(connection, key);
  if (!captured) return null;
  const forward = captured.bound;
  // The brand label names the wrap site, not the caller: sendChain's label set and mod fingerprints key on it.
  const installed: SendFn = key === 'sendMessage'
    ? brandWrapper((payload: unknown) => (refused(payload) ? undefined : forward(payload)), 'battleshipSendGuard', captured.inner)
    // false mirrors "connection closed": the game's RPC caller rejects its pending command and swallows it.
    : brandWrapper((payload: unknown) => (refused(payload) ? false : forward(payload)), 'battleshipSendGuard', captured.inner);
  (connection as unknown as Record<string, unknown>)[key] = installed;
  return { captured, installed };
}

function unwrapSlot(connection: RoomConnection, key: 'sendMessage' | 'trySendMessageNow', slot: WrapSlot | null): void {
  if (!slot?.installed) return;
  try {
    if (restoreSendSlot(connection, key, slot.captured, slot.installed)) slot.installed = null;
  } catch {
    /* a frozen or trapped slot keeps the pass-through wrapper */
  }
}

function releaseWrap(): void {
  if (!wrap) return;
  unwrapSlot(wrap.connection, 'sendMessage', wrap.send);
  unwrapSlot(wrap.connection, 'trySendMessageNow', wrap.trySend);
  if (!wrap.send.installed && !wrap.trySend?.installed) wrap = null;
}

function ensureWrapped(): boolean {
  const connection = getRoomConnection();
  if (!connection || typeof connection.sendMessage !== 'function') return false;
  if (wrap && wrap.connection !== connection) {
    releaseWrap();
    wrap = null;
  }
  if (wrap) {
    if (!wrap.send.installed) wrap.send = wrapSlot(connection, 'sendMessage') ?? wrap.send;
    if (wrap.trySend && !wrap.trySend.installed) wrap.trySend = wrapSlot(connection, 'trySendMessageNow');
    return true;
  }
  const send = wrapSlot(connection, 'sendMessage');
  if (!send) return false;
  wrap = { connection, send, trySend: wrapSlot(connection, 'trySendMessageNow') };
  return true;
}

/** Registers (or replaces) a named predicate; false when no live connection can be wrapped. */
export function addSendGuard(name: string, predicate: GuardPredicate, onBlocked?: BlockedListener): boolean {
  const connection = getRoomConnection();
  if (!connection || typeof connection.sendMessage !== 'function') return false;
  const existing = guards.find((g) => g.name === name);
  if (existing) {
    existing.predicate = predicate;
    existing.onBlocked = onBlocked ?? null;
  } else {
    guards.push({ name, predicate, onBlocked: onBlocked ?? null, blockedCount: 0 });
  }
  return ensureWrapped();
}

export function removeSendGuardByName(name: string): void {
  const idx = guards.findIndex((g) => g.name === name);
  if (idx === -1) return;
  guards.splice(idx, 1);
  if (guards.length === 0) releaseWrap();
}

/** Re-wraps the live connection after a swap; false when the registry is empty or nothing can be wrapped. */
export function reinstallSendGuard(): boolean {
  if (guards.length === 0) return false;
  return ensureWrapped();
}

export function installSendGuard(
  blockedTypes: ReadonlySet<string>,
  onBlocked: (type: string, payload: BlockedSendPayload) => void,
): boolean {
  if (guards.some((g) => g.name === BATTLESHIP_GUARD)) return true;
  return addSendGuard(
    BATTLESHIP_GUARD,
    (type) => (blockedTypes.has(type) ? { allow: false, reason: 'battleship' } : { allow: true }),
    (type, payload) => onBlocked(type, payload),
  );
}

export function getSendGuardStats(): { active: boolean; blockedCount: number } | null {
  const entry = guards.find((g) => g.name === BATTLESHIP_GUARD);
  if (!entry) return { active: false, blockedCount: 0 };
  return { active: isSendGuardActive(), blockedCount: entry.blockedCount };
}

export function removeSendGuard(): void {
  removeSendGuardByName(BATTLESHIP_GUARD);
}

/**
 * True while a guard is registered and the wrap sits on the SAME connection
 * object that is currently live. After a reconnect the game may replace the
 * connection — callers re-install when this returns false mid-session.
 */
export function isSendGuardActive(): boolean {
  if (guards.length === 0 || !wrap) return false;
  return getRoomConnection() === wrap.connection;
}
