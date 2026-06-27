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

let capturedRive: LowLevelRive | null = null;
let capturePromise: Promise<LowLevelRive> | null = null;
let atomUnsub: (() => void) | null = null;

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

  // Loadable shape: { state: 'hasData', data: LowLevelRive }
  // (audit fix #8: explicit state check)
  if (val.state === 'hasData' && isRiveRuntime(val.data)) {
    return val.data as LowLevelRive;
  }

  // Skip non-resolved loadable states (loading/hasError)
  if (val.state === 'loading' || val.state === 'hasError') return null;

  // Direct runtime (edge case: non-loadable wrapper)
  if (isRiveRuntime(val)) return val as LowLevelRive;

  // Wrapped data without loadable state marker
  if (isRiveRuntime(val.data)) return val.data as LowLevelRive;

  return null;
}

// ---------------------------------------------------------------------------
// Capture strategies
// ---------------------------------------------------------------------------

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

// Strategy 2: structure-based scan (audit fix #1: primary strategy)
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
// Subscription-based capture
// ---------------------------------------------------------------------------

// Replaces value-polling. The previous polling approach raced the game's
// QuinoaEngine preload of petz/currency/thoughtbubble/loader_tm/decor —
// those call `getRiveRuntime().load(bytes)` in the same microtask as
// lowLevelRiveAtom resolution, and our 250 ms cold tick lost the race.
// `subscribeAtom` fires synchronously when the atom updates (Jotai
// `store.sub`) and also invokes the callback once with the current value,
// so an already-resolved atom is captured on the same microtask cycle as
// the subscription is installed.
async function awaitRuntimeViaSubscription(timeoutMs: number): Promise<LowLevelRive> {
  return new Promise<LowLevelRive>((resolve, reject) => {
    let done = false;
    let existPoll: ReturnType<typeof setInterval> | null = null;
    let subscribing = false;

    const cleanup = () => {
      if (existPoll !== null) {
        clearInterval(existPoll);
        existPoll = null;
      }
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('[RiveEngine] Timed out waiting for Rive runtime'));
    }, timeoutMs);

    const onValue = (label: string, value: unknown) => {
      if (done) return;
      const rive = extractRiveFromAtomValue(value);
      if (!rive) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      capturedRive = rive;
      wrapRiveLoad(rive, 'lowLevelRiveAtom');
      riveLog(`Runtime captured via atom subscription "${label}"`);
      resolve(rive);
    };

    const trySubscribeOnce = async (): Promise<boolean> => {
      if (done || atomUnsub || subscribing) return atomUnsub !== null;
      subscribing = true;
      try {
        for (const label of ATOM_LABELS) {
          const atom = getAtomByLabel(label);
          if (!atom) continue;
          try {
            const unsub = await subscribeAtom(atom, (value: unknown) =>
              onValue(label, value),
            );
            // If the initial invoke inside subscribeAtom already captured
            // the runtime synchronously, the sub is no longer needed.
            if (done) {
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

    // First attempt — likely the atom is registered but unresolved.
    void trySubscribeOnce().then((subscribed) => {
      if (done || subscribed) return;
      // Atom module not yet loaded. Poll for atom REGISTRATION (cheap —
      // it's a Map lookup, not a value read) until one of the known
      // labels resolves to an atom we can subscribe to. This is not the
      // old value-polling: once subscribed, we stop polling and wait
      // for the sub callback.
      existPoll = setInterval(() => {
        if (done || atomUnsub) return;
        void trySubscribeOnce();
      }, 100);
    });
  });
}

/**
 * Synchronously try to capture the rive runtime. Used by external triggers
 * (e.g. the canvas-runtime trap firing) to short-circuit the poll loop.
 * Returns true if capture succeeded for the first time on this call.
 */
export function pokeCaptureAttempt(): boolean {
  if (capturedRive) return false;
  const rive = tryCapture();
  if (!rive) return false;
  capturedRive = rive;
  wrapRiveLoad(rive, 'lowLevelRiveAtom');
  riveLog('Runtime captured via external poke');
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function captureRiveRuntime(): Promise<LowLevelRive> {
  if (capturedRive) return capturedRive;
  if (capturePromise) return capturePromise;

  capturePromise = (async () => {
    // Fast path: atom already resolved AND store cached at call time.
    // Skips the sub round-trip when QPM was loaded after the game.
    const quick = tryCapture();
    if (quick) {
      capturedRive = quick;
      wrapRiveLoad(quick, 'lowLevelRiveAtom');
      return quick;
    }

    return await awaitRuntimeViaSubscription(30_000);
  })();

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
  if (atomUnsub) {
    try { atomUnsub(); } catch { /* noop */ }
    atomUnsub = null;
  }
  unwrapRiveLoad();
  capturedRive = null;
  capturePromise = null;
}

/**
 * Diagnostic: scan ALL atoms for objects that look like a Rive low-level
 * runtime. If more than one shows up we have the wrong-singleton problem —
 * we may have hooked a runtime the game doesn't use for pets.
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
