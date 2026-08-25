// src/core/pageContext.ts
// Minimal helpers to interact with the page window regardless of sandboxing.

/* eslint-disable @typescript-eslint/ban-ts-comment */
// Some userscript environments still expose unsafeWindow while others do not.
// We defensively rely on a declared global so the bundler does not complain.
// @ts-ignore
declare const unsafeWindow: (Window & typeof globalThis & Record<string, unknown>) | undefined;
/* eslint-enable @typescript-eslint/ban-ts-comment */

const sandboxWindow = window;

function resolvePageWindow(): Window & typeof globalThis & Record<string, unknown> {
  // Tampermonkey / Violentmonkey standard
  if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
    return unsafeWindow;
  }

  // Greasemonkey / Firefox bridge
  const wrapped = (sandboxWindow as unknown as { wrappedJSObject?: unknown }).wrappedJSObject;
  if (wrapped && wrapped !== sandboxWindow) {
    return wrapped as Window & typeof globalThis & Record<string, unknown>;
  }

  return sandboxWindow as Window & typeof globalThis & Record<string, unknown>;
}

const pageWindowRef = resolvePageWindow();

/** Reference to the actual page window. Falls back to the sandbox window. */
export const pageWindow = pageWindowRef;

/** True when we execute inside an isolated userscript sandbox. */
export const isIsolatedContext = pageWindowRef !== sandboxWindow;

// Firefox Xray wrapper bridge — required to expose functions to the page context.
// Without this, setting a function on wrappedJSObject creates a value invisible
// to page-context callers (including the browser console).
const _exportFunction: ((fn: Function, target: object) => Function) | null =
  typeof (globalThis as unknown as Record<string, unknown>).exportFunction === 'function'
    ? (globalThis as unknown as Record<string, unknown>).exportFunction as (fn: Function, target: object) => Function
    : null;

const _cloneInto: ((obj: unknown, target: object) => unknown) | null =
  typeof (globalThis as unknown as Record<string, unknown>).cloneInto === 'function'
    ? (globalThis as unknown as Record<string, unknown>).cloneInto as (obj: unknown, target: object) => unknown
    : null;

/**
 * Prepare a value for cross-realm assignment on the page window.
 * In Firefox, functions must go through exportFunction and objects through cloneInto
 * so the page context (and the browser console) can access them.
 */
function wrapForPageWindow(value: unknown): unknown {
  if (!isIsolatedContext) return value;
  if (typeof value === 'function' && _exportFunction) {
    return _exportFunction(value as Function, pageWindowRef);
  }
  if (value !== null && typeof value === 'object' && _cloneInto) {
    return _cloneInto(value, pageWindowRef);
  }
  return value;
}

const warnedCollisions = new Set<string>();

/**
 * Mirror a value onto both the page window and sandbox window.
 * Useful for sharing captured stores across co-existing scripts.
 * `opts.ifAbsent` skips the write when another script already owns the name
 * (collisions are logged either way; console.warn directly — pageContext
 * must stay dependency-light, no logger import).
 */
export function shareGlobal(name: string, value: unknown, opts?: { ifAbsent?: boolean }): void {
  let existing: unknown;
  try {
    existing = (pageWindowRef as unknown as Record<string, unknown>)[name];
  } catch {
    existing = undefined;
  }
  const collides = existing !== undefined && existing !== null && existing !== value;
  if (collides && opts?.ifAbsent) {
    if (!warnedCollisions.has(name)) {
      warnedCollisions.add(name);
      console.warn(`[QPM] shareGlobal: '${name}' already defined by another script — leaving as-is`);
    }
    return;
  }
  if (collides && !warnedCollisions.has(name)) {
    warnedCollisions.add(name);
    console.warn(`[QPM] shareGlobal: overwriting existing '${name}'`);
  }

  try {
    (pageWindowRef as unknown as Record<string, unknown>)[name] = wrapForPageWindow(value);
  } catch {}

  if (isIsolatedContext) {
    try {
      (sandboxWindow as unknown as Record<string, unknown>)[name] = value;
    } catch {}
  }
}

/**
 * Get (or create) a plain object global on the PAGE window. Creation goes
 * through cloneInto on Firefox so page-context readers can see it.
 * Returns null only if both read and create fail (hostile Xray edge).
 */
export function ensurePageObject(name: string): Record<string, unknown> | null {
  try {
    const existing = (pageWindowRef as unknown as Record<string, unknown>)[name];
    if (existing !== null && typeof existing === 'object') {
      return existing as Record<string, unknown>;
    }
  } catch {}
  try {
    const created = (isIsolatedContext && _cloneInto ? _cloneInto({}, pageWindowRef) : {}) as Record<string, unknown>;
    (pageWindowRef as unknown as Record<string, unknown>)[name] = created;
    return (pageWindowRef as unknown as Record<string, unknown>)[name] as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Read a value that might have been stored on either window. */
export function readSharedGlobal<T = unknown>(name: string): T | undefined {
  if (isIsolatedContext) {
    const sandboxValue = (sandboxWindow as unknown as Record<string, unknown>)[name];
    if (sandboxValue !== undefined) {
      return sandboxValue as T;
    }
  }
  return (pageWindowRef as unknown as Record<string, unknown>)[name] as T | undefined;
}

/**
 * Dispatch a CustomEvent to both page and sandbox contexts.
 */
export function dispatchCustomEventAll<T = unknown>(type: string, detail?: T): void {
  const dispatch = (target: Window & typeof globalThis): void => {
    try {
      const EventCtor = (target as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent ?? CustomEvent;
      target.dispatchEvent(new EventCtor(type, detail !== undefined ? { detail } : undefined));
    } catch {
      // Ignore cross-realm event constructor issues.
    }
  };

  dispatch(pageWindowRef);
  if (isIsolatedContext) {
    dispatch(sandboxWindow);
  }
}
