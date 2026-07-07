// src/core/reactive/manager.ts
// Push-based subscription manager. Replaces BatchedSubscriptionManager
// gradually — see .claude/plans/2026-07-07-reactive-systems-implementation.md.
//
// State tier: subscribeToPatches on stateTree. Each incoming batch is a set
// of JSON Patch ops (verified against fast-json-patch shape in beta source).
// Subscribers register a JSON Pointer prefix; only patches whose path
// startsWith that prefix mark the subscriber dirty.
// Client tier: pointerdown/keydown/throttled pointermove listeners on document.
// Dynamic tier: 5s safety poll for unclassified atoms.

import { storage } from '../../utils/storage';
import { getPlayerIdSync } from '../playerContext';
import { subscribeToPatches } from '../stateTree';
import type { PatchOp } from '../stateTree';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';
import { matchesPathPrefix } from './pathMatcher';
import { classifyByLabel } from './tierClassifier';
import type {
  PatchPath,
  ReactiveStats,
  ReactiveSubscribeOptions,
  SubscriberTier,
} from './types';

// ── Types ─────────────────────────────────────────────────────────────────

interface Entry {
  readonly atom: unknown;
  readonly callbacks: Set<() => void>;
  readonly getValue: () => unknown;
  readonly tier: SubscriberTier;
  readonly statePath: PatchPath | undefined;
  readonly debugLabel: string | undefined;
  lastValue: unknown;
  dirty: boolean;
}

const KILL_SWITCH_KEYS: Readonly<Record<SubscriberTier, string>> = {
  state:     'qpm.perf.reactive.stateEnabled',
  client:    'qpm.perf.reactive.clientEnabled',
  composite: 'qpm.perf.reactive.compositeEnabled',
  dynamic:   'qpm.perf.reactive.dynamicEnabled',
};

const POINTERMOVE_THROTTLE_MS = 150;
const DYNAMIC_SAFETY_POLL_MS = 5_000;

// ── Manager ───────────────────────────────────────────────────────────────

export class ReactiveSubscriptionManager {
  private readonly entries = new Map<unknown, Entry>();
  private stateEventUnsub: (() => void) | null = null;
  private pointerdownListener: ((e: Event) => void) | null = null;
  private keydownListener:     ((e: Event) => void) | null = null;
  private pointermoveListener: ((e: Event) => void) | null = null;
  private lastPointermoveTs = 0;
  private dynamicPollTimer: ReturnType<typeof setInterval> | null = null;
  private flushScheduled = false;
  private nextFlushTriggers: Set<'state' | 'input' | 'safety'> = new Set();

  // Stats
  private stateEventCount = 0;
  private inputEventCount = 0;
  private callbackFireCount = 0;
  private lastFlushMs = 0;
  private flushBudgetSum = 0;
  private lastStatsSampleTs = 0;

  init(): void {
    if (this.stateEventUnsub) return; // idempotent
    // Direct patch subscription — carries the JSON Patch ops we need to
    // route subscribers by path prefix. Avoids the deep-equals-on-every-event
    // overhead of stateTree.subscribe with a passthrough selector.
    this.stateEventUnsub = subscribeToPatches((patches, newState) => {
      this.onStateEvent(newState, patches);
    });
    this.lastStatsSampleTs = performance.now();
  }

  stop(): void {
    try { this.stateEventUnsub?.(); } catch { /* ignore */ }
    this.stateEventUnsub = null;
    this.detachInputListeners();
    this.stopDynamicPoll();
    this.entries.clear();
    this.flushScheduled = false;
    this.nextFlushTriggers.clear();
  }

  subscribe(atom: unknown, opts: ReactiveSubscribeOptions): () => void {
    const tier: SubscriberTier = opts.tier ?? classifyByLabel(atomLabel(atom));

    let entry = this.entries.get(atom);
    if (!entry) {
      entry = {
        atom,
        callbacks: new Set<() => void>(),
        getValue: opts.getValue,
        tier,
        statePath: opts.statePath,
        debugLabel: opts.debugLabel ?? atomLabel(atom),
        lastValue: safeGetValue(opts.getValue),
        dirty: false,
      };
      this.entries.set(atom, entry);
    }
    entry.callbacks.add(opts.cb);

    if (tier === 'client' || tier === 'composite') this.attachInputListenersIfNeeded();
    if (tier === 'dynamic') this.startDynamicPollIfNeeded();

    return () => {
      const e = this.entries.get(atom);
      if (!e) return;
      e.callbacks.delete(opts.cb);
      if (e.callbacks.size === 0) {
        this.entries.delete(atom);
        this.cleanupIfEmpty();
      }
    };
  }

  getStats(): ReactiveStats {
    const now = performance.now();
    const dtSec = Math.max(0.001, (now - this.lastStatsSampleTs) / 1000);
    let stateSubs = 0, clientSubs = 0, compositeSubs = 0, dynamicSubs = 0;
    for (const e of this.entries.values()) {
      switch (e.tier) {
        case 'state':     stateSubs++;     break;
        case 'client':    clientSubs++;    break;
        case 'composite': compositeSubs++; break;
        case 'dynamic':   dynamicSubs++;   break;
      }
    }
    const stats: ReactiveStats = {
      stateSubscribers:         stateSubs,
      clientSubscribers:        clientSubs,
      compositeSubscribers:     compositeSubs,
      dynamicSubscribers:       dynamicSubs,
      stateEventsPerSec:        Math.round(this.stateEventCount / dtSec),
      inputEventsPerSec:        Math.round(this.inputEventCount / dtSec),
      callbackFiresPerSec:      Math.round(this.callbackFireCount / dtSec),
      lastFlushMs:              Math.round(this.lastFlushMs * 100) / 100,
      totalFlushBudgetMsPerSec: Math.round(this.flushBudgetSum / dtSec * 10) / 10,
    };
    this.stateEventCount = 0;
    this.inputEventCount = 0;
    this.callbackFireCount = 0;
    this.flushBudgetSum = 0;
    this.lastStatsSampleTs = now;
    return stats;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private onStateEvent(state: QuinoaStateSnapshot, patches: readonly PatchOp[]): void {
    this.stateEventCount++;

    // Empty patch array = no patch data (fallback stateAtom source, welcome
    // message, or dev-tools reload). Coarse-mark every state/composite entry
    // — safe worst case, guaranteed convergent.
    if (patches.length === 0) {
      for (const e of this.entries.values()) {
        if (e.tier === 'state' || e.tier === 'composite') e.dirty = true;
      }
      this.scheduleFlush('state');
      return;
    }

    // Path-based routing: resolve myIdx once per event, then match each patch
    // against subscription prefixes. Entries without a statePath fire on
    // every state event (conservative fallback).
    const myIdx = this.resolveMyIdx(state);
    for (const patch of patches) {
      for (const e of this.entries.values()) {
        if (e.tier !== 'state' && e.tier !== 'composite') continue;
        if (e.dirty) continue; // already marked this flush
        if (e.statePath === undefined) { e.dirty = true; continue; }
        if (matchesPathPrefix(patch.path, e.statePath, myIdx)) e.dirty = true;
      }
    }
    this.scheduleFlush('state');
  }

  private resolveMyIdx(state: QuinoaStateSnapshot): number | null {
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

  private onInputEvent(source: 'pointerdown' | 'keydown' | 'pointermove'): void {
    if (source === 'pointermove') {
      const now = performance.now();
      if (now - this.lastPointermoveTs < POINTERMOVE_THROTTLE_MS) return;
      this.lastPointermoveTs = now;
    }
    this.inputEventCount++;
    for (const e of this.entries.values()) {
      if (e.tier === 'client' || e.tier === 'composite') e.dirty = true;
    }
    this.scheduleFlush('input');
  }

  private onDynamicPoll(): void {
    for (const e of this.entries.values()) {
      if (e.tier === 'dynamic') e.dirty = true;
    }
    this.scheduleFlush('safety');
  }

  private scheduleFlush(trigger: 'state' | 'input' | 'safety'): void {
    this.nextFlushTriggers.add(trigger);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const triggers = this.nextFlushTriggers;
    this.nextFlushTriggers = new Set();
    const start = performance.now();

    // One kill-switch read per tier per flush — cheaper than per-entry.
    const stateEnabled     = isTierEnabled('state');
    const clientEnabled    = isTierEnabled('client');
    const compositeEnabled = isTierEnabled('composite');
    const dynamicEnabled   = isTierEnabled('dynamic');
    void triggers; // reserved for future path-filtering diagnostics

    for (const e of this.entries.values()) {
      if (!e.dirty) continue;
      e.dirty = false;
      const gate = e.tier === 'state'     ? stateEnabled
                 : e.tier === 'client'    ? clientEnabled
                 : e.tier === 'composite' ? compositeEnabled
                 :                          dynamicEnabled;
      if (!gate) continue;
      const current = safeGetValue(e.getValue);
      if (current === e.lastValue) continue;
      e.lastValue = current;
      for (const cb of e.callbacks) {
        try { cb(); } catch { /* subscriber error — swallow */ }
      }
      this.callbackFireCount += e.callbacks.size;
    }

    const dur = performance.now() - start;
    this.lastFlushMs = dur;
    this.flushBudgetSum += dur;
  }

  private attachInputListenersIfNeeded(): void {
    if (this.pointerdownListener) return;
    if (typeof document === 'undefined') return;
    this.pointerdownListener = () => this.onInputEvent('pointerdown');
    this.keydownListener     = () => this.onInputEvent('keydown');
    this.pointermoveListener = () => this.onInputEvent('pointermove');
    document.addEventListener('pointerdown', this.pointerdownListener, { passive: true, capture: true });
    document.addEventListener('keydown',     this.keydownListener,     { passive: true, capture: true });
    document.addEventListener('pointermove', this.pointermoveListener, { passive: true, capture: true });
  }

  private detachInputListeners(): void {
    if (!this.pointerdownListener) return;
    document.removeEventListener('pointerdown', this.pointerdownListener, { capture: true });
    if (this.keydownListener) {
      document.removeEventListener('keydown', this.keydownListener, { capture: true });
    }
    if (this.pointermoveListener) {
      document.removeEventListener('pointermove', this.pointermoveListener, { capture: true });
    }
    this.pointerdownListener = null;
    this.keydownListener = null;
    this.pointermoveListener = null;
  }

  private startDynamicPollIfNeeded(): void {
    if (this.dynamicPollTimer !== null) return;
    this.dynamicPollTimer = setInterval(() => this.onDynamicPoll(), DYNAMIC_SAFETY_POLL_MS);
  }

  private stopDynamicPoll(): void {
    if (this.dynamicPollTimer === null) return;
    clearInterval(this.dynamicPollTimer);
    this.dynamicPollTimer = null;
  }

  private cleanupIfEmpty(): void {
    let hasClientOrComposite = false;
    let hasDynamic = false;
    for (const e of this.entries.values()) {
      if (e.tier === 'client' || e.tier === 'composite') hasClientOrComposite = true;
      if (e.tier === 'dynamic') hasDynamic = true;
    }
    if (!hasClientOrComposite) this.detachInputListeners();
    if (!hasDynamic) this.stopDynamicPoll();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function safeGetValue(getValue: () => unknown): unknown {
  try { return getValue(); } catch { return undefined; }
}

function atomLabel(atom: unknown): string | undefined {
  if (!atom || typeof atom !== 'object') return undefined;
  const obj = atom as Record<string, unknown>;
  const label = obj.debugLabel ?? obj.label;
  return typeof label === 'string' ? label : undefined;
}

function isTierEnabled(tier: SubscriberTier): boolean {
  // Default true: fresh installs get reactive routing automatically. Users
  // who explicitly set a kill switch to `false` via storage keep their choice
  // because `storage.get` returns the stored value when present and the
  // default only when the key is missing entirely. Only fall back to `false`
  // on an actual read error (throws on GM_getValue, corrupted JSON, etc.) —
  // a safe fallback that reverts to BSM polling if storage is unreachable.
  try {
    return storage.get<boolean>(KILL_SWITCH_KEYS[tier], true);
  } catch {
    return false;
  }
}

// ── Singleton + convenience ───────────────────────────────────────────────

export const reactiveManager = new ReactiveSubscriptionManager();

export function initReactiveManager(): void { reactiveManager.init(); }
export function stopReactiveManager(): void { reactiveManager.stop(); }
export function getReactiveStats(): ReactiveStats { return reactiveManager.getStats(); }
export function isReactiveTierEnabled(tier: SubscriberTier): boolean { return isTierEnabled(tier); }
