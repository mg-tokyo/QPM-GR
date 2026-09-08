// src/websocket/commandSequencer.ts
// Wraps the send chokepoint and rewrites every outbound envelope's
// commandSequence so QPM and the game share ONE counter (server accepts
// only frontier+1; stale/duplicate gets no result, gaps return
// invalid_sequence). Wrapper is the INNERMOST layer so numbers are only
// allocated for messages that actually reach the socket.

import { pageWindow } from '../core/pageContext';
import { createNamedLogger } from '../diagnostics/logger';
import { registerForeignSignal } from '../diagnostics/modDetection';
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
import {
  brandWrapper,
  captureSendSlot,
  classifySendSlot,
  createForeignEpisodeGate,
  restoreSendSlot,
  type CapturedSlot,
  type SendSlotClass,
} from './sendChain';
import { notifyChainChanged, onRoomConnectionChange } from './roomConnectionEvents';

const log = createNamedLogger('websocket');

export const ENVELOPE_ENABLED_KEY = 'qpm.ws.envelope.enabled';
export const SEQUENCER_ENABLED_KEY = 'qpm.ws.sequencer.enabled';
const STALE_DETECT_ENABLED_KEY = 'qpm.ws.sequencer.staleDetect.enabled';
const STALE_GRACE_MS_KEY = 'qpm.ws.sequencer.staleGraceMs';
const RESULT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;
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

// One record per connection. `live: false` means the wrapper is defused
// (buried under outer wrappers, pass-through, re-armable on a later event).
interface InstallRecord {
  live: boolean;
  send: CapturedSlot;
  trySlot: CapturedSlot | null;
  wrappedSend: (payload: unknown) => unknown;
  wrappedTry: ((payload: unknown) => boolean) | null;
  unsubWelcome: (() => void) | null;
  unsubFrames: (() => void) | null;
}

const installs = new WeakMap<SequencerConnection, InstallRecord>();

let started = false;
let attached: { room: SequencerConnection; record: InstallRecord } | null = null;
let boundSocket: WebSocket | null = null;
let stopEvents: (() => void) | null = null;
let idleResyncTimer: ReturnType<typeof setTimeout> | null = null;

let wire = 0;
let frontier = 0;
let seeded = false;
// Bumped on every invalid_sequence heal so rejections from an older epoch
// don't re-heal (a burst of sibling rejections would race a live retry).
let epoch = 0;

const pending = new Map<string, PendingEntry>();
const assigned = new Map<string, { epoch: number; seq: number; at: number }>();
let skippedPreSessionWarned = false;

const foreignGate = createForeignEpisodeGate(3, 3000);
let unregisterForeignSignal: (() => void) | null = null;
// QPM-branded wrapper on top but no re-armable record — warn once.
let qpmToppedWarned = false;

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
};

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
  // Frames are ~1/s and cheap when pending is empty; catches a burned number
  // between allocations without needing the removed 2 s reattach poll.
  if (pending.size === 0) checkIdleResync();
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

// CS-1 heal used to ride the 2 s poll; a burned number is only possible after
// an allocation, so one timer per allocation (reset on each) covers it.
function armIdleResync(): void {
  if (idleResyncTimer !== null) clearTimeout(idleResyncTimer);
  idleResyncTimer = setTimeout(() => { idleResyncTimer = null; checkIdleResync(); }, RESULT_TIMEOUT_MS + 250);
}

function allocate(): number {
  if (!seeded) seedFrom(attached?.room.lastDistributedRoomPublication?.executedCommandSequence);
  if (frontier > wire) wire = frontier;
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
  const { room, record } = attached;
  try { record.unsubWelcome?.(); } catch { /* noop */ }
  try { record.unsubFrames?.(); } catch { /* noop */ }
  record.unsubWelcome = null;
  record.unsubFrames = null;
  let sendRestored = false;
  let tryRestored = true;
  try { sendRestored = restoreSendSlot(room, 'sendMessage', record.send, record.wrappedSend); } catch { /* noop */ }
  try {
    if (record.wrappedTry && record.trySlot) {
      tryRestored = restoreSendSlot(room, 'trySendMessageNow', record.trySlot, record.wrappedTry);
    }
  } catch { tryRestored = false; }
  if (sendRestored && tryRestored) {
    installs.delete(room);
  } else {
    // Buried under outer wrappers — defuse: the closures become transparent
    // pass-throughs and the record stays re-armable for this connection.
    record.live = false;
    stats.defusedDetaches++;
  }
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

  // CS-5: an own-property send function that is neither the prototype method
  // nor QPM-branded is a third-party wrapper; attaching under it would burn a
  // number for every send its layer refuses. QPM-branded tops are our own
  // outer wrappers over a buried (defused) sequencer wrapper: re-arm it.
  const sendClass = classifySendSlot(room, 'sendMessage');
  const tryClass = classifySendSlot(room, 'trySendMessageNow');
  const foreignSend = sendClass === 'foreign';
  const foreignTry = tryClass === 'foreign';
  if (foreignSend || foreignTry) {
    stats.layeringRefusals++;
    const refusal = foreignGate.refused();
    if (refusal.warn) {
      log.warn('QPM-WS-013', { phase: 'layering', foreignSend, foreignTry, sustainedChecks: refusal.checks });
    }
    return;
  }
  const episode = foreignGate.cleared();
  if (episode?.warned) {
    log.info('foreign send wrapper cleared', { checks: episode.checks, durationMs: episode.durationMs });
  }

  if (sendClass === 'qpm' || tryClass === 'qpm') {
    const record = installs.get(room);
    if (!record) {
      // Our outer wrappers sit directly over the prototype and no sequencer
      // wrapper is buried below them (kill switch off at their install time).
      // Attaching over the top would break the innermost invariant — refuse;
      // a page reload resolves the ordering.
      if (!qpmToppedWarned) {
        qpmToppedWarned = true;
        log.warn('QPM-WS-008', { phase: 'layering', qpmBranded: true, rearmable: false });
      }
      return;
    }
    rearm(room, record, sendClass, tryClass);
    return;
  }

  // Chain fully unwound — any old record's wrapper is no longer installed.
  installs.delete(room);

  const sendSlot = captureSendSlot(room, 'sendMessage');
  if (!sendSlot) return;
  const trySlot = captureSendSlot(room, 'trySendMessageNow');

  const record: InstallRecord = {
    live: true,
    send: sendSlot,
    trySlot,
    wrappedSend: sendSlot.bound,
    wrappedTry: null,
    unsubWelcome: null,
    unsubFrames: null,
  };
  const wrappedSend = brandWrapper((payload: unknown): unknown => {
    if (!record.live) return sendSlot.bound(payload);
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
      return sendSlot.bound(payload);
    }
    rewrite(payload);
    return sendSlot.bound(payload);
  }, 'commandSequencer');
  record.wrappedSend = wrappedSend;
  const wrappedTry = trySlot
    ? brandWrapper((payload: unknown): boolean => {
        if (!record.live) return trySlot.bound(payload) === true;
        observeOutbound(payload);
        const seq = rewrite(payload);
        const sent = trySlot.bound(payload);
        if (seq !== null && sent !== true) rollback(seq);
        return sent === true;
      }, 'commandSequencer')
    : null;
  record.wrappedTry = wrappedTry;

  try {
    room.sendMessage = wrappedSend;
    if (wrappedTry) room.trySendMessageNow = wrappedTry;
    if (typeof room.subscribeToRoomFrames === 'function') {
      record.unsubFrames = toUnsub(room.subscribeToRoomFrames(onFrame));
    }
    if (typeof room.subscribeToWelcome === 'function') {
      // Fires synchronously with the current publication when already connected.
      record.unsubWelcome = toUnsub(room.subscribeToWelcome((_state, _ms, seq) => onWelcome(seq)));
    }
    if (!seeded) seedFrom(room.lastDistributedRoomPublication?.executedCommandSequence);
    installs.set(room, record);
    attached = { room, record };
    qpmToppedWarned = false;
    bindSocket(room);
    checkIdleResync();
    notifyChainChanged();
    log.debug('command sequencer attached', { wire, frontier, hasTry: !!trySlot });
  } catch (err) {
    try { restoreSendSlot(room, 'sendMessage', sendSlot, wrappedSend); } catch { /* noop */ }
    try { if (wrappedTry && trySlot) restoreSendSlot(room, 'trySendMessageNow', trySlot, wrappedTry); } catch { /* noop */ }
    try { record.unsubWelcome?.(); } catch { /* noop */ }
    try { record.unsubFrames?.(); } catch { /* noop */ }
    installs.delete(room);
    attached = null;
    log.warn('QPM-WS-008', { phase: 'attach' }, err);
  }
}

// Re-enter a defused install: the wrapper is still buried in the chain, so
// re-arming it (not wrapping on top) preserves the innermost position. Slots
// classified 'clean' get our wrapper re-installed — the captured original is
// still valid because our own restore returned the slot to its prior state.
function rearm(
  room: SequencerConnection,
  record: InstallRecord,
  sendClass: SendSlotClass,
  tryClass: SendSlotClass,
): void {
  try {
    if (sendClass === 'clean') room.sendMessage = record.wrappedSend;
    if (tryClass === 'clean' && record.wrappedTry) room.trySendMessageNow = record.wrappedTry;
    if (typeof room.subscribeToRoomFrames === 'function') {
      record.unsubFrames = toUnsub(room.subscribeToRoomFrames(onFrame));
    }
    if (typeof room.subscribeToWelcome === 'function') {
      // Fires synchronously when connected — reseeds wire/frontier, which may
      // have reset server-side while the wrapper was defused.
      record.unsubWelcome = toUnsub(room.subscribeToWelcome((_state, _ms, seq) => onWelcome(seq)));
    }
    record.live = true;
    attached = { room, record };
    stats.rearms++;
    qpmToppedWarned = false;
    bindSocket(room);
    checkIdleResync();
    notifyChainChanged();
    log.debug('command sequencer re-armed', { wire, frontier, sendClass, tryClass });
  } catch (err) {
    record.live = false;
    try { record.unsubWelcome?.(); } catch { /* noop */ }
    try { record.unsubFrames?.(); } catch { /* noop */ }
    record.unsubWelcome = null;
    record.unsubFrames = null;
    attached = null;
    log.warn('QPM-WS-008', { phase: 'rearm' }, err);
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
  if (!started || !attached || !attached.record.live) return false;
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
  unregisterForeignSignal = registerForeignSignal('room.send', () => foreignGate.active());
  // onRoomConnectionChange fires 'initial' synchronously with the current room.
  stopEvents = onRoomConnectionChange(() => ensureAttached());
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
  stopEvents?.(); stopEvents = null;
  if (idleResyncTimer !== null) { clearTimeout(idleResyncTimer); idleResyncTimer = null; }
  if (unregisterForeignSignal) { unregisterForeignSignal(); unregisterForeignSignal = null; }
  unbindSocket();
  detach();
  for (const entry of [...pending.values()]) settle(entry, null);
  assigned.clear();
  skippedPreSessionWarned = false;
  foreignGate.reset();
  qpmToppedWarned = false;
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
