import { getAtomByLabel, readAtomValue } from '../core/jotaiBridge';
import { pageWindow } from '../core/pageContext';
import { log } from '../utils/logger';
import { sendRoomAction } from '../websocket/api';

type XY = { x: number; y: number };

const STOP_EVENTS = ['visibilitychange', 'blur', 'focus', 'focusout', 'pagehide', 'freeze', 'resume'] as const;
const HEARTBEAT_MS = 25_000;
const POSITION_PING_MS = 60_000;

type EventTargetLike = Document | Window;

interface EventListenerRecord {
  target: EventTargetLike;
  type: string;
  handler: (event: Event) => void;
}

interface PageWindowWithData extends Window {
  myData?: unknown;
}

let isActive = false;
let listeners: EventListenerRecord[] = [];

let savedHiddenDescriptor: PropertyDescriptor | undefined;
let savedVisibilityStateDescriptor: PropertyDescriptor | undefined;
let savedHasFocus: (() => boolean) | null = null;

let audioCtx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let audioResumeHandler: (() => void) | null = null;

let heartbeatTimer: number | null = null;
let pingTimer: number | null = null;
let lastKnownPosition: XY | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePosition(position: XY): XY {
  return { x: Math.round(position.x), y: Math.round(position.y) };
}

function asPosition(value: unknown): XY | null {
  if (!isRecord(value)) return null;
  const x = value.x;
  const y = value.y;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return normalizePosition({ x, y });
}

function readPath(root: unknown, path: ReadonlyArray<string>): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function findPosition(root: unknown, paths: ReadonlyArray<ReadonlyArray<string>>): XY | null {
  for (const path of paths) {
    const candidate = path.length === 0 ? root : readPath(root, path);
    const position = asPosition(candidate);
    if (position) return position;
  }
  return null;
}

function getPlayerId(player: unknown): string | null {
  if (!isRecord(player)) return null;
  const candidateIds = [player.id, player.playerId, player.userId];
  for (const candidate of candidateIds) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function findUserSlotByPlayerId(userSlots: unknown, playerId: string): unknown {
  if (Array.isArray(userSlots)) {
    return userSlots.find((slot) => isRecord(slot) && String(slot.playerId ?? '').trim() === playerId) ?? null;
  }
  if (isRecord(userSlots)) {
    for (const slot of Object.values(userSlots)) {
      if (isRecord(slot) && String(slot.playerId ?? '').trim() === playerId) {
        return slot;
      }
    }
  }
  return null;
}

async function resolvePositionFromPlayerAtom(): Promise<{ player: unknown; position: XY | null }> {
  const playerAtom = getAtomByLabel('playerAtom');
  const player = playerAtom ? await readAtomValue<unknown>(playerAtom).catch(() => null) : null;

  // Position lives in a standalone positionAtom, not inside playerAtom.
  for (const label of ['positionAtom', 'localPlayerPositionAtom'] as const) {
    const atom = getAtomByLabel(label);
    if (!atom) continue;
    const value = await readAtomValue<unknown>(atom).catch(() => null);
    const position = asPosition(value);
    if (position) return { player, position };
  }

  return { player, position: null };
}

function resolvePositionFromMyData(): XY | null {
  const page = pageWindow as unknown as PageWindowWithData;
  const myData = page.myData;
  if (!myData) return null;

  return findPosition(myData, [
    ['position'],
    ['coords'],
    ['player', 'position'],
    ['player', 'coords'],
    ['room', 'position'],
    ['room', 'playerPosition'],
    ['state', 'position'],
    ['state', 'player', 'position'],
  ]);
}

async function resolvePositionFromStateAtom(player: unknown): Promise<XY | null> {
  const stateAtom = getAtomByLabel('stateAtom');
  if (!stateAtom) return null;

  const state = await readAtomValue<unknown>(stateAtom).catch(() => null);
  if (!state) return null;

  const playerId = getPlayerId(player);
  if (!playerId) return null;

  const userSlots = readPath(state, ['child', 'data', 'userSlots']);
  const playerSlot = findUserSlotByPlayerId(userSlots, playerId);
  if (!playerSlot) return null;

  return findPosition(playerSlot, [
    ['position'],
    ['coords'],
    ['data', 'position'],
    ['data', 'coords'],
    ['data', 'player', 'position'],
    ['data', 'player', 'coords'],
  ]);
}

async function resolveCurrentPosition(): Promise<XY | null> {
  const fromPlayer = await resolvePositionFromPlayerAtom();
  if (fromPlayer.position) {
    lastKnownPosition = fromPlayer.position;
    return fromPlayer.position;
  }

  const fromMyData = resolvePositionFromMyData();
  if (fromMyData) {
    lastKnownPosition = fromMyData;
    return fromMyData;
  }

  const fromState = await resolvePositionFromStateAtom(fromPlayer.player);
  if (fromState) {
    lastKnownPosition = fromState;
    return fromState;
  }

  return lastKnownPosition;
}

function swallowLifecycleEvents(): void {
  const add = (target: EventTargetLike, type: string): void => {
    const handler = (event: Event): void => {
      event.stopImmediatePropagation();
      event.preventDefault?.();
    };
    target.addEventListener(type, handler, { capture: true });
    listeners.push({ target, type, handler });
  };

  for (const eventType of STOP_EVENTS) {
    add(document, eventType);
    add(window, eventType);
  }
}

function unswallowLifecycleEvents(): void {
  for (const { target, type, handler } of listeners) {
    try {
      target.removeEventListener(type, handler, true);
    } catch {
      // no-op
    }
  }
  listeners = [];
}

function patchDocumentVisibility(): void {
  const docProto = Object.getPrototypeOf(document) as object;
  savedHiddenDescriptor = Object.getOwnPropertyDescriptor(docProto, 'hidden');
  savedVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(docProto, 'visibilityState');
  savedHasFocus = typeof document.hasFocus === 'function' ? document.hasFocus.bind(document) : null;

  try {
    Object.defineProperty(docProto, 'hidden', { configurable: true, get: () => false });
  } catch {
    // no-op
  }

  try {
    Object.defineProperty(docProto, 'visibilityState', { configurable: true, get: () => 'visible' });
  } catch {
    // no-op
  }

  try {
    (document as Document & { hasFocus?: () => boolean }).hasFocus = () => true;
  } catch {
    // no-op
  }
}

function restoreDocumentVisibility(): void {
  const docProto = Object.getPrototypeOf(document) as object;

  try {
    if (savedHiddenDescriptor) {
      Object.defineProperty(docProto, 'hidden', savedHiddenDescriptor);
    }
  } catch {
    // no-op
  }

  try {
    if (savedVisibilityStateDescriptor) {
      Object.defineProperty(docProto, 'visibilityState', savedVisibilityStateDescriptor);
    }
  } catch {
    // no-op
  }

  try {
    if (savedHasFocus) {
      (document as Document & { hasFocus?: () => boolean }).hasFocus = savedHasFocus;
    }
  } catch {
    // no-op
  }
}

function startAudioKeepAlive(): void {
  const win = pageWindow as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioCtor = win.AudioContext ?? win.webkitAudioContext ?? window.AudioContext;
  if (!AudioCtor) return;

  try {
    const ctx = new AudioCtor({ latencyHint: 'interactive' });
    const gain = ctx.createGain();
    gain.gain.value = 0.00001;
    const osc = ctx.createOscillator();
    osc.frequency.value = 1;
    osc.connect(gain).connect(ctx.destination);
    osc.start();

    audioCtx = ctx;
    gainNode = gain;
    oscillator = osc;

    audioResumeHandler = () => {
      if (!audioCtx || audioCtx.state === 'running') return;
      void audioCtx.resume().catch(() => {});
    };

    document.addEventListener('visibilitychange', audioResumeHandler, { capture: true });
    window.addEventListener('focus', audioResumeHandler, { capture: true });
  } catch {
    stopAudioKeepAlive();
  }
}

function stopAudioKeepAlive(): void {
  try {
    oscillator?.stop();
  } catch {
    // no-op
  }

  try {
    oscillator?.disconnect();
    gainNode?.disconnect();
  } catch {
    // no-op
  }

  try {
    void audioCtx?.close();
  } catch {
    // no-op
  }

  if (audioResumeHandler) {
    document.removeEventListener('visibilitychange', audioResumeHandler, true);
    window.removeEventListener('focus', audioResumeHandler, true);
  }

  oscillator = null;
  gainNode = null;
  audioCtx = null;
  audioResumeHandler = null;
}

function startHeartbeat(): void {
  const target = (document.querySelector('canvas') as HTMLElement | null) ?? document.body ?? document.documentElement;
  heartbeatTimer = window.setInterval(() => {
    try {
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    } catch {
      // no-op
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer === null) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function pingCurrentPosition(): Promise<void> {
  const position = await resolveCurrentPosition();
  if (!position) return;

  sendRoomAction(
    'PlayerPosition',
    { position: normalizePosition(position) },
    { throttleMs: 0, skipThrottle: true },
  );
}

function startPositionPing(): void {
  pingTimer = window.setInterval(() => {
    void pingCurrentPosition();
  }, POSITION_PING_MS);

  void pingCurrentPosition();
}

function stopPositionPing(): void {
  if (pingTimer === null) return;
  clearInterval(pingTimer);
  pingTimer = null;
}

export async function initializeAntiAfk(): Promise<void> {
  if (isActive) return;

  isActive = true;
  try {
    patchDocumentVisibility();
    swallowLifecycleEvents();
    startAudioKeepAlive();
    startHeartbeat();
    startPositionPing();
    log('[Anti-AFK] initialized');
  } catch (error) {
    stopAntiAfk();
    throw error;
  }
}

export function stopAntiAfk(): void {
  if (!isActive) return;
  isActive = false;

  stopPositionPing();
  stopHeartbeat();
  stopAudioKeepAlive();
  unswallowLifecycleEvents();
  restoreDocumentVisibility();
  log('[Anti-AFK] stopped');
}
