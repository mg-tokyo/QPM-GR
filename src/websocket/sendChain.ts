// src/websocket/sendChain.ts
// Shared capture/restore/brand helpers for the four send-chain wrap sites
// (commandSequencer, locker guard, nativeSendObserver, battleship sendGuard).
// Pure module — must never import from the sequencer or any wrap site.

export type SendFn = (payload: unknown) => unknown;

export type QpmWrapperLabel =
  | 'commandSequencer'
  | 'lockerGuard'
  | 'nativeSendObserver'
  | 'battleshipSendGuard';

const QPM_WRAPPER_LABELS: ReadonlySet<string> = new Set<QpmWrapperLabel>([
  'commandSequencer',
  'lockerGuard',
  'nativeSendObserver',
  'battleshipSendGuard',
]);

export interface CapturedSlot {
  // Exact own-property value at capture time; null when the slot was inherited
  // from the prototype. Restoring the identical object (not a bound copy)
  // keeps brands and outer layers' identity guards working.
  raw: SendFn | null;
  bound: SendFn;
  wasOwn: boolean;
}

export function captureSendSlot(obj: object, key: string): CapturedSlot | null {
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value !== 'function') return null;
  const wasOwn = Object.prototype.hasOwnProperty.call(obj, key);
  const fn = value as SendFn;
  return { raw: wasOwn ? fn : null, bound: fn.bind(obj), wasOwn };
}

/**
 * Identity-guarded restore: only touches the slot while `installedRef` is
 * still the installed value. A slot that was inherited at capture time is
 * restored by deleting the own property so the prototype method shows
 * through again (a bound copy would read as a foreign wrapper forever).
 */
export function restoreSendSlot(obj: object, key: string, slot: CapturedSlot, installedRef: unknown): boolean {
  const rec = obj as Record<string, unknown>;
  if (rec[key] !== installedRef) return false;
  if (slot.wasOwn && slot.raw) {
    rec[key] = slot.raw;
  } else {
    Reflect.deleteProperty(rec, key);
  }
  return true;
}

/** Same convention as src/rive-engine/loadWrapper.ts wrap branding. */
export function brandWrapper<T extends object>(fn: T, label: QpmWrapperLabel): T {
  const rec = fn as unknown as Record<string, unknown>;
  rec.__qpmWrapped = true;
  rec.__qpmLabel = label;
  return fn;
}

export function isQpmBranded(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  const rec = fn as unknown as Record<string, unknown>;
  return rec.__qpmWrapped === true
    && typeof rec.__qpmLabel === 'string'
    && QPM_WRAPPER_LABELS.has(rec.__qpmLabel);
}

export type SendSlotClass = 'clean' | 'qpm' | 'foreign';

/**
 * clean:   not an own property, or own value === prototype method
 * qpm:     own-property function carrying a valid QPM brand
 * foreign: any other own-property function (unknown labels stay foreign —
 *          a third-party wrapper must never be treated as QPM's)
 */
export function classifySendSlot(obj: object, key: string): SendSlotClass {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return 'clean';
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value !== 'function') return 'clean';
  const proto = Object.getPrototypeOf(obj) as Record<string, unknown> | null;
  if (proto && value === proto[key]) return 'clean';
  return isQpmBranded(value) ? 'qpm' : 'foreign';
}

export interface ForeignEpisodeGate {
  /** True while a foreign-wrapper episode is in progress. */
  active(): boolean;
  /** Count one refused check; warn=true exactly once per episode, at the threshold. */
  refused(): { warn: boolean; checks: number };
  /** End the episode (check passed). Null when none was in progress. */
  cleared(): { warned: boolean; checks: number; durationMs: number } | null;
  reset(): void;
}

/**
 * Once-per-episode warn gating: all three wrap sites funnel into the same
 * attach check and, since the chain became event-driven, they run in ONE
 * microtask — so the count alone no longer proves the episode is sustained.
 * `minSustainedMs` adds the wall-clock floor the 2 s polls used to provide.
 */
export function createForeignEpisodeGate(warnAfterChecks: number, minSustainedMs = 0): ForeignEpisodeGate {
  let streak = 0;
  let warned = false;
  let startedAt = 0;
  const reset = (): void => { streak = 0; warned = false; startedAt = 0; };
  return {
    active: () => streak > 0,
    refused() {
      streak++;
      if (streak === 1) startedAt = Date.now();
      const warn = !warned && streak >= warnAfterChecks && Date.now() - startedAt >= minSustainedMs;
      if (warn) warned = true;
      return { warn, checks: streak };
    },
    cleared() {
      if (streak === 0) return null;
      const out = { warned, checks: streak, durationMs: Date.now() - startedAt };
      reset();
      return out;
    },
    reset,
  };
}
