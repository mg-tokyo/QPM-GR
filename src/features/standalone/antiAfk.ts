import { getPlayerPosition as getPlayerPosFromContext } from '../../core/playerContext';
import { readAtomValue as readRegistryAtom } from '../../core/atomRegistry';
import { pageWindow } from '../../core/pageContext';
import { isRecord } from '../../utils/typeGuards';
import { sendRoomAction } from '../../websocket/api';
import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';

// ── Diagnostics ───────────────────────────────────────────────────────────

const FEATURE_SUBSYSTEM: Subsystem = 'feature:antiAfk';
const FEATURE_NAME = 'antiAfk';
const log = createNamedLogger(FEATURE_SUBSYSTEM);
let busRegistered = false;

/**
 * Re-attribute a FEATURE-* code emission to this feature's bus row. The
 * registered placeholder subsystem on FEATURE-* is `'feature'`; without this
 * override the bus would degrade a generic `feature` entry instead of
 * `feature:antiAfk`.
 */
function warnFeature(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  log.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

function errorFeature(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  log.error({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'error' });
}

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
  const player = await readRegistryAtom('player');
  const pos = await getPlayerPosFromContext();
  const position = pos ? asPosition(pos) : null;
  return { player, position };
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
  const state = await readRegistryAtom('state');
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
  } catch (err) {
    warnFeature('QPM-FEATURE-003', { what: 'patch:hidden' }, err);
  }

  try {
    Object.defineProperty(docProto, 'visibilityState', { configurable: true, get: () => 'visible' });
  } catch (err) {
    warnFeature('QPM-FEATURE-003', { what: 'patch:visibilityState' }, err);
  }

  try {
    (document as Document & { hasFocus?: () => boolean }).hasFocus = () => true;
  } catch (err) {
    warnFeature('QPM-FEATURE-003', { what: 'patch:hasFocus' }, err);
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
      void audioCtx.resume().catch((err) => {
        warnFeature('QPM-FEATURE-003', { what: 'audio:resume' }, err);
      });
    };

    document.addEventListener('visibilitychange', audioResumeHandler, { capture: true });
    window.addEventListener('focus', audioResumeHandler, { capture: true });
  } catch (err) {
    warnFeature('QPM-FEATURE-003', { what: 'audio:init' }, err);
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
    } catch (err) {
      log.debug('Heartbeat dispatch failed', { error: String(err) });
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

  const result = sendRoomAction(
    'PlayerPosition',
    { position: normalizePosition(position) },
    { throttleMs: 0, skipThrottle: true },
  );
  // Throttled is impossible (skipThrottle:true) but check defensively. WS layer
  // already emits the per-reason WS-* code; FEATURE-001 attributes to antiAfk.
  if (!result.ok && result.reason !== 'throttled') {
    warnFeature('QPM-FEATURE-001', { type: 'PlayerPosition', reason: result.reason ?? 'unknown' });
  }
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

  if (!busRegistered) {
    healthBus.register(FEATURE_SUBSYSTEM, { category: 'feature', status: 'starting' });
    busRegistered = true;
  }

  isActive = true;
  try {
    patchDocumentVisibility();
    swallowLifecycleEvents();
    startAudioKeepAlive();
    startHeartbeat();
    startPositionPing();
    log.info('Initialized');
    // Patch failures during startup degrade the bus via warnFeature; if the bus
    // is already 'degraded' from a patch, the published 'ok' here will be
    // coerced to 'recovering' by the bus's hysteresis machine (§7.2).
    healthBus.publish({
      subsystem: FEATURE_SUBSYSTEM,
      category: 'feature',
      status: 'ok',
      message: 'Lifecycle patched, heartbeat + position ping active',
    });
  } catch (error) {
    errorFeature('QPM-FEATURE-003', { what: 'init' }, error);
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
  log.info('Stopped');
}
