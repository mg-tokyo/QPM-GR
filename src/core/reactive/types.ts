// src/core/reactive/types.ts
// Public types for the reactive subscription manager. See the design at
// .claude/plans/2026-07-07-reactive-systems-design.md.

/**
 * Which reactivity trigger a subscription responds to.
 *
 * - 'state'     — patch-stream events (state-derived atoms; game data)
 * - 'client'    — DOM input events (bare client-local atoms; user-driven)
 * - 'composite' — both triggers (e.g. actionAtom: state + input dependent)
 * - 'dynamic'   — slow safety poll only (unknown or runtime-discovered atoms)
 */
export type SubscriberTier = 'state' | 'client' | 'composite' | 'dynamic';

/** JSON Pointer (RFC 6901) path string, e.g. '/child/data/shops'. */
export type PatchPath = string;

/**
 * Options accepted by ReactiveSubscriptionManager.subscribe(). Callbacks fire
 * when the subscribed atom's value has changed (via reference equality). Path
 * hints let the manager dedup by patch path instead of reading every entry on
 * every state event.
 */
export interface ReactiveSubscribeOptions {
  /** Callback invoked when the subscribed atom's value has changed. */
  readonly cb: () => void;
  /** Reads the current value from the store/cache. Same shape as BatchedSubscriptionManager. */
  readonly getValue: () => unknown;
  /** Tier hint. Omit → classified via atom label; unknown → 'dynamic'. */
  readonly tier?: SubscriberTier;
  /**
   * For 'state' or 'composite' tier: JSON Pointer prefix inside stateAtom.value
   * under which the atom's data lives. Only patches whose `path` starts with
   * this prefix cause re-evaluation. `{myIdx}` is a runtime placeholder
   * substituted at flush time with the local player's slot index.
   */
  readonly statePath?: PatchPath;
  /** Optional debug label so console diagnostics identify the caller. */
  readonly debugLabel?: string;
}

/** Stats surface exposed via `__QPM_INTERNAL__.getReactiveStats()`. */
export interface ReactiveStats {
  stateSubscribers: number;
  clientSubscribers: number;
  compositeSubscribers: number;
  dynamicSubscribers: number;
  stateEventsPerSec: number;
  inputEventsPerSec: number;
  callbackFiresPerSec: number;
  lastFlushMs: number;
  totalFlushBudgetMsPerSec: number;
}
