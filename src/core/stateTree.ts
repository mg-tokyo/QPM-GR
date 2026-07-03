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
let activeSource: 'roomPatches' | 'stateAtom' | 'none' = 'none';

interface Subscriber {
  readonly id: number;
  readonly selector: Selector<unknown>;
  lastValue: unknown;
  hasFired: boolean;
  readonly callback: (value: unknown) => void;
  readonly label: string | undefined;
}

let nextSubscriberId = 1;
const subscribers = new Map<number, Subscriber>();

// Subscribers registered before init resolves; drained on ready.
interface PendingSubscription {
  readonly id: number;
  readonly selector: Selector<unknown>;
  readonly callback: (value: unknown) => void;
  readonly label: string | undefined;
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

function onStateEvent(next: unknown): void {
  currentSnapshot = (next as QuinoaStateSnapshot | null) ?? null;
  lastFireTs = Date.now();
  if (!currentSnapshot) return;

  for (const sub of subscribers.values()) {
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
}

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

    const seedState = rc.lastRoomStateJsonable;
    if (seedState) onStateEvent(seedState);

    const maybeUnsub = rc.subscribeToPatches((_patches, fullState) => {
      onStateEvent(fullState);
    });
    if (typeof maybeUnsub === 'function') {
      sourceUnsubscribe = maybeUnsub;
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
  sourceUnsubscribe = await subscribeAtom(stateAtom, onStateEvent);
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
  sourceUnsubscribe = null;
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
 */
export function subscribe<T>(
  selector: Selector<T>,
  callback: (value: T | null) => void,
  label?: string,
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
