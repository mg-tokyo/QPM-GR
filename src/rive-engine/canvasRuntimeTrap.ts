// Capture the game's low-level Rive runtime through Object.prototype setter traps.
// The runtime lives in a module-private promise; no path from `window` reaches it,
// so we observe a plain assignment the runtime glue makes and take it from there.
// Must install before the game's Rive glue runs (before bootstrap's first await).
//
// Two traps, one per known assignment:
// - `runtime`: older builds' RiveFile constructor did `this.runtime = rive`.
// - `decodeImage`: build 1995's webgl2-advanced glue does `r.decodeImage = function…`
//   on the emscripten Module object `r` (a plain object literal), which IS the
//   runtime. Its `load` is already in place by then. Class fields (`rive;`) use
//   define semantics, so they never reach a prototype setter.
//
// Each setter first turns the value into an ordinary own data property, so reads
// behave normally and later assignments to that object bypass the trap.

import type { LowLevelRive } from './types';
import { riveLog } from './helpers';
import { getWrappedRuntimeCount } from './loadWrapper';

// Dynamic import breaks the runtimeCapture → loadWrapper ↔ trap import cycle.
function provideRuntime(rive: unknown, label: string): void {
  void import('./runtimeCapture')
    .then((m) => m.provideRuntimeFromCapture?.(rive as never, label))
    .catch((e) => riveLog('provideRuntimeFromCapture failed', e));
}

let totalAssignmentCount = 0;
let matchedAssignmentCount = 0;

export function getTrapAssignmentCounts(): { total: number; matched: number; wrappedRuntimes: number } {
  return {
    total: totalAssignmentCount,
    matched: matchedAssignmentCount,
    wrappedRuntimes: getWrappedRuntimeCount(),
  };
}

// The 1995 runtime assigns decodeImage ~0.9 s after navigation; 60 s also covers
// runtimes created lazily on first user actions without polluting Object.prototype forever.
const TRAP_TIMEOUT_MS = 60_000;

interface PrototypeTrap {
  prop: string;
  descriptor: PropertyDescriptor;
  // Another mod's own trap on the same name, restored on uninstall.
  previous: PropertyDescriptor | null;
}

let installed = false;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let traps: PrototypeTrap[] = [];

function isRiveRuntimeShape(value: unknown): value is LowLevelRive {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.load === 'function' && typeof v.decodeImage === 'function';
}

function defineOwn(target: object, prop: string, value: unknown): void {
  try {
    Object.defineProperty(target, prop, {
      value, writable: true, configurable: true, enumerable: true,
    });
  } catch {
    // Non-configurable own prop or frozen target: the assignment fails at the language level anyway.
  }
}

function offerRuntime(candidate: unknown, prefix: string): void {
  totalAssignmentCount++;
  if (!isRiveRuntimeShape(candidate)) return;
  matchedAssignmentCount++;
  const before = getWrappedRuntimeCount();
  provideRuntime(candidate, `${prefix}-${matchedAssignmentCount}`);
  if (getWrappedRuntimeCount() > before) {
    riveLog(`${prefix}: new runtime wrapped (#${getWrappedRuntimeCount()} total)`);
  }
}

function makeTrap(prop: string, onAssign: (owner: object, value: unknown) => void): PropertyDescriptor {
  return {
    configurable: true,
    set(this: object, value: unknown) {
      defineOwn(this, prop, value);
      try {
        onAssign(this, value);
      } catch (e) {
        riveLog(`${prop} trap setter threw`, e);
      }
    },
    get() {
      return undefined;
    },
  };
}

function uninstallTrap(): void {
  if (!installed) return;
  for (const trap of traps) {
    try {
      // Only touch the property if it is still OUR trap; a later mod may own it now.
      const current = Object.getOwnPropertyDescriptor(Object.prototype, trap.prop);
      if (current && current.set === trap.descriptor.set) {
        if (trap.previous) {
          Object.defineProperty(Object.prototype, trap.prop, trap.previous);
        } else {
          delete (Object.prototype as Record<string, unknown>)[trap.prop];
        }
      } else if (current) {
        riveLog(`${trap.prop} trap: descriptor replaced by third party — leaving as-is`);
      }
    } catch {
      // ignore
    }
  }
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  installed = false;
  traps = [];
  riveLog('rive runtime traps uninstalled');
}

function installOne(prop: string, onAssign: (owner: object, value: unknown) => void): void {
  const descriptor = makeTrap(prop, onAssign);
  // Ambient Object (not pageWindow.Object) on purpose: Firefox Xray wrappers can
  // reject accessors installed cross-realm.
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, prop) ?? null;
  Object.defineProperty(Object.prototype, prop, descriptor);
  traps.push({ prop, descriptor, previous });
}

/** Install the runtime traps. Call before bootstrap's first await; the cleanup is idempotent. */
export function initCanvasRuntimeTrap(): () => void {
  if (installed) return uninstallTrap;
  installed = true;

  try {
    installOne('runtime', (_owner, value) => offerRuntime(value, 'canvas-trap'));
    installOne('decodeImage', (owner, value) => {
      if (typeof value === 'function') offerRuntime(owner, 'decode-trap');
    });
  } catch (e) {
    riveLog('rive runtime trap install failed', e);
    uninstallTrap();
    return () => {};
  }

  timeoutId = setTimeout(() => {
    riveLog(`rive runtime traps timing out after ${TRAP_TIMEOUT_MS}ms; ` +
      `${getWrappedRuntimeCount()} runtime(s) wrapped`);
    uninstallTrap();
  }, TRAP_TIMEOUT_MS);

  riveLog('rive runtime traps installed');
  return uninstallTrap;
}
