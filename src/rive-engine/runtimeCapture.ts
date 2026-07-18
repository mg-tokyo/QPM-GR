// src/rive-engine/runtimeCapture.ts

import {
  getAtomByLabel,
  getAllAtomEntries,
  getCachedStore,
  subscribeAtom,
} from '../core/jotaiBridge';
import type { LowLevelRive } from './types';
import { riveLog } from './helpers';
import { wrapRiveLoad, unwrapRiveLoad } from './loadWrapper';

// Single-write module state. capturedRive is the first runtime any capture
// path handed us; multi-runtime tracking lives in loadWrapper's wrappedRuntimes
// map. Legacy singleton API here stays intact for existing callers.
let capturedRive: LowLevelRive | null = null;
let capturePromise: Promise<LowLevelRive> | null = null;
let atomUnsub: (() => void) | null = null;

// Hoisted resolvers so ANY capture path (atom sub or the canvas-runtime trap
// via provideRuntimeFromCapture) can complete the same pending promise.
// Historical bug: awaitRuntimeViaSubscription owned its own resolvers inside
// a closure, so the trap couldn't unblock it — pokeCaptureAttempt just
// re-ran an atom scan that was already dead in production.
let pendingResolve: ((r: LowLevelRive) => void) | null = null;
let pendingReject: ((e: Error) => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let subscribePoll: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Structural detection
// ---------------------------------------------------------------------------

function isRiveRuntime(value: unknown): value is LowLevelRive {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.decodeImage === 'function' && typeof v.load === 'function';
}

function extractRiveFromAtomValue(atomValue: unknown): LowLevelRive | null {
  if (!atomValue || typeof atomValue !== 'object') return null;
  const val = atomValue as Record<string, unknown>;

  if (val.state === 'hasData' && isRiveRuntime(val.data)) {
    return val.data as LowLevelRive;
  }
  if (val.state === 'loading' || val.state === 'hasError') return null;
  if (isRiveRuntime(val)) return val as LowLevelRive;
  if (isRiveRuntime(val.data)) return val.data as LowLevelRive;

  return null;
}

// ---------------------------------------------------------------------------
// Capture strategies
// ---------------------------------------------------------------------------

// Kept for the retro-compat path. Empty in production as of 2026-07 — the
// game removed lowLevelRiveAtom from jotaiAtomCache. The canvas-runtime trap
// is now the primary capture source. If a future version re-exposes the
// atom, extend this list and the fast path picks it up again.
const ATOM_LABELS = ['lowLevelRiveAtom', 'riveAtom', 'lowLevelRive'];

function tryLabelCapture(): LowLevelRive | null {
  for (const label of ATOM_LABELS) {
    const atom = getAtomByLabel(label);
    if (!atom) continue;
    const store = getCachedStore();
    if (!store) continue;
    try {
      const value = store.get(atom);
      const rive = extractRiveFromAtomValue(value);
      if (rive) {
        riveLog(`Runtime captured via atom label "${label}"`);
        return rive;
      }
    } catch {
      // Atom exists but can't be read yet
    }
  }
  return null;
}

function tryStructureScan(): LowLevelRive | null {
  const store = getCachedStore();
  if (!store) return null;

  const entries = getAllAtomEntries();
  for (const { atom } of entries) {
    try {
      const value = store.get(atom);
      const rive = extractRiveFromAtomValue(value);
      if (rive) {
        riveLog('Runtime captured via structure scan');
        return rive;
      }
    } catch {
      // Some atoms may throw on read
    }
  }
  return null;
}

function tryCapture(): LowLevelRive | null {
  const byLabel = tryLabelCapture();
  if (byLabel) return byLabel;
  return tryStructureScan();
}

// ---------------------------------------------------------------------------
// Single write point for successful capture
// ---------------------------------------------------------------------------

function clearPendingWaiter(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (subscribePoll !== null) {
    clearInterval(subscribePoll);
    subscribePoll = null;
  }
  if (atomUnsub) {
    try { atomUnsub(); } catch { /* noop */ }
    atomUnsub = null;
  }
  pendingResolve = null;
  pendingReject = null;
}

/**
 * Idempotent handoff for any capture path (canvas-runtime trap, atom sub,
 * atom fast path). First caller wins; subsequent calls with the same or a
 * different runtime are no-ops on capturedRive but still ensure wrapRiveLoad
 * runs for each distinct runtime (wrapRiveLoad is itself idempotent per-runtime).
 *
 * Contract: this MUST be the only place that writes capturedRive or resolves
 * the pending promise. Split-brain writes caused the historical bug where the
 * trap wrapped a runtime but capturedRive stayed null.
 */
export function provideRuntimeFromCapture(rive: LowLevelRive, label: string): void {
  // Always wrap load — multi-runtime aware; safe to call for a runtime we
  // already wrapped.
  wrapRiveLoad(rive, label);

  if (capturedRive) return;
  capturedRive = rive;
  riveLog(`Runtime captured via "${label}"`);

  const resolve = pendingResolve;
  clearPendingWaiter();
  resolve?.(rive);
}

// ---------------------------------------------------------------------------
// Atom subscription (fallback path)
// ---------------------------------------------------------------------------

// Kept for the case where the game re-exposes lowLevelRiveAtom. Success here
// flows through provideRuntimeFromCapture so the write path is unified.
function armAtomSubscription(): void {
  if (atomUnsub) return;
  let subscribing = false;

  const onValue = (label: string, value: unknown) => {
    const rive = extractRiveFromAtomValue(value);
    if (!rive) return;
    provideRuntimeFromCapture(rive, `atom:${label}`);
  };

  const trySubscribeOnce = async (): Promise<boolean> => {
    if (atomUnsub || subscribing || capturedRive) return atomUnsub !== null;
    subscribing = true;
    try {
      for (const label of ATOM_LABELS) {
        const atom = getAtomByLabel(label);
        if (!atom) continue;
        try {
          const unsub = await subscribeAtom(atom, (value: unknown) =>
            onValue(label, value),
          );
          if (capturedRive) {
            try { unsub(); } catch { /* noop */ }
            return true;
          }
          atomUnsub = unsub;
          return true;
        } catch (e) {
          riveLog(`subscribeAtom failed for "${label}":`, e);
        }
      }
      return false;
    } finally {
      subscribing = false;
    }
  };

  void trySubscribeOnce().then((subscribed) => {
    if (capturedRive || subscribed) return;
    // Atom module not yet loaded. Cheap Map-lookup poll for atom REGISTRATION
    // (not value polling) until one of the labels resolves.
    subscribePoll = setInterval(() => {
      if (capturedRive || atomUnsub) return;
      void trySubscribeOnce();
    }, 100);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function captureRiveRuntime(): Promise<LowLevelRive> {
  if (capturedRive) return capturedRive;
  if (capturePromise) return capturePromise;

  capturePromise = new Promise<LowLevelRive>((resolve, reject) => {
    // Fast path — atom fully resolved AND store cached at call time. Covers
    // retro-compat if the atom ever comes back.
    const quick = tryCapture();
    if (quick) {
      provideRuntimeFromCapture(quick, 'atom:fast-path');
      resolve(quick);
      return;
    }

    pendingResolve = resolve;
    pendingReject = reject;

    // The canvas-runtime trap is the primary source in production — it calls
    // provideRuntimeFromCapture the instant a RiveFile constructor fires,
    // which resolves this promise via pendingResolve. Below we install the
    // atom sub as a defensive fallback for future game versions that re-
    // expose the atom.
    armAtomSubscription();

    pendingTimer = setTimeout(() => {
      if (capturedRive) return;
      const reject = pendingReject;
      clearPendingWaiter();
      reject?.(new Error('[RiveEngine] Timed out waiting for Rive runtime'));
    }, 30_000);
  });

  try {
    return await capturePromise;
  } finally {
    capturePromise = null;
  }
}

export function getRiveSingleton(): LowLevelRive | null {
  return capturedRive;
}

export function awaitRiveSingleton(): Promise<LowLevelRive> {
  if (capturedRive) return Promise.resolve(capturedRive);
  return captureRiveRuntime();
}

export function releaseRiveCapture(): void {
  clearPendingWaiter();
  unwrapRiveLoad();
  capturedRive = null;
  capturePromise = null;
}

/**
 * Diagnostic: scan ALL atoms for objects that look like a Rive low-level
 * runtime. Empty in production since the game removed lowLevelRiveAtom.
 * Still useful for detecting a future re-exposure of the atom.
 */
export function findAllRiveRuntimes(): Array<{ atomLabel: string; matches: LowLevelRive }> {
  const store = getCachedStore();
  if (!store) return [];
  const out: Array<{ atomLabel: string; matches: LowLevelRive }> = [];
  const seen = new Set<unknown>();
  for (const { atom, label } of getAllAtomEntries()) {
    try {
      const value = store.get(atom);
      const rive = extractRiveFromAtomValue(value);
      if (rive && !seen.has(rive)) {
        seen.add(rive);
        out.push({ atomLabel: label ?? '<unlabeled>', matches: rive });
      }
    } catch {
      // ignore
    }
  }
  return out;
}
