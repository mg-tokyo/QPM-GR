// src/websocket/commandSequencer.ts
// Single wire counter for QuinoaCommand envelopes.
//
// Why this exists (live-tested 2026-08-28, v1040): the server accepts an
// envelope only when `commandSequence === frontier + 1`; stale/duplicate
// numbers are dropped WITHOUT a result and gaps return `invalid_sequence`.
// The game's own counter is a module-private closure seeded on Welcome that
// never resyncs from the frontier, so any second sender on the same socket
// (QPM) desyncs it and the USER's own actions start getting dropped.
//
// Fix: wrap the send chokepoint and rewrite the `commandSequence` of every
// outbound envelope — the game's included — to one monotonic counter seeded
// from Welcome and healed from room frames. The wrapper must be the INNERMOST
// layer (installed before locker/observer wrappers) so a number is allocated
// only for messages that actually reach the socket.

import { pageWindow } from '../core/pageContext';
import { criticalInterval } from '../utils/scheduling/timerManager';
import { createNamedLogger } from '../diagnostics/logger';
import { storage } from '../utils/storage';
import {
  QUINOA_COMMAND_RESULT_TYPE,
  QUINOA_COMMAND_TYPE,
  effectiveMessageType,
  isQuinoaCommandEnvelope,
  isQuinoaCommandResult,
  newRequestId,
  type QuinoaCommandEnvelope,
  type QuinoaCommandResultMessage,
} from './envelope';
import { isQpmOriginSend, recordGameTransport, recordServerLegacyVerdict, withQpmOrigin } from './transport';
import { isRecord } from '../utils/typeGuards';

const log = createNamedLogger('websocket');

export const ENVELOPE_ENABLED_KEY = 'qpm.ws.envelope.enabled';
export const SEQUENCER_ENABLED_KEY = 'qpm.ws.sequencer.enabled';
const RESULT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;
const REATTACH_POLL_MS = 2000;
const ASSIGNED_CAP = 256;

export class QuinoaCommandTimeoutError extends Error {
  constructor(public readonly requestId: string, public readonly commandType: string) {
    super(`QuinoaCommand ${commandType} (${requestId}) got no result within ${RESULT_TIMEOUT_MS} ms — outcome unknown`);
    this.name = 'QuinoaCommandTimeoutError';
  }
}

interface RoomFrameLike { executedCommandSequence?: unknown }

interface SequencerConnection {
  sendMessage: (payload: unknown) => unknown;
  trySendMessageNow?: (payload: unknown) => boolean;
  subscribeToWelcome?: (cb: (state: unknown, publishedAtServerMs?: unknown, executedCommandSequence?: unknown) => void) => unknown;
  subscribeToRoomFrames?: (cb: (frame: RoomFrameLike) => void) => unknown;
  lastDistributedRoomPublication?: { executedCommandSequence?: unknown };
  ws?: WebSocket | null;
  socket?: WebSocket | null;
  currentWebSocket?: WebSocket | null;
}

interface PageWithRoom extends Window { MagicCircle_RoomConnection?: SequencerConnection }

interface PendingEntry {
  requestId: string;
  commandType: string;
  envelope: QuinoaCommandEnvelope;
  resolve: (r: QuinoaCommandResultMessage) => void;
  reject: (e: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  retries: number;
  wire: number | null;
}

interface Attached {
  room: SequencerConnection;
  origSend: (payload: unknown) => unknown;
  origTry: ((payload: unknown) => boolean) | null;
  wrappedSend: (payload: unknown) => unknown;
  wrappedTry: ((payload: unknown) => boolean) | null;
  unsubWelcome: (() => void) | null;
  unsubFrames: (() => void) | null;
}

let started = false;
let attached: Attached | null = null;
let boundSocket: WebSocket | null = null;
let stopPoll: (() => void) | null = null;

let wire = 0;
let frontier = 0;
let seeded = false;
// Bumped on every invalid_sequence heal. Rejections for numbers allocated in
// an older epoch are already accounted for and must not reset the counter
// again (a burst of sibling rejections would otherwise race a live retry).
let epoch = 0;

const pending = new Map<string, PendingEntry>();
const assigned = new Map<string, { epoch: number; seq: number }>();

const stats = {
  welcomes: 0,
  frames: 0,
  allocated: 0,
  rewrittenGame: 0,
  rewrittenQpm: 0,
  rolledBack: 0,
  resultsOk: 0,
  resultsRejected: {} as Record<string, number>,
  timeouts: 0,
  heals: 0,
  retries: 0,
  legacyFallbacks: 0,
};

// ── Switches ──────────────────────────────────────────────────────────────

/**
 * Default ON since 2026-08-28 (live-verified: QPM envelopes + concurrent
 * manual game actions all acked, wire == frontier). Set to false to fall
 * back to legacy flat sends for QPM's own actions.
 */
export function isEnvelopeEnabled(): boolean {
  return storage.get<boolean>(ENVELOPE_ENABLED_KEY, true) !== false;
}

export function setEnvelopeEnabled(enabled: boolean): boolean {
  storage.set(ENVELOPE_ENABLED_KEY, !!enabled);
  return isEnvelopeEnabled();
}

export function isSequencerEnabled(): boolean {
  return storage.get<boolean>(SEQUENCER_ENABLED_KEY, true) !== false;
}

/** Live toggle: stopping restores the native send functions immediately. */
export function setSequencerEnabled(enabled: boolean): boolean {
  storage.set(SEQUENCER_ENABLED_KEY, !!enabled);
  if (enabled) startCommandSequencer(); else stopCommandSequencer();
  return isSequencerEnabled();
}

// ── Counter ───────────────────────────────────────────────────────────────

function getRoom(): SequencerConnection | null {
  const room = (pageWindow as PageWithRoom).MagicCircle_RoomConnection;
  return room && typeof room.sendMessage === 'function' ? room : null;
}

function getSocket(room: SequencerConnection | null): WebSocket | null {
  if (!room) return null;
  return room.currentWebSocket ?? room.ws ?? room.socket ?? null;
}

function seedFrom(seq: unknown): void {
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return;
  frontier = seq;
  wire = seq;
  seeded = true;
}

function onWelcome(seq: unknown): void {
  stats.welcomes++;
  // A (re)connect starts a fresh command session server-side: reset, and fail
  // anything still in flight — its result will never arrive on this session.
  seedFrom(seq);
  for (const entry of [...pending.values()]) settle(entry, null);
  assigned.clear();
}

function onFrame(frame: RoomFrameLike): void {
  const seq = frame?.executedCommandSequence;
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return;
  stats.frames++;
  if (seq > frontier) frontier = seq;
  if (seq > wire) wire = seq;
  seeded = true;
}

function allocate(): number {
  if (!seeded) seedFrom(attached?.room.lastDistributedRoomPublication?.executedCommandSequence);
  if (frontier > wire) wire = frontier;
  wire += 1;
  stats.allocated++;
  return wire;
}

function rollback(seq: number): void {
  // Only undo if nothing was allocated after it (synchronous send path).
  if (wire === seq) {
    wire = seq - 1;
    stats.rolledBack++;
  }
}

function rememberAssigned(requestId: string, seq: number): void {
  if (assigned.size >= ASSIGNED_CAP) {
    const oldest = assigned.keys().next().value;
    if (oldest !== undefined) assigned.delete(oldest);
  }
  assigned.set(requestId, { epoch, seq });
}

/** Feed the transport registry with what the GAME sends (Quinoa scope only). */
function observeOutbound(payload: unknown): void {
  if (isQpmOriginSend() || !isRecord(payload)) return;
  const scopePath = payload.scopePath;
  if (!Array.isArray(scopePath) || scopePath[scopePath.length - 1] !== 'Quinoa') return;
  const type = effectiveMessageType(payload);
  if (!type) return;
  recordGameTransport(type, payload.type === QUINOA_COMMAND_TYPE ? 'envelope' : 'legacy');
}

/** Returns the assigned sequence, or null when the payload is not an envelope. */
function rewrite(payload: unknown): number | null {
  if (!isQuinoaCommandEnvelope(payload)) return null;
  const seq = allocate();
  payload.commandSequence = seq;
  rememberAssigned(payload.requestId, seq);
  const entry = pending.get(payload.requestId);
  if (entry) {
    entry.wire = seq;
    stats.rewrittenQpm++;
  } else {
    stats.rewrittenGame++;
  }
  return seq;
}

// ── Results ───────────────────────────────────────────────────────────────

function settle(entry: PendingEntry, result: QuinoaCommandResultMessage | null): void {
  if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
  entry.timeoutId = null;
  pending.delete(entry.requestId);
  if (result) entry.resolve(result);
  else entry.reject(new QuinoaCommandTimeoutError(entry.requestId, entry.commandType));
}

function heal(): void {
  epoch += 1;
  stats.heals++;
  log.info('QuinoaCommand invalid_sequence — resyncing wire counter to frontier', { wire, frontier });
  wire = frontier;
}

function armTimeout(entry: PendingEntry): void {
  entry.timeoutId = setTimeout(() => onTimeout(entry), RESULT_TIMEOUT_MS);
}

function retry(entry: PendingEntry): void {
  entry.retries += 1;
  stats.retries++;
  if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
  pending.delete(entry.requestId);
  const requestId = newRequestId();
  entry.requestId = requestId;
  entry.envelope = { ...entry.envelope, requestId, commandSequence: 0 };
  entry.wire = null;
  armTimeout(entry);
  pending.set(requestId, entry);
  // Re-enter through the CURRENT outer chain (locker/observer see the resend).
  const room = attached?.room ?? getRoom();
  let sent = false;
  try {
    sent = withQpmOrigin(() => room?.trySendMessageNow?.(entry.envelope) === true);
  } catch { sent = false; }
  if (!sent) settle(entry, null);
}

/**
 * Server said this type is not ackable: remember it as legacy (persisted) and
 * put the same command on the wire flat, once. The burned sequence number is
 * already reflected in the frontier.
 */
function fallBackToLegacy(entry: PendingEntry, res: QuinoaCommandResultMessage): void {
  recordServerLegacyVerdict(entry.commandType);
  stats.legacyFallbacks++;
  const room = attached?.room ?? getRoom();
  let resent = false;
  try {
    withQpmOrigin(() => {
      room?.sendMessage({ scopePath: entry.envelope.scopePath, ...entry.envelope.command });
      resent = true;
    });
  } catch { resent = false; }
  settle(entry, { ...res, resentAsLegacy: resent });
}

function onTimeout(entry: PendingEntry): void {
  if (pending.get(entry.requestId) !== entry) return;
  stats.timeouts++;
  log.warn('QPM-WS-007', { type: entry.commandType, requestId: entry.requestId, seq: entry.wire });
  settle(entry, null);
}

function handleResult(res: QuinoaCommandResultMessage): void {
  const code = typeof res.code === 'string' ? res.code : 'unknown';
  if (res.ok) stats.resultsOk++;
  else stats.resultsRejected[code] = (stats.resultsRejected[code] ?? 0) + 1;

  const slot = assigned.get(res.requestId);
  assigned.delete(res.requestId);
  if (!res.ok && code === 'invalid_sequence' && (!slot || slot.epoch === epoch)) heal();

  const entry = pending.get(res.requestId);
  if (!entry) return;
  if (!res.ok) {
    log.warn('QPM-WS-006', { type: entry.commandType, code, seq: entry.wire, retries: entry.retries });
    if (code === 'not_ackable') {
      fallBackToLegacy(entry, res);
      return;
    }
    if (code === 'invalid_sequence' && entry.retries < MAX_RETRIES) {
      retry(entry);
      return;
    }
  }
  settle(entry, res);
}

function onSocketMessage(event: MessageEvent): void {
  const raw = event.data;
  if (typeof raw !== 'string' || raw.indexOf(QUINOA_COMMAND_RESULT_TYPE) === -1) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (isQuinoaCommandResult(parsed)) handleResult(parsed);
}

function bindSocket(room: SequencerConnection | null): void {
  const ws = getSocket(room);
  if (ws === boundSocket) return;
  unbindSocket();
  if (!ws) return;
  ws.addEventListener('message', onSocketMessage);
  boundSocket = ws;
}

function unbindSocket(): void {
  if (!boundSocket) return;
  try { boundSocket.removeEventListener('message', onSocketMessage); } catch { /* closed */ }
  boundSocket = null;
}

// ── Chokepoint wrappers ───────────────────────────────────────────────────

function toUnsub(result: unknown): (() => void) | null {
  if (typeof result === 'function') return result as () => void;
  if (result && typeof result === 'object' && typeof (result as { unsubscribe?: unknown }).unsubscribe === 'function') {
    return (result as { unsubscribe: () => void }).unsubscribe;
  }
  return null;
}

function detach(): void {
  if (!attached) return;
  const a = attached;
  try { if (a.room.sendMessage === a.wrappedSend) a.room.sendMessage = a.origSend; } catch { /* noop */ }
  try {
    if (a.wrappedTry && a.origTry && a.room.trySendMessageNow === a.wrappedTry) a.room.trySendMessageNow = a.origTry;
  } catch { /* noop */ }
  try { a.unsubWelcome?.(); } catch { /* noop */ }
  try { a.unsubFrames?.(); } catch { /* noop */ }
  attached = null;
}

function ensureAttached(): void {
  const room = getRoom();
  if (!room) return;
  if (attached && attached.room === room) {
    bindSocket(room);
    return;
  }
  detach();

  const origSend = room.sendMessage.bind(room);
  const rawTry = room.trySendMessageNow;
  const origTry = typeof rawTry === 'function' ? rawTry.bind(room) : null;

  const wrappedSend = (payload: unknown): unknown => {
    observeOutbound(payload);
    rewrite(payload);
    return origSend(payload);
  };
  const wrappedTry = origTry
    ? (payload: unknown): boolean => {
        observeOutbound(payload);
        const seq = rewrite(payload);
        const sent = origTry(payload);
        if (seq !== null && sent !== true) rollback(seq);
        return sent;
      }
    : null;

  let unsubWelcome: (() => void) | null = null;
  let unsubFrames: (() => void) | null = null;
  try {
    room.sendMessage = wrappedSend;
    if (wrappedTry) room.trySendMessageNow = wrappedTry;
    if (typeof room.subscribeToRoomFrames === 'function') {
      unsubFrames = toUnsub(room.subscribeToRoomFrames(onFrame));
    }
    if (typeof room.subscribeToWelcome === 'function') {
      // Fires synchronously with the current publication when already connected.
      unsubWelcome = toUnsub(room.subscribeToWelcome((_state, _ms, seq) => onWelcome(seq)));
    }
    if (!seeded) seedFrom(room.lastDistributedRoomPublication?.executedCommandSequence);
    attached = { room, origSend, origTry, wrappedSend, wrappedTry, unsubWelcome, unsubFrames };
    bindSocket(room);
    log.debug('command sequencer attached', { wire, frontier, hasTry: !!origTry });
  } catch (err) {
    try { room.sendMessage = origSend; } catch { /* noop */ }
    try { if (origTry) room.trySendMessageNow = origTry; } catch { /* noop */ }
    try { unsubWelcome?.(); } catch { /* noop */ }
    try { unsubFrames?.(); } catch { /* noop */ }
    attached = null;
    log.warn('QPM-WS-008', { phase: 'attach' }, err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Register interest in a QuinoaCommandResult for an envelope about to be sent
 * via `trySendMessageNow`. Resolves with the server result; rejects with
 * `QuinoaCommandTimeoutError` (outcome UNKNOWN — never treat as failure)
 * after 5 s or on reconnect.
 */
export function trackCommandRequest(envelope: QuinoaCommandEnvelope): Promise<QuinoaCommandResultMessage> {
  return new Promise<QuinoaCommandResultMessage>((resolve, reject) => {
    const entry: PendingEntry = {
      requestId: envelope.requestId,
      commandType: envelope.command.type,
      envelope,
      resolve,
      reject,
      timeoutId: null,
      retries: 0,
      wire: null,
    };
    armTimeout(entry);
    pending.set(envelope.requestId, entry);
  });
}

/** Drop a tracked request that never made it onto the wire. */
export function cancelCommandRequest(requestId: string): void {
  const entry = pending.get(requestId);
  if (entry) settle(entry, null);
}

/** True when the wrapper is installed on the live connection and the switch is on. */
export function isCommandSequencerActive(room?: unknown): boolean {
  if (!started || !attached) return false;
  const current = room ?? getRoom();
  return attached.room === current;
}

export function startCommandSequencer(): void {
  if (started) return;
  if (!isSequencerEnabled()) {
    log.info('command sequencer disabled by kill switch', { key: SEQUENCER_ENABLED_KEY });
    return;
  }
  started = true;
  ensureAttached();
  stopPoll = criticalInterval('qpm-command-sequencer', ensureAttached, REATTACH_POLL_MS);
}

export function stopCommandSequencer(): void {
  if (!started) return;
  started = false;
  if (stopPoll) { stopPoll(); stopPoll = null; }
  unbindSocket();
  detach();
  for (const entry of [...pending.values()]) settle(entry, null);
  assigned.clear();
}

export function getCommandSequencerStats(): Record<string, unknown> {
  return {
    started,
    attached: isCommandSequencerActive(),
    envelopeEnabled: isEnvelopeEnabled(),
    sequencerEnabled: isSequencerEnabled(),
    wire,
    frontier,
    seeded,
    epoch,
    pending: pending.size,
    ...stats,
    resultsRejected: { ...stats.resultsRejected },
  };
}
