// src/core/stateTree.ts
//
// Tier 3 state-tree subsystem. Subscribes ONCE to the game's `stateAtom` and
// exposes typed, deep-equals-memoized selectors + subscribers. Every QPM
// consumer of game state (except atoms that stay label-only) derives from this.
//
// Why: game devs are progressively deprecating "convenience atoms" (shopsAtom,
// weatherAtom, etc.) in favor of subscribing to stateAtom directly. This module
// mirrors the game's own pattern (beta store/utils.ts `selectAtomDeepEquals`
// = selectAtom(stateAtom, selector, isEqual)) so QPM is future-proof:
//   - Atom renames don't require QPM edits (we read state paths, not labels)
//   - Selector callbacks only fire when the derived value actually changes
//   - Typed via QuinoaStateSnapshot in types/gameAtoms.ts
//
// See .claude/plans/wise-humming-corbato.md for the design decisions.

import { getAtomByLabel, subscribeAtom, readAtomValue as readRawAtomValue, getCachedStore } from './jotaiBridge';
import { shareGlobal } from './pageContext';
import { deepEqual } from '../utils/deepEqual';
import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger } from '../diagnostics/logger';
import type { Subsystem } from '../diagnostics/types';
import type { QuinoaStateSnapshot } from '../types/gameAtoms';
import { getRoomConnection } from '../websocket/api';
import { getPlayerIdSync } from './playerContext';
import { matchesPathPrefix } from './reactive/pathMatcher';
import type { PatchPath } from './reactive/types';

const diagLog = createNamedLogger('stateTree');
const SUBSYSTEM: Subsystem = 'stateTree';

// ─── Selector type ────────────────────────────────────────────────────────

/** Pure function from state snapshot to a derived value. */
export type Selector<T> = (state: QuinoaStateSnapshot) => T;

// ─── Internal state ───────────────────────────────────────────────────────

let currentSnapshot: QuinoaStateSnapshot | null = null;
let ready = false;
let diagnosticsStarted = false;
let sourceUnsubscribe: (() => void) | null = null;
let welcomeUnsubscribe: (() => void) | null = null;
let activeSource: 'roomPatches' | 'stateAtom' | 'none' = 'none';

interface Subscriber {
  readonly id: number;
  readonly selector: Selector<unknown>;
  lastValue: unknown;
  hasFired: boolean;
  readonly callback: (value: unknown) => void;
  readonly label: string | undefined;
  readonly statePath: PatchPath | undefined;
}

let nextSubscriberId = 1;
const subscribers = new Map<number, Subscriber>();

/**
 * A single RFC 6902 JSON Patch operation. Emitted by the game engine's
 * PartialState handling (verified at Thundershop RoomConnection.ts:681-683,
 * uses `Operation[]` from `fast-json-patch`). Paths are JSON Pointer strings
 * rooted at stateAtom's value.
 */
export interface PatchOp {
  readonly op: string;
  readonly path: string;
  readonly value?: unknown;
}

/**
 * Direct patch subscriber, receiving the raw ops plus the fresh snapshot.
 * Used by the reactive manager (src/core/reactive/manager.ts) to route
 * subscribers by patch path. Separate from the selector-memoized
 * `subscribe()` API above.
 */
type PatchListener = (patches: readonly PatchOp[], newState: QuinoaStateSnapshot) => void;
const patchListeners = new Set<PatchListener>();

// Subscribers registered before init resolves; drained on ready.
interface PendingSubscription {
  readonly id: number;
  readonly selector: Selector<unknown>;
  readonly callback: (value: unknown) => void;
  readonly label: string | undefined;
  readonly statePath: PatchPath | undefined;
}
const pending: PendingSubscription[] = [];

let lastFireTs = 0;
let selectorSuppressLog = new WeakSet<Selector<unknown>>();

// ─── Diagnostics ──────────────────────────────────────────────────────────

/**
 * Wire the stateTree subsystem into the diagnostics health bus. Idempotent.
 * Mirrors `startAtomRegistryDiagnostics` at src/core/atomRegistry.ts.
 */
export function startStateTreeDiagnostics(): void {
  if (diagnosticsStarted) return;
  diagnosticsStarted = true;
  healthBus.register(SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Awaiting init',
  });
}

function publishHealth(status: 'ok' | 'degraded' | 'failed', message: string): void {
  if (!diagnosticsStarted) return;
  healthBus.publish({
    subsystem: SUBSYSTEM,
    category: 'core',
    status,
    message,
    metrics: {
      subscribers: subscribers.size,
      pending: pending.length,
      lastFireAgeMs: lastFireTs === 0 ? -1 : Date.now() - lastFireTs,
    },
  });
}

// ─── Core: subscribe once to stateAtom, fan out to subscribers ────────────

function onStateEvent(next: unknown, patches?: readonly PatchOp[]): void {
  currentSnapshot = (next as QuinoaStateSnapshot | null) ?? null;
  lastFireTs = Date.now();
  if (!currentSnapshot) return;

  // Patch-prefix gating for selector subscribers. Empty / absent patches
  // (welcome message, stateAtom fallback path, dev-tools reload) fall back to
  // running every subscriber — safe worst case, matches reactive/manager.ts.
  const havePatchInfo = patches !== undefined && patches.length > 0;
  let myIdx: number | null | undefined; // undefined = unresolved this event

  for (const sub of subscribers.values()) {
    if (havePatchInfo && sub.statePath !== undefined) {
      if (myIdx === undefined) myIdx = resolveMyIdx(currentSnapshot);
      let anyMatch = false;
      for (const patch of patches) {
        if (matchesPathPrefix(patch.path, sub.statePath, myIdx)) { anyMatch = true; break; }
      }
      if (!anyMatch) continue;
    }
    let derived: unknown;
    try {
      derived = sub.selector(currentSnapshot);
    } catch (err) {
      diagLog.warn('QPM-STATETREE-002', { subscriber: sub.label ?? sub.id }, err);
      // Deliver null so caller can distinguish "state present, selector broken"
      // from "state absent." Don't touch lastValue — if the selector recovers
      // on a later event, we'll fire the update then.
      try { sub.callback(null); } catch { /* subscriber threw — swallow */ }
      continue;
    }
    if (sub.hasFired && deepEqual(derived, sub.lastValue)) continue;
    sub.lastValue = derived;
    sub.hasFired = true;
    try { sub.callback(derived); } catch { /* subscriber threw — swallow */ }
  }

  // Fan out to patch listeners (reactive manager). Empty patch array from
  // the stateAtom fallback path is a signal "full snapshot, no patch data".
  if (patchListeners.size > 0) {
    const p = patches ?? EMPTY_PATCHES;
    for (const listener of patchListeners) {
      try { listener(p, currentSnapshot); } catch { /* swallow */ }
    }
  }
}

// Resolves the local player's slot index from the current snapshot. Mirrors
// ReactiveSubscriptionManager.resolveMyIdx (manager.ts:186) so patch-prefix
// gating in stateTree can substitute the `{myIdx}` placeholder without pulling
// in the manager itself. Cheap: single WS URL parse + linear slot scan.
function resolveMyIdx(state: QuinoaStateSnapshot): number | null {
  const playerId = getPlayerIdSync();
  if (!playerId) return null;
  const slots = state.child?.data?.userSlots;
  if (!Array.isArray(slots)) return null;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot && typeof slot === 'object' && (slot as { playerId?: string }).playerId === playerId) return i;
  }
  return null;
}

const EMPTY_PATCHES: readonly PatchOp[] = Object.freeze([]);

/**
 * Try to attach via the game engine's direct patch stream. This is the
 * atom-free path — it doesn't require the Jotai cache to have registered
 * `stateAtom`. Only present on newer bundles (dev tip 2026-07-03).
 *
 * Returns true if the attachment succeeded, false if the API isn't available.
 * Non-throwing.
 */
function tryAttachRoomPatchSubscription(): boolean {
  try {
    const rc = getRoomConnection();
    if (!rc || typeof rc.subscribeToPatches !== 'function') return false;

    const result: unknown = rc.subscribeToPatches((patches, fullState) => {
      // Patches are the RFC 6902 Operation[] from fast-json-patch (verified
      // at Thundershop RoomConnection.ts:82-86 + :681-683).
      onStateEvent(fullState, patches as readonly PatchOp[]);
    });

    // Thundershop bundle returns `{ currentState, unsubscribe }`
    // (RoomConnection.ts:143-156). Older bundles may return a bare unsubscribe
    // function. Support both without `any`.
    if (result && typeof result === 'object' && 'unsubscribe' in result) {
      const unsub = (result as { unsubscribe?: unknown }).unsubscribe;
      if (typeof unsub === 'function') sourceUnsubscribe = unsub as () => void;
      const seed = (result as { currentState?: unknown }).currentState;
      if (seed && typeof seed === 'object') onStateEvent(seed);
    } else if (typeof result === 'function') {
      sourceUnsubscribe = result as () => void;
    }

    // subscribeToWelcome (RoomConnection.ts:172-184) fires on connect and
    // every reconnect, and immediately with the current state if already
    // connected. Public API (unlike the private lastRoomStateJsonable field).
    // Belt-and-braces seed for the case where subscribeToPatches's currentState
    // was empty or absent (older bundles).
    if (typeof rc.subscribeToWelcome === 'function') {
      try {
        const welcomeResult: unknown = rc.subscribeToWelcome((welcomeState: unknown) => {
          if (welcomeState && typeof welcomeState === 'object') onStateEvent(welcomeState);
        });
        if (welcomeResult && typeof welcomeResult === 'object' && 'unsubscribe' in welcomeResult) {
          const welcomeUnsub = (welcomeResult as { unsubscribe?: unknown }).unsubscribe;
          if (typeof welcomeUnsub === 'function') welcomeUnsubscribe = welcomeUnsub as () => void;
        } else if (typeof welcomeResult === 'function') {
          welcomeUnsubscribe = welcomeResult as () => void;
        }
      } catch { /* subscribeToWelcome unavailable on this bundle — non-fatal */ }
    }

    activeSource = 'roomPatches';
    diagLog.info('stateTree source: MagicCircle_RoomConnection.subscribeToPatches');
    return true;
  } catch {
    return false;
  }
}

async function attachStateAtomSubscription(): Promise<void> {
  const stateAtom = getAtomByLabel('stateAtom');
  if (!stateAtom) {
    throw new Error('stateTree: stateAtom not found in jotaiAtomCache');
  }
  // No patches available on the fallback path — patch listeners get an
  // empty patch array as "full-state, treat as reload."
  sourceUnsubscribe = await subscribeAtom(stateAtom, (v: unknown) => onStateEvent(v, EMPTY_PATCHES));
  // subscribeAtom fires an initial value synchronously via `invoke()` — but
  // read once more via readAtomValue to guarantee currentSnapshot is warm even
  // if the initial invoke was lost to a subscribe-race.
  if (!currentSnapshot) {
    try {
      const v = await readRawAtomValue(stateAtom);
      onStateEvent(v);
    } catch {
      // Non-fatal — the atom subscription will still deliver updates.
    }
  }
  activeSource = 'stateAtom';
  diagLog.info('stateTree source: stateAtom (jotai) fallback');
}

async function attachSource(): Promise<void> {
  // Prefer atom-free source (patch stream); fall through to jotai stateAtom.
  if (tryAttachRoomPatchSubscription()) return;
  await attachStateAtomSubscription();
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Initialize the state tree. Must be called after `waitForGame()` in main.ts,
 * before feature stores that depend on state-tree access.
 */
export async function initStateTree(): Promise<void> {
  if (ready) return;
  startStateTreeDiagnostics();
  try {
    await attachSource();
    ready = true;

    // Drain pending subscribers registered before init completed.
    for (const p of pending) {
      const sub: Subscriber = {
        id: p.id,
        selector: p.selector,
        lastValue: undefined,
        hasFired: false,
        callback: p.callback,
        label: p.label,
        statePath: p.statePath,
      };
      subscribers.set(p.id, sub);
      // Fire immediately if we already have a snapshot.
      if (currentSnapshot) {
        try {
          const initial = sub.selector(currentSnapshot);
          sub.lastValue = initial;
          sub.hasFired = true;
          try { sub.callback(initial); } catch { /* swallow */ }
        } catch (err) {
          diagLog.warn('QPM-STATETREE-002', { subscriber: sub.label ?? sub.id }, err);
        }
      }
    }
    pending.length = 0;

    exposeDebugBridge();
    publishHealth('ok', `state tree ready (${subscribers.size} subscribers)`);
  } catch (err) {
    publishHealth('failed', 'initStateTree failed');
    throw err;
  }
}

/** Tear down. Idempotent. Used for test hot-reloads. */
export function stopStateTree(): void {
  try { sourceUnsubscribe?.(); } catch { /* ignore */ }
  try { welcomeUnsubscribe?.(); } catch { /* ignore */ }
  sourceUnsubscribe = null;
  welcomeUnsubscribe = null;
  subscribers.clear();
  pending.length = 0;
  currentSnapshot = null;
  ready = false;
  lastFireTs = 0;
  activeSource = 'none';
  selectorSuppressLog = new WeakSet<Selector<unknown>>();
}

/** Which source is currently feeding the state tree. */
export function stateTreeSource(): 'roomPatches' | 'stateAtom' | 'none' {
  return activeSource;
}

export function stateTreeReady(): boolean {
  return ready;
}

/**
 * Read a derived value from the current state snapshot. Returns null if state
 * is not ready. Emits QPM-STATETREE-001 once per selector identity.
 *
 * For live updates use `subscribe()`. `select()` is a one-shot read.
 */
export function select<T>(selector: Selector<T>): T | null {
  if (!ready || !currentSnapshot) {
    if (!selectorSuppressLog.has(selector as Selector<unknown>)) {
      selectorSuppressLog.add(selector as Selector<unknown>);
      diagLog.warn('QPM-STATETREE-001', { reason: !ready ? 'not-ready' : 'no-snapshot' });
    }
    return null;
  }
  try {
    return selector(currentSnapshot);
  } catch (err) {
    diagLog.warn('QPM-STATETREE-002', { phase: 'select' }, err);
    return null;
  }
}

/**
 * Read a derived value synchronously from either the current snapshot or the
 * jotai store as fallback. Used by atomRegistry.readAtomValueSync — the store
 * fallback covers the case where a sync-context read fires before the initial
 * subscription callback has run.
 */
export function selectSync<T>(selector: Selector<T>): T | null {
  const snap = currentSnapshot ?? readSnapshotFromStore();
  if (!snap) return null;
  try {
    return selector(snap);
  } catch (err) {
    diagLog.warn('QPM-STATETREE-002', { phase: 'selectSync' }, err);
    return null;
  }
}

function readSnapshotFromStore(): QuinoaStateSnapshot | null {
  // Atom-free snapshot path: use the room connection's cached last state when
  // available. Only accepts objects that look like a Quinoa-scoped state.
  try {
    const rc = getRoomConnection();
    const last = rc?.lastRoomStateJsonable;
    if (last && typeof last === 'object') {
      return last as QuinoaStateSnapshot;
    }
  } catch { /* fall through to jotai */ }

  try {
    const stateAtom = getAtomByLabel('stateAtom');
    if (!stateAtom) return null;
    const store = getCachedStore();
    if (!store) return null;
    return (store.get(stateAtom) as QuinoaStateSnapshot | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to raw JSON Patch operations flowing from the game engine.
 * Callback fires once per state event with the patches plus the fresh
 * snapshot. Empty patch array signals "no patch data available for this
 * event" (fallback stateAtom source, welcome message, or dev-tools reload).
 *
 * Selector-memoized `subscribe()` remains the right API for feature code;
 * patch subscribers are for infrastructure (reactive manager) that routes by
 * path prefix.
 *
 * Returns an unsubscribe function. Safe before init — patches simply don't
 * flow until the source attaches.
 */
export function subscribeToPatches(
  cb: (patches: readonly PatchOp[], newState: QuinoaStateSnapshot) => void,
): () => void {
  patchListeners.add(cb);
  return () => { patchListeners.delete(cb); };
}

/**
 * Subscribe to a derived slice of state. Callback fires:
 *   - Once with the initial value when the state tree is ready
 *   - Again only when the selector's return value is deep-not-equal to the last
 *
 * If called before `initStateTree()` resolves, the subscription is queued
 * (QPM-STATETREE-003 info) and activated when init completes.
 *
 * Returns an unsubscribe function; safe to call multiple times.
 *
 * `label` is optional and used only for diagnostics — helps identify which
 * subscriber's selector threw when reading the error buffer.
 *
 * `statePath` (optional) is a JSON Pointer prefix into the stateAtom.value
 * tree. When set, the selector + deep-equal only run on events whose patches
 * touch that prefix (or on patch-less events — welcome / stateAtom fallback —
 * which still fan out to everyone). `{myIdx}` is substituted at flush time
 * with the local player's slot index. Omit for subscribers that need to see
 * every state event.
 */
export function subscribe<T>(
  selector: Selector<T>,
  callback: (value: T | null) => void,
  label?: string,
  statePath?: PatchPath,
): () => void {
  const id = nextSubscriberId++;

  if (!ready) {
    // Subscribe-before-init is expected during early phase. The pending count
    // is surfaced in health metrics so operators can spot init-order issues
    // without paying per-subscription log noise.
    pending.push({
      id,
      selector: selector as Selector<unknown>,
      callback: callback as (value: unknown) => void,
      label,
      statePath,
    });
    return () => {
      // If still pending, remove from queue; else remove from active map.
      const pIdx = pending.findIndex((p) => p.id === id);
      if (pIdx >= 0) pending.splice(pIdx, 1);
      subscribers.delete(id);
    };
  }

  const sub: Subscriber = {
    id,
    selector: selector as Selector<unknown>,
    lastValue: undefined,
    hasFired: false,
    callback: callback as (value: unknown) => void,
    label,
    statePath,
  };
  subscribers.set(id, sub);

  // Immediate fire with current snapshot.
  if (currentSnapshot) {
    try {
      const initial = sub.selector(currentSnapshot);
      sub.lastValue = initial;
      sub.hasFired = true;
      try { sub.callback(initial); } catch { /* subscriber threw — swallow */ }
    } catch (err) {
      diagLog.warn('QPM-STATETREE-002', { subscriber: sub.label ?? sub.id, phase: 'initial' }, err);
    }
  }

  return () => {
    subscribers.delete(id);
  };
}

// ─── Debug bridge (console-inspectable) ───────────────────────────────────

function subscriberSummary(): Array<{ id: number; label: string | undefined; hasFired: boolean }> {
  return [...subscribers.values()].map((s) => ({
    id: s.id,
    label: s.label,
    hasFired: s.hasFired,
  }));
}

function exposeDebugBridge(): void {
  shareGlobal('__QPM_STATETREE__', {
    ready: () => ready,
    source: () => activeSource,
    snapshot: () => currentSnapshot,
    subs: () => subscriberSummary(),
    pendingCount: () => pending.length,
  });
}
