// src/websocket/commandSequencer.ts
// Wraps the send chokepoint and rewrites every outbound envelope's
// commandSequence so QPM and the game share ONE counter (server accepts
// only frontier+1; stale/duplicate gets no result, gaps return
// invalid_sequence). Wrapper is the INNERMOST layer so numbers are only
// allocated for messages that actually reach the socket.

import { pageWindow } from '../core/pageContext';
import { createNamedLogger } from '../diagnostics/logger';
import { registerForeignSignal, registerSendChainLineSource } from '../diagnostics/modDetection';
import { storage } from '../utils/storage';
import {
  QUINOA_COMMAND_RESULT_TYPE,
  QUINOA_COMMAND_TYPE,
  effectiveMessageType,
  isQuinoaCommandEnvelope,
  newRequestId,
  type QuinoaCommandEnvelope,
  type QuinoaCommandResultMessage,
} from './envelope';
import { createResultBinder } from './sequencerSocket';
import { armStaleTimers } from './sequencerStale';
import { isQpmOriginSend, recordGameTransport, recordServerLegacyVerdict, withQpmOrigin } from './transport';
import { countOutstanding, nextWire, readExecutedSequence, shouldIdleResync } from './sequencerHeal';
import { isRecord } from '../utils/typeGuards';
import { createForeignEpisodeGate, formatSendChainLine, type SendChainReport } from './sendChain';
import { onRoomConnectionChange } from './roomConnectionEvents';
import { createSequencerAttach, type RoomFrameLike, type SequencerConnection } from './sequencerAttach';

const log = createNamedLogger('websocket');

export const ENVELOPE_ENABLED_KEY = 'qpm.ws.envelope.enabled';
export const SEQUENCER_ENABLED_KEY = 'qpm.ws.sequencer.enabled';
const RESULT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;
const ASSIGNED_CAP = 256;

export class QuinoaCommandTimeoutError extends Error {
  constructor(public readonly requestId: string, public readonly commandType: string) {
    super(`QuinoaCommand ${commandType} (${requestId}) got no result within ${RESULT_TIMEOUT_MS} ms — outcome unknown`);
    this.name = 'QuinoaCommandTimeoutError';
  }
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

let started = false;
const resultBinder = createResultBinder((res) => handleResult(res));
let stopEvents: (() => void) | null = null;
let idleResyncTimer: ReturnType<typeof setTimeout> | null = null;

let wire = 0;
let frontier = 0;
let seeded = false;
// CS-18: highest number we put on the wire and never heard back about. The
// server answers a stale/duplicate number with SILENCE, so re-emitting it is
// unrecoverable; overshooting is not (invalid_sequence is answered and heals).
let unansweredFloor = 0;
// Bumped on every invalid_sequence heal so rejections from an older epoch
// don't re-heal (a burst of sibling rejections would race a live retry).
let epoch = 0;

const pending = new Map<string, PendingEntry>();
const assigned = new Map<string, { epoch: number; seq: number; at: number }>();
let skippedPreSessionWarned = false;

const foreignGate = createForeignEpisodeGate(3, 3000);
let unregisterForeignSignal: (() => void) | null = null;
let unregisterChainLine: (() => void) | null = null;

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
  rearms: 0,
  defusedDetaches: 0,
  frontierCatchUps: 0,
  unansweredProbes: 0,
  chokepointCovered: 0,
  chokepointReinstalls: 0,
  chokepointBypassed: 0,
};

const attach = createSequencerAttach({
  getRoom,
  observeOutbound,
  skipPreSession,
  rewrite,
  rollback,
  onFrame,
  onWelcome,
  seedIfUnseeded: (room) => {
    if (!seeded) seedFrom(room.lastDistributedRoomPublication?.executedCommandSequence);
  },
  refresh: (room) => {
    resultBinder.bind(room);
    checkIdleResync();
  },
  counters: () => ({ wire, frontier }),
  stats,
  gate: foreignGate,
});

// ── Switches ──────────────────────────────────────────────────────────────

/** Default ON since 2026-08-28. Set false to fall back to legacy flat sends. */
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

function seedFrom(seq: unknown): void {
  const value = readExecutedSequence(seq);
  if (value === null) return;
  frontier = value;
  wire = value;
  seeded = true;
}

function readRoomExecuted(): number | null {
  return readExecutedSequence(attach.attachedRoom()?.lastDistributedRoomPublication?.executedCommandSequence);
}

// CS-18: `frontier` is otherwise fed only by the room-frame subscription and
// Welcome. That subscription can go silent while the wrapper is still live (a
// missed socket swap, a torn-down sub), and the server answers a stale number
// with nothing at all — so the sequencer would re-emit the same dead number
// forever. The room's own counter is a plain property read on a different
// path; consult it every time we allocate or resync.
function refreshFrontier(): void {
  const seq = readRoomExecuted();
  if (seq === null) return;
  if (seq > frontier) { frontier = seq; stats.frontierCatchUps++; }
  if (seq > wire) wire = seq;
  seeded = true;
}

function onWelcome(seq: unknown): void {
  stats.welcomes++;
  // New command session: the server's counter restarts, so a number that went
  // unanswered on the previous session no longer constrains anything.
  unansweredFloor = 0;
  // A (re)connect starts a fresh command session server-side: reset, and fail
  // anything still in flight — its result will never arrive on this session.
  seedFrom(seq);
  for (const entry of [...pending.values()]) settle(entry, null);
  assigned.clear();
}

function onFrame(frame: RoomFrameLike): void {
  const seq = readExecutedSequence(frame?.executedCommandSequence);
  if (seq === null) return;
  stats.frames++;
  if (seq > frontier) frontier = seq;
  if (seq > wire) wire = seq;
  seeded = true;
  if (pending.size > 0) armStaleTimers(pending.values(), frontier, onStale);
  // Frames are ~1/s and cheap when pending is empty; catches a burned number
  // between allocations without needing the removed 2 s reattach poll.
  if (pending.size === 0) checkIdleResync();
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
  // exact burn CS-1's heal predicate detects. Fire immediately so the next
  // envelope isn't rejected with invalid_sequence.
  checkIdleResync();
}

// CS-1 heal used to ride the 2 s poll; a burned number is only possible after
// an allocation, so one timer per allocation (reset on each) covers it.
function armIdleResync(): void {
  if (idleResyncTimer !== null) clearTimeout(idleResyncTimer);
  idleResyncTimer = setTimeout(() => { idleResyncTimer = null; checkIdleResync(); }, RESULT_TIMEOUT_MS + 250);
}

function allocate(): number {
  // CS-18: subsumes the old cold-seed branch — with wire/frontier starting at
  // 0, the first refresh both seeds and catches up.
  refreshFrontier();
  const floor = nextWire({ frontier, unansweredFloor });
  if (floor > wire) wire = floor;
  wire += 1;
  armIdleResync();
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

// CS-1: on idle frames, the post-allocation timer and stale drops — if the wire
// drifted past the frontier while nothing is in flight (a burned number from a
// refused send), reseed to the frontier so the next envelope isn't rejected.
function checkIdleResync(): void {
  // CS-18: pin to the authoritative counter, never to a frontier the frame
  // subscription may have stopped updating.
  refreshFrontier();
  const outstanding = countOutstanding(assigned.values(), Date.now(), RESULT_TIMEOUT_MS);
  if (shouldIdleResync({ wire, frontier, outstanding, pending: pending.size, unansweredFloor })) {
    stats.idleResyncs++;
    log.debug('idle resync', { wire, frontier, unansweredFloor });
    wire = nextWire({ frontier, unansweredFloor });
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

// CS-3: an envelope reaching a slot wrapper before Welcome must not burn a
// number. Pre-1195 sendMessage flushed its queue on socket open (before
// Welcome); since 1195 both slots gate on isConnected() (socket OPEN &&
// isCommandSessionReady) and the queue flushes after Welcome, so the queued
// payload re-enters the wrappers and is rewritten then. Kept for older
// bundles and for a foreign wrapper that calls the chokepoint directly.
function skipPreSession(room: SequencerConnection, payload: unknown): boolean {
  if (!isQuinoaCommandEnvelope(payload) || room.isCommandSessionReady !== false) return false;
  stats.skippedPreSession++;
  if (!skippedPreSessionWarned) {
    skippedPreSessionWarned = true;
    log.warn('QPM-WS-011', { requestId: payload.requestId, type: payload.command.type });
  }
  return true;
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
  log.info('QuinoaCommand invalid_sequence — resyncing wire counter to frontier', { wire, frontier, unansweredFloor });
  wire = nextWire({ frontier, unansweredFloor });
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
  const room = attach.attachedRoom() ?? getRoom();
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
  const room = attach.attachedRoom() ?? getRoom();
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
  // CS-18: the number was neither acknowledged nor observed as executed. Since
  // the server's only answer to a stale number is silence, re-emitting it can
  // never recover — treat it as spent and bias every later allocation past it.
  refreshFrontier();
  if (entry.wire !== null && entry.wire > frontier && entry.wire > unansweredFloor) {
    unansweredFloor = entry.wire;
    stats.unansweredProbes++;
    log.warn('QPM-WS-014', { type: entry.commandType, seq: entry.wire, frontier, roomExecuted: readRoomExecuted() });
  }
  settle(entry, null);
}

function handleResult(res: QuinoaCommandResultMessage): void {
  const code = typeof res.code === 'string' ? res.code : 'unknown';
  if (res.ok) stats.resultsOk++;
  else stats.resultsRejected[code] = (stats.resultsRejected[code] ?? 0) + 1;
  // CS-18: any reply proves the socket is answering us again, so the forward
  // bias has done its job and must not keep the counter pinned.
  unansweredFloor = 0;

  const slot = assigned.get(res.requestId);
  assigned.delete(res.requestId);
  if (!res.ok && code === 'invalid_sequence' && (!slot || slot.epoch === epoch)) heal();

  const entry = pending.get(res.requestId);
  if (!entry) return;
  // wire === null: the sequencer never saw this envelope, so the chokepoint
  // wrapper is off the send path (server answers a zero sequence invalid_message).
  if (!res.ok && code === 'invalid_message' && entry.wire === null) {
    attach.reportBypass({ type: entry.commandType, requestId: entry.requestId });
  }
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
  if (!started || !attach.isLive()) return false;
  const current = room ?? getRoom();
  return attach.attachedRoom() === current;
}

export function startCommandSequencer(): void {
  if (started) return;
  if (!isSequencerEnabled()) {
    log.info('command sequencer disabled by kill switch', { key: SEQUENCER_ENABLED_KEY });
    return;
  }
  started = true;
  unregisterForeignSignal = registerForeignSignal('room.send', () => foreignGate.active());
  unregisterChainLine = registerSendChainLineSource(() => formatSendChainLine(attach.chain()));
  // onRoomConnectionChange fires 'initial' synchronously with the current room.
  stopEvents = onRoomConnectionChange(() => attach.ensureAttached());
}

/**
 * CS-2: outer wrappers (locker, nativeSendObserver) call this before installing
 * their own patch so the sequencer sits INNERMOST regardless of the order the
 * three feature timers fire in. No-op when the sequencer is stopped or when
 * already attached to the same connection.
 */
export function ensureCommandSequencerAttached(): void {
  if (!started) return;
  attach.ensureAttached();
}

/** Every layer on both send slots and the chokepoint, top→bottom (debug + copy report). */
export function getSendChainReport(): SendChainReport | null {
  return attach.chain();
}

export function stopCommandSequencer(): void {
  if (!started) return;
  started = false;
  stopEvents?.(); stopEvents = null;
  if (idleResyncTimer !== null) { clearTimeout(idleResyncTimer); idleResyncTimer = null; }
  if (unregisterForeignSignal) { unregisterForeignSignal(); unregisterForeignSignal = null; }
  if (unregisterChainLine) { unregisterChainLine(); unregisterChainLine = null; }
  resultBinder.unbind();
  attach.detach();
  for (const entry of [...pending.values()]) settle(entry, null);
  assigned.clear();
  unansweredFloor = 0;
  skippedPreSessionWarned = false;
  foreignGate.reset();
  attach.resetWarnings();
}

export function getCommandSequencerStats(): Record<string, unknown> {
  return {
    started,
    attached: isCommandSequencerActive(),
    ...attach.describe(),
    envelopeEnabled: isEnvelopeEnabled(),
    sequencerEnabled: isSequencerEnabled(),
    wire,
    frontier,
    seeded,
    epoch,
    unansweredFloor,
    roomExecuted: readRoomExecuted(),
    pending: pending.size,
    outstanding: countOutstanding(assigned.values(), Date.now(), RESULT_TIMEOUT_MS),
    ...stats,
    resultsRejected: { ...stats.resultsRejected },
  };
}
