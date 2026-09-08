// Push signals for the send-chain wrap sites. The game creates
// MagicCircle_RoomConnection once (RoomConnection.getInstance), replaces
// `currentWebSocket` on every (re)connect and installs wrappers by plain
// own-property assignment — all observable with accessor traps, no 2 s poll.
import { exportToPage, pageWindow } from '../core/pageContext';
import { storage } from '../utils/storage';
import { criticalInterval } from '../utils/scheduling/timerManager';

export type ChainChangeReason = 'initial' | 'room' | 'socket' | 'slot' | 'qpm-wrap' | 'safety';
export interface RoomLike { sendMessage?: unknown; trySendMessageNow?: unknown; currentWebSocket?: unknown }
type Listener = (room: RoomLike | null, reason: ChainChangeReason) => void;

export const CHAIN_SAFETY_POLL_KEY = 'qpm.ws.chainSafetyPoll.enabled';
const SAFETY_POLL_MS = 30_000;
// A closed socket with no 'socket' event inside this window means the trap is
// installed but inert (accessor defined on a shadow the page never touches).
const SOCKET_LIVENESS_MS = 30_000;
const ROOM_KEY = 'MagicCircle_RoomConnection';
const SLOT_KEYS = ['sendMessage', 'trySendMessageNow'] as const;

const listeners = new Set<Listener>();
// Per-room: installed getter reference per key. Identity compare against the
// live descriptor is what lets us notice a foreign `delete room.sendMessage`
// or a foreign `defineProperty` and re-trap on the next tick.
const trapped = new WeakMap<object, Map<string, () => unknown>>();
let windowGetter: (() => unknown) | null = null;
// Any load-bearing trap (window ROOM_KEY, currentWebSocket) refused or proven
// inert. Slot traps failing does NOT flip this — wrap sites re-check on
// 'socket'/'room'.
let trapFailed = false;
// Proven inert by the socket-liveness check: never re-trap, reads must reach
// the real properties and the safety check is the only signal left.
let trapsInert = false;
let stopSafety: (() => void) | null = null;
let scheduled = false;
let pendingReason: ChainChangeReason = 'room';
let watchedSocket: object | null = null;
let socketEventSeq = 0;
let livenessTimer: ReturnType<typeof setTimeout> | null = null;

function currentRoom(): RoomLike | null {
  const r = (pageWindow as unknown as Record<string, unknown>)[ROOM_KEY];
  return r && typeof r === 'object' ? (r as RoomLike) : null;
}

function emit(reason: ChainChangeReason): void {
  if (reason === 'socket') socketEventSeq += 1;
  // Coalesce: a wrapper install touches two slots in one tick.
  pendingReason = reason;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const room = currentRoom();
    if (room) {
      if (!trapsInert) trapRoom(room);
      watchSocket(room);
    }
    if (listeners.size > 0) ensureSafety();
    for (const l of listeners) { try { l(room, pendingReason); } catch { /* isolate */ } }
  });
}

// Accessor over a backing slot; assignment keeps working for everyone.
// Returns the installed getter (for identity re-verify later) or null on refusal.
function trapField(target: object, key: string, reason: ChainChangeReason): (() => unknown) | null {
  const desc = Object.getOwnPropertyDescriptor(target, key);
  if (desc && (desc.get || desc.set || desc.configurable === false)) return null;
  let value: unknown = desc ? desc.value : undefined;
  const proto = Object.getPrototypeOf(target) as Record<string, unknown> | null;
  // Fall through to the prototype method while nothing is installed so
  // captureSendSlot/classifySendSlot keep seeing the game's function.
  const getter = exportToPage(function get(this: unknown) {
    return value !== undefined ? value : proto?.[key];
  });
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      // Prototype methods are non-enumerable; keep the slot accessors that way
      // so Object.keys(room)/spread never surface them.
      enumerable: desc ? desc.enumerable === true : false,
      get: getter,
      set: exportToPage(function set(this: unknown, next: unknown) {
        value = next;
        emit(reason);
      }),
    });
    return getter;
  } catch { return null; }
}

function trapRoom(room: RoomLike): void {
  let done = trapped.get(room as object);
  if (!done) { done = new Map(); trapped.set(room as object, done); }
  // currentWebSocket is load-bearing (drives 'socket' events on reconnect).
  const targets: Array<{ key: string; reason: ChainChangeReason; loadBearing: boolean }> = [
    { key: 'currentWebSocket', reason: 'socket', loadBearing: true },
    ...SLOT_KEYS.map((k) => ({ key: k, reason: 'slot' as const, loadBearing: false })),
  ];
  for (const { key, reason, loadBearing } of targets) {
    const existing = done.get(key);
    const desc = Object.getOwnPropertyDescriptor(room as object, key);
    if (existing && desc?.get === existing) continue;
    const installed = trapField(room as object, key, reason);
    if (installed) {
      done.set(key, installed);
    } else {
      done.delete(key);
      if (loadBearing) trapFailed = true;
    }
  }
}

// Remove our accessors so reads reach the real properties again. Nothing is
// reassigned: on an inert trap the real object already holds the live value,
// on a real trap the game re-creates the field on its next assignment.
function untrapRoom(room: RoomLike): void {
  const done = trapped.get(room as object);
  if (!done) return;
  for (const [key, getter] of done) {
    const desc = Object.getOwnPropertyDescriptor(room as object, key);
    if (desc?.get === getter) { try { delete (room as Record<string, unknown>)[key]; } catch { /* ignore */ } }
  }
  done.clear();
}

function socketOf(room: RoomLike): (object & { addEventListener?: unknown; readyState?: unknown }) | null {
  const ws = room.currentWebSocket;
  return ws && typeof ws === 'object' && typeof (ws as { addEventListener?: unknown }).addEventListener === 'function'
    ? (ws as object & { addEventListener?: unknown; readyState?: unknown })
    : null;
}

// Liveness: a socket close is always followed by a reconnect that assigns a new
// `currentWebSocket`; if our setter never sees it, the trap is inert and the
// wrap sites would stay bound to a dead socket. Untrap + fall back to the check.
function watchSocket(room: RoomLike): void {
  const ws = socketOf(room);
  if (!ws || ws === watchedSocket) return;
  watchedSocket = ws;
  if (livenessTimer !== null) { clearTimeout(livenessTimer); livenessTimer = null; }
  const seqAtBind = socketEventSeq;
  const onClose = (): void => {
    if (watchedSocket !== ws || livenessTimer !== null) return;
    livenessTimer = setTimeout(() => {
      livenessTimer = null;
      if (socketEventSeq !== seqAtBind || listeners.size === 0) return;
      const r = currentRoom();
      if (r) untrapRoom(r);
      watchedSocket = null;
      trapsInert = true;
      trapFailed = true;
      ensureSafety();
      emit('safety');
    }, SOCKET_LIVENESS_MS);
  };
  try { (ws.addEventListener as (t: string, cb: () => void, o?: unknown) => void).call(ws, 'close', onClose, { once: true }); } catch { /* ignore */ }
}

function trapWindow(): void {
  if (windowGetter) return;
  const win = pageWindow as unknown as Record<string, unknown>;
  // Already created — nothing to await; slot traps still install on trapRoom.
  if (win[ROOM_KEY]) return;
  const installed = trapField(win, ROOM_KEY, 'room');
  if (installed) windowGetter = installed;
  else trapFailed = true;
}

function ensureSafety(): void {
  if (stopSafety) return;
  const forced = storage.get<boolean>(CHAIN_SAFETY_POLL_KEY, false) === true;
  // Traps are the only signal; with none we would never attach (Firefox
  // accessor export is unverified). Fall back to the 30 s check.
  if (!forced && !trapFailed) return;
  stopSafety = criticalInterval('qpm-chain-safety', () => emit('safety'), SAFETY_POLL_MS);
}

export function onRoomConnectionChange(cb: Listener): () => void {
  listeners.add(cb);
  trapWindow();
  const room = currentRoom();
  if (room) {
    if (!trapsInert) trapRoom(room);
    watchSocket(room);
  }
  ensureSafety();
  try { cb(room, 'initial'); } catch { /* isolate */ }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      if (stopSafety) { stopSafety(); stopSafety = null; }
      if (livenessTimer !== null) { clearTimeout(livenessTimer); livenessTimer = null; }
    }
  };
}

/** QPM wrap sites call this after installing/restoring their own layer. */
export function notifyChainChanged(): void { emit('qpm-wrap'); }

export function isChainTrapInstalled(): { room: boolean; socket: boolean; slots: boolean; safety: boolean } {
  // Live descriptor identity — bookkeeping alone can lie after a foreign
  // `delete room.sendMessage` (accessor gone, our Map still says installed).
  const win = pageWindow as unknown as Record<string, unknown>;
  const winDesc = Object.getOwnPropertyDescriptor(win, ROOM_KEY);
  const roomOk = windowGetter !== null && winDesc?.get === windowGetter;
  const room = currentRoom();
  const done = room ? trapped.get(room as object) : undefined;
  const socketGetter = done?.get('currentWebSocket');
  const socketDesc = room ? Object.getOwnPropertyDescriptor(room as object, 'currentWebSocket') : undefined;
  const socketOk = socketGetter !== undefined && socketDesc?.get === socketGetter;
  const slotsOk = room !== null && SLOT_KEYS.every((k) => {
    const g = done?.get(k);
    const d = Object.getOwnPropertyDescriptor(room as object, k);
    return g !== undefined && d?.get === g;
  });
  return { room: roomOk, socket: socketOk, slots: slotsOk, safety: stopSafety !== null };
}
