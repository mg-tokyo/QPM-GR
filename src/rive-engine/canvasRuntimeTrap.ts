// src/rive-engine/canvasRuntimeTrap.ts
//
// Capture the @rive-app/canvas runtime via an Object.prototype.runtime
// setter trap. This runtime is created lazily inside the @rive-app/canvas
// (and re-exported by @rive-app/react-canvas) package via the RuntimeLoader
// singleton, and stored in a module-local closure that no reachable path
// from `window` exposes. Heap walking from `window` cannot find it.
//
// The bundled RiveFile constructor does `this.runtime = e` where e is the
// canvas-advanced rive runtime. By trapping `runtime` setter on
// Object.prototype, we observe every such assignment, filter for
// rive-shaped values, and capture the first matching one. Once captured we
// hand the runtime off to wrapRiveLoad() so its .load is intercepted just
// like the low-level runtime we get via the Jotai atom.
//
// This MUST install before the game's first RiveFile construction, which
// means before initialize()'s first await. Otherwise we miss the assignment
// and the canvas runtime stays unhooked for the session.
//
// Safety:
// - The setter only fires on regular `obj.runtime = value` assignments.
//   `Object.defineProperty(obj, 'runtime', ...)` bypasses inherited setters,
//   so direct defineProperty calls won't trigger us. (The bundle uses plain
//   `=` assignment in RiveFile's constructor — verified in source.)
// - We immediately re-define the property as a normal own data property,
//   so subsequent reads of `obj.runtime` return the assigned value as
//   normal — no proxy semantics leak.
// - We filter strictly: only values that look like a rive runtime
//   (`load` + `decodeImage` functions) and that aren't equal to the
//   already-captured low-level runtime get wrapped.
// - Auto-removes once both expected runtimes are captured (webgl2-advanced
//   from Jotai + canvas-advanced via this trap), or after a timeout.

import type { LowLevelRive } from './types';
import { riveLog } from './helpers';
import { getWrappedRuntimeCount } from './loadWrapper';

// Lazy import to avoid a circular dep at module load. runtimeCapture imports
// wrapRiveLoad from loadWrapper, this module imports wrapRiveLoad too — a
// direct sync import of runtimeCapture here would close the cycle. Runs only
// when a real RiveFile constructor fires (many ms after page load), by which
// time all modules are evaluated and the dynamic import resolves immediately
// from the bundler cache.
function provideRuntime(rive: unknown, label: string): void {
  void import('./runtimeCapture')
    .then((m) => m.provideRuntimeFromCapture?.(rive as never, label))
    .catch((e) => riveLog('provideRuntimeFromCapture failed', e));
}

// Diagnostics: count every .runtime assignment we observe so we can tell if
// the trap is even firing in cases where nothing rive-shaped came through.
let totalAssignmentCount = 0;
let matchedAssignmentCount = 0;

export function getTrapAssignmentCounts(): { total: number; matched: number; wrappedRuntimes: number } {
  return {
    total: totalAssignmentCount,
    matched: matchedAssignmentCount,
    wrappedRuntimes: getWrappedRuntimeCount(),
  };
}

// Bound for how long the trap lives. Production uses 2+ rive runtimes
// (webgl2-advanced via Jotai, canvas-advanced via this trap, possibly more
// via separate @rive-app packages). We keep the trap armed for the whole
// window rather than auto-uninstalling at a fixed count — that fixed count
// would miss late-initialised runtimes (e.g. one created on first pet-card
// open). 60s is long enough to span game module bootstrap and the first
// few user actions; short enough that long-lived pages don't keep
// Object.prototype polluted forever.
const TRAP_TIMEOUT_MS = 60_000;

let installed = false;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let trapDescriptor: PropertyDescriptor | null = null;

function isRiveRuntimeShape(value: unknown): value is LowLevelRive {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.load === 'function' && typeof v.decodeImage === 'function';
}

function defineDefault(target: object, value: unknown): void {
  try {
    Object.defineProperty(target, 'runtime', {
      value, writable: true, configurable: true, enumerable: true,
    });
  } catch {
    // Non-configurable existing own prop — rare. Fall through silently;
    // the assignment already failed at the language level by the time we
    // reach this catch in modern engines.
  }
}

function uninstallTrap(): void {
  if (!installed) return;
  try {
    delete (Object.prototype as Record<string, unknown>).runtime;
  } catch {
    // ignore
  }
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  installed = false;
  trapDescriptor = null;
  riveLog('canvas-runtime trap uninstalled');
}

/**
 * Install the Object.prototype.runtime setter trap. Must be called as early
 * as possible in the userscript bootstrap — before the game's RiveFile
 * constructor runs for the first time. The returned cleanup uninstalls the
 * trap and is safe to call multiple times.
 */
export function initCanvasRuntimeTrap(): () => void {
  if (installed) return uninstallTrap;
  installed = true;

  trapDescriptor = {
    configurable: true,
    set(this: object, value: unknown) {
      // Always restore default property semantics on the owning object first
      // so reads of `.runtime` after this assignment behave normally.
      defineDefault(this, value);

      try {
        totalAssignmentCount++;
        if (!isRiveRuntimeShape(value)) return;

        // Primary capture path. Historically we called wrapRiveLoad here and
        // separately poked the atom capture — but the game removed
        // lowLevelRiveAtom, so the poke hit a dead scan and awaitRiveSingleton
        // never resolved (QPM-RIVE-001 at 30s). Now the trap is the source of
        // truth: hand every rive-shaped runtime to provideRuntimeFromCapture,
        // which wraps load AND populates capturedRive AND resolves any
        // pending awaiter. All three writes stay in one place.
        matchedAssignmentCount++;
        const before = getWrappedRuntimeCount();
        const label = `canvas-trap-${matchedAssignmentCount}`;
        provideRuntime(value, label);
        const after = getWrappedRuntimeCount();
        if (after > before) {
          riveLog(`canvas-trap: new runtime wrapped (#${after} total)`);
        }
      } catch (e) {
        riveLog('canvas-runtime trap setter threw', e);
      }
    },
    get() {
      // Returning undefined matches the natural read of an unset .runtime
      // on a prototype object. Once a value has been assigned via the
      // setter above, defineDefault replaces this getter with an own data
      // property on the target, so subsequent reads bypass us entirely.
      return undefined;
    },
  };

  try {
    Object.defineProperty(Object.prototype, 'runtime', trapDescriptor);
  } catch (e) {
    installed = false;
    trapDescriptor = null;
    riveLog('canvas-runtime trap install failed', e);
    return () => {};
  }

  timeoutId = setTimeout(() => {
    riveLog(`canvas-runtime trap timing out after ${TRAP_TIMEOUT_MS}ms; ` +
      `${getWrappedRuntimeCount()} runtime(s) wrapped`);
    uninstallTrap();
  }, TRAP_TIMEOUT_MS);

  riveLog('canvas-runtime trap installed');
  return uninstallTrap;
}
