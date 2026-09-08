import { pageWindow, readSharedGlobal, shareGlobal } from '../pageContext';
import type { AtomCacheLike } from './types';
import {
  CACHE_GLOBAL_KEY,
  getLiveAtomCache,
  setLiveAtomCache,
  wait,
} from './state';

function isAtomCacheLike(value: unknown): value is AtomCacheLike {
  return !!value && typeof (value as AtomCacheLike).get === 'function' && typeof (value as AtomCacheLike).values === 'function';
}

/**
 * Get atom cache from global scope
 */
export function getAtomCache(): AtomCacheLike | undefined {
  // Check our cached reference first
  const cached = getLiveAtomCache();
  if (cached) return cached;

  // Check shared global
  const shared = readSharedGlobal<AtomCacheLike>(CACHE_GLOBAL_KEY);
  if (shared && isAtomCacheLike(shared)) {
    setLiveAtomCache(shared);
    return shared;
  }

  // Check window.jotaiAtomCache (game/Aries Mod)
  const raw = (pageWindow as unknown as Record<string, unknown>).jotaiAtomCache as
    | { cache?: unknown }
    | AtomCacheLike
    | undefined;

  const candidate = raw && 'cache' in raw ? (raw as { cache?: unknown }).cache : raw;
  if (isAtomCacheLike(candidate)) {
    setLiveAtomCache(candidate as AtomCacheLike);
    return candidate as AtomCacheLike;
  }

  return undefined;
}

/** O(1) on the game's Map; falls back to one iteration for duck-typed caches. */
export function getAtomCacheSize(): number {
  const cache = getAtomCache();
  if (!cache) return 0;
  if (typeof cache.size === 'number') return cache.size;
  let n = 0;
  for (const _ of cache.values()) n += 1;
  return n;
}

/**
 * Wait for atom cache to become available
 */
export async function waitForAtomCache(timeoutMs = 5000): Promise<AtomCacheLike | undefined> {
  const start = Date.now();
  let cache = getAtomCache();

  while (!cache && Date.now() - start < timeoutMs) {
    await wait(100);
    cache = getAtomCache();
  }

  if (cache) {
    setLiveAtomCache(cache);
    // Mirror to our global for other mods
    try {
      shareGlobal(CACHE_GLOBAL_KEY, cache);
    } catch {}
  }

  return cache;
}

export function findAtomsByLabel(regex: RegExp): any[] {
  const cache = getAtomCache();
  if (!cache) return [];

  const matches: any[] = [];

  // Prefer entries() — returns [atomKey, atomMeta] pairs.
  // The KEY is the actual atom object the jotai store recognizes.
  // Derived atoms (e.g. myPetSlotInfosAtom) only work when we pass the KEY,
  // not the metadata value, to store.get() / store.sub().
  if (typeof cache.entries === 'function') {
    for (const [atom, meta] of cache.entries()) {
      if (!atom || typeof atom !== 'object') continue;
      const metaObj = meta as Record<string, unknown>;
      const atomObj = atom as Record<string, unknown>;
      // debugLabel may live on the meta object (derived atoms) or the atom itself (primitive atoms)
      const label = String(
        metaObj?.debugLabel ?? metaObj?.label ??
        atomObj.debugLabel ?? atomObj.label ?? ''
      );
      if (regex.test(label)) {
        matches.push(atom);
      }
    }
    if (matches.length > 0) return matches;
  }

  // Fallback: values() iteration (works when atom objects are stored as values,
  // as in some jotai versions where primitive atoms are their own metadata).
  for (const atom of cache.values()) {
    if (!atom) continue;
    const label = String((atom as Record<string, unknown>).debugLabel ?? (atom as Record<string, unknown>).label ?? '');
    if (regex.test(label)) {
      matches.push(atom);
    }
  }
  return matches;
}

/**
 * Return all atom entries from the cache with their labels.
 * Used by atomRegistry for structure scanning and auto-cataloging.
 */
export function getAllAtomEntries(): Array<{ atom: unknown; label: string }> {
  const cache = getAtomCache();
  if (!cache) return [];
  const entries: Array<{ atom: unknown; label: string }> = [];
  if (typeof cache.entries === 'function') {
    for (const [atom, meta] of cache.entries()) {
      if (!atom || typeof atom !== 'object') continue;
      const metaObj = meta as Record<string, unknown>;
      const atomObj = atom as Record<string, unknown>;
      const label = String(
        metaObj?.debugLabel ?? metaObj?.label ??
        atomObj.debugLabel ?? atomObj.label ?? ''
      );
      entries.push({ atom, label });
    }
  }
  return entries;
}

/**
 * Find atom by checking its value structure (fallback when labels are unavailable)
 */
export function findAtomByStructure(matcher: (value: any) => boolean): any | null {
  const cache = getAtomCache();
  if (!cache) return null;

  for (const atom of cache.values()) {
    if (!atom) continue;

    try {
      const state = cache.get(atom) as { v?: unknown } | undefined;
      if (state && Object.prototype.hasOwnProperty.call(state, 'v')) {
        if (matcher(state.v)) {
          return atom;
        }
      }
    } catch {
      // Ignore atoms that can't be read
    }
  }

  return null;
}

export function getAtomByLabel(label: string): any | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped}$`);
  return findAtomsByLabel(regex)[0] ?? null;
}
