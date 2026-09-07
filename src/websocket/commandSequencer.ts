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
import { countOutstanding, shouldIdleResync } from './sequencerHeal';
import { isRecord } from '../utils/typeGuards';

const log = createNamedLogger('websocket');

export const ENVELOPE_ENABLED_KEY = 'qpm.ws.envelope.enabled';
export const SEQUENCER_ENABLED_KEY = 'qpm.ws.sequencer.enabled';
const STALE_DETECT_ENABLED_KEY = 'qpm.ws.sequencer.staleDetect.enabled';
const STALE_GRACE_MS_KEY = 'qpm.ws.sequencer.staleGraceMs';
const RESULT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;
const REATTACH_POLL_MS = 2000;
const ASSIGNED_CAP = 256;
// CS-4: server rule is that stale/duplicate commandSequence numbers get no
// result, so once a room frame executes past our envelope's number the send is
// definitely lost. The grace covers the ~100 ms result window observed in
// v1040 with headroom; a live frame→result measurement (Runtime Verification
// Suite, CS-4 entry) sets the final default.
const DEFAULT_STALE_GRACE_MS = 750;

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
  // False before Welcome. Envelopes sent via `sendMessage` in that window get
  // queued and later flushed with a stale commandSequence — CS-3 guard skips
  // rewrite so they land as legacy and don't burn a fresh number.
  isCommandSessionReady?: boolean;
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
  // CS-4: set when rewrite assigns entry.wire; 0 while unsent. Included in the
  // stale-drop log so operators can see how long the round-trip actually took.
  sentAt: number;
  // CS-4: armed by armStaleTimers() when a frame executes past entry.wire.
  // Cleared by settle() / retry() so a late real result doesn't fire onStale.
  staleTimer: ReturnType<typeof setTimeout> | null;
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
const assigned = new Map<string, { epoch: number; seq: number; at: number }>();
let skippedPreSessionWarned = false;

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
  idleResyncs: 0,
  skippedPreSession: 0,
  layeringRefusals: 0,
  dropped: 0,
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
  armStaleTimers();
}

// CS-4: arm a stale-drop timer for every pending entry whose commandSequence
// has already been executed by the room. If no real result arrives within the
// grace, onStale settles it as `dropped_stale` and reuses CS-1's heal. Cheap
// when pending is empty (the common case) and driven by frames, not by a poll.
function armStaleTimers(): void {
  if (pending.size === 0) return;
  const enabled = storage.get<boolean>(STALE_DETECT_ENABLED_KEY, true) !== false;
  if (!enabled) return;
  const grace = getStaleGraceMs();
  for (const entry of pending.values()) {
    if (entry.wire !== null && entry.wire <= frontier && entry.staleTimer === null) {
      entry.staleTimer = setTimeout(() => onStale(entry), grace);
    }
  }
}

function getStaleGraceMs(): number {
  const raw = storage.get<number>(STALE_GRACE_MS_KEY, DEFAULT_STALE_GRACE_MS);
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_STALE_GRACE_MS;
}

function onStale(entry: PendingEntry): void {
  if (pending.get(entry.requestId) !== entry) return;
  entry.staleTimer = null;
  stats.dropped++;
  log.warn('QPM-WS-012', {
    type: entry.commandType,
    requestId: entry.requestId,
    seq: entry.wire,
    frontier,
    ageMs: entry.sentAt > 0 ? Date.now() - entry.sentAt : null,
  });
  // The sequence number is already spent server-side; drop the bookkeeping so
  // checkIdleResync doesn't count it as outstanding.
  assigned.delete(entry.requestId);
  settle(entry, {
    type: QUINOA_COMMAND_RESULT_TYPE,
    requestId: entry.requestId,
    commandType: entry.commandType,
    ok: false,
    code: 'dropped_stale',
  });
  // A stale drop leaves wire > frontier with nothing else outstanding — the
  // exact burn CS-1's heal predicate detects on the 2s poll. Fire immediately
  // so the next envelope isn't rejected with invalid_sequence.
  checkIdleResync();
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
  assigned.set(requestId, { epoch, seq, at: Date.now() });
}

// CS-1: after every poll tick, if the wire drifted past the frontier while
// nothing is in flight (a burned number from a refused send), reseed to the
// frontier so the next envelope isn't rejected with invalid_sequence.
function checkIdleResync(): void {
  const outstanding = countOutstanding(assigned.values(), Date.now(), RESULT_TIMEOUT_MS);
  if (shouldIdleResync({ wire, frontier, outstanding, pending: pending.size })) {
    stats.idleResyncs++;
    log.debug('idle resync', { wire, frontier });
    wire = frontier;
  }
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
    entry.sentAt = Date.now();
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
  if (entry.staleTimer !== null) clearTimeout(entry.staleTimer);
  entry.staleTimer = null;
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
  if (entry.staleTimer !== null) clearTimeout(entry.staleTimer);
  entry.staleTimer = null;
  pending.delete(entry.requestId);
  const requestId = newRequestId();
  entry.requestId = requestId;
  entry.envelope = { ...entry.envelope, requestId, commandSequence: 0 };
  entry.wire = null;
  entry.sentAt = 0;
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
    checkIdleResync();
    return;
  }
  detach();

  // CS-5: if sendMessage or trySendMessageNow is currently an own property
  // whose value is NOT the prototype method, another wrapper is installed
  // between us and the native send. Attaching under it would put the
  // sequencer OUTSIDE the outer chain — every enveloped send would get its
  // commandSequence assigned before the outer wrapper could refuse it,
  // burning numbers. CS-2 makes QPM's own outer wrappers call us first, so
  // this path only trips for third-party wrappers; retry on the next poll
  // once the foreign wrapper detaches.
  const proto = Object.getPrototypeOf(room) as { sendMessage?: unknown; trySendMessageNow?: unknown } | null;
  const foreignSend = Object.prototype.hasOwnProperty.call(room, 'sendMessage')
    && typeof room.sendMessage === 'function'
    && room.sendMessage !== proto?.sendMessage;
  const foreignTry = Object.prototype.hasOwnProperty.call(room, 'trySendMessageNow')
    && typeof room.trySendMessageNow === 'function'
    && room.trySendMessageNow !== proto?.trySendMessageNow;
  if (foreignSend || foreignTry) {
    stats.layeringRefusals++;
    log.warn('QPM-WS-008', { phase: 'layering', foreignSend, foreignTry });
    return;
  }

  const origSend = room.sendMessage.bind(room);
  const rawTry = room.trySendMessageNow;
  const origTry = typeof rawTry === 'function' ? rawTry.bind(room) : null;

  const wrappedSend = (payload: unknown): unknown => {
    observeOutbound(payload);
    // CS-3: sendMessage queues while disconnected and flushes on socket open
    // BEFORE Welcome. Rewriting there burns a number the server can't accept;
    // skip and let it land as legacy — the server refuses envelopes on that
    // path already, and our subsequent envelopes stay in sync.
    if (isQuinoaCommandEnvelope(payload) && room.isCommandSessionReady === false) {
      stats.skippedPreSession++;
      if (!skippedPreSessionWarned) {
        skippedPreSessionWarned = true;
        log.warn('QPM-WS-011', { requestId: payload.requestId, type: payload.command.type });
      }
      return origSend(payload);
    }
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
    checkIdleResync();
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
      sentAt: 0,
      staleTimer: null,
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

/**
 * CS-2: outer wrappers (locker, nativeSendObserver) call this before installing
 * their own patch so the sequencer sits INNERMOST regardless of the order the
 * three feature timers fire in. No-op when the sequencer is stopped or when
 * already attached to the same connection.
 */
export function ensureCommandSequencerAttached(): void {
  if (!started) return;
  ensureAttached();
}

export function stopCommandSequencer(): void {
  if (!started) return;
  started = false;
  if (stopPoll) { stopPoll(); stopPoll = null; }
  unbindSocket();
  detach();
  for (const entry of [...pending.values()]) settle(entry, null);
  assigned.clear();
  skippedPreSessionWarned = false;
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
    outstanding: countOutstanding(assigned.values(), Date.now(), RESULT_TIMEOUT_MS),
    ...stats,
    resultsRejected: { ...stats.resultsRejected },
  };
}
