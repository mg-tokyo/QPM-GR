// src/rive-engine/helpers.ts

import { isVerboseLogsEnabled, writeShimConsole } from '../diagnostics/logger';
import { pageWindow } from '../core/pageContext';
import type { LowLevelRive, RiveImage, RiveEngineEventMap, RiveEngineListener } from './types';

// User-toggled debug tracer (settable via setRiveEngineDebug). Preserves the
// (msg, ...args) + .enabled shape used across the folder; coded failure
// paths route via _diagnostics.ts's warnRiveEngine instead. §1.3 debug-tracer
// precedent (textureSwapper types.ts).
interface DebugLogger {
  (...args: unknown[]): void;
  enabled: boolean;
}

export const riveLog: DebugLogger = ((): DebugLogger => {
  const shim = ((...args: unknown[]): void => {
    if (!shim.enabled && !isVerboseLogsEnabled()) return;
    writeShimConsole('QPM:RiveEngine', args);
  }) as DebugLogger;
  shim.enabled = false;
  return shim;
})();

// ---------------------------------------------------------------------------
// Image utilities
// ---------------------------------------------------------------------------

export function decodeImageBytes(
  rive: LowLevelRive,
  bytes: Uint8Array,
): Promise<RiveImage> {
  return new Promise((resolve, reject) => {
    rive.decodeImage(bytes, (image) => {
      if (image) resolve(image);
      else reject(new Error('[RiveEngine] Failed to decode image'));
    });
  });
}

export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const fetchFn = typeof pageWindow.fetch === 'function'
    ? pageWindow.fetch.bind(pageWindow)
    : fetch;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`[RiveEngine] Fetch failed: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let nextId = 1;

export function generateInstanceId(): string {
  return `rive_${nextId++}`;
}

// ---------------------------------------------------------------------------
// Structural field resolution (audit fix #7)
//
// TypeScript private fields compile to regular JS properties. A production
// minifier MAY rename them. This helper tries the known name first, then
// scans all own properties for a structural match.
// ---------------------------------------------------------------------------

export function resolvePrivateField<T>(
  obj: Record<string, unknown>,
  knownName: string,
  predicate: (value: unknown) => boolean,
): T | null {
  if (knownName in obj && predicate(obj[knownName])) {
    return obj[knownName] as T;
  }
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (key === knownName) continue;
    try {
      if (predicate(obj[key])) return obj[key] as T;
    } catch {
      // Some getters may throw
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Event bus
// ---------------------------------------------------------------------------

export class EventBus {
  private listeners = new Map<string, Set<RiveEngineListener<any>>>();

  on<K extends keyof RiveEngineEventMap>(
    event: K,
    listener: RiveEngineListener<K>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  emit<K extends keyof RiveEngineEventMap>(
    event: K,
    data: RiveEngineEventMap[K],
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(data); } catch (e) { riveLog('Event listener error:', e); }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
