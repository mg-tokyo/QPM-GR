import { pageWindow } from '../core/pageContext';
import { storage } from './storage';

export const DEBUG_GLOBALS_OPT_IN_KEY = 'qpm.debug.globals.v1';

type DebugRoot = { __QPM_DEBUG?: Record<string, unknown> };

/**
 * Always-on `__QPM_DEBUG.<name>` bridge on the page realm, deliberately NOT
 * gated by `isDebugGlobalsEnabled()`: Firefox/Discord field evidence is
 * collected from users who never set the opt-in. Returns the remover.
 */
export function installDebugNamespace(name: string, api: Record<string, unknown>): () => void {
  try {
    // pageWindow (not globalThis) — Firefox Xray: the sandbox realm is
    // invisible from the page realm; the bridge must land on unsafeWindow.
    const root = pageWindow as unknown as DebugRoot;
    const existing = root.__QPM_DEBUG ?? {};
    existing[name] = api;
    root.__QPM_DEBUG = existing;
  } catch { /* cross-realm write refused */ }
  return () => {
    try {
      const existing = (pageWindow as unknown as DebugRoot).__QPM_DEBUG;
      if (existing) delete existing[name];
    } catch { /* ignore */ }
  };
}

function readLocalDebugOptIn(): boolean | undefined {
  try {
    const raw = storage.get<unknown>(DEBUG_GLOBALS_OPT_IN_KEY, undefined);
    if (raw == null) return undefined;
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  } catch {
    return undefined;
  }
}

export function isDebugGlobalsEnabled(): boolean {
  try {
    if ((import.meta as any)?.env?.DEV === true) return true;
  } catch {
    // no-op
  }

  const storageOptIn = storage.get<unknown>(DEBUG_GLOBALS_OPT_IN_KEY, undefined);
  if (typeof storageOptIn === 'boolean') return storageOptIn;

  return readLocalDebugOptIn() === true;
}
