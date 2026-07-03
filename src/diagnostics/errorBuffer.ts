// src/diagnostics/errorBuffer.ts — 200-entry ring buffer with dedup + persistence (§6.2)

import { storage } from '../utils/storage';
import type { ErrorBufferEntry, QpmError } from './types';

const STORAGE_KEY = 'qpm.diagnostics.errorBuffer.v1';
const MIGRATION_KEY = 'qpm.diagnostics.errorBuffer.migration.v1';
const MAX_ENTRIES = 200;
const FLUSH_DEBOUNCE_MS = 5000;

// QPM-ATOM-001 context.key names that are no longer registered anywhere in
// ATOM_FINDERS. These were emitted by pre-3.3.4 QPM versions and persist in
// user error buffers as residue. A one-time migration drops them so the
// Diagnostics window doesn't display dead-code warnings forever.
const DEAD_ATOM_KEYS = new Set(['avatarData', 'selectedItem', 'growSlotIndex', 'shopPurchases']);

function migrateStaleEntries(): boolean {
  let mutated = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.code !== 'QPM-ATOM-001') continue;
    const k = (e.context as { key?: unknown } | undefined)?.key;
    if (typeof k === 'string' && DEAD_ATOM_KEYS.has(k)) {
      entries.splice(i, 1);
      mutated = true;
    }
  }
  return mutated;
}

const entries: ErrorBufferEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;
let unloadHooksInstalled = false;

function safeStringifyContext(context: Record<string, unknown> | undefined): string {
  if (!context) return '';
  try {
    return JSON.stringify(context);
  } catch {
    return '<unserializable>';
  }
}

function describeCause(cause: unknown): string | undefined {
  if (cause == null) return undefined;
  if (cause instanceof Error) {
    return cause.stack ? `${cause.name}: ${cause.message}` : `${cause.name}: ${cause.message}`;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_DEBOUNCE_MS);
}

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    storage.set(STORAGE_KEY, entries);
  } catch {
    // storage layer already swallows failures; nothing to do.
  }
}

function installUnloadHooks(): void {
  if (unloadHooksInstalled) return;
  unloadHooksInstalled = true;
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && flushTimer !== null) {
        flush();
      }
    });
    window.addEventListener('beforeunload', () => {
      if (flushTimer !== null) flush();
    });
  } catch {
    // Non-DOM contexts (tests, etc.) — fine to skip.
  }
}

export const errorBuffer = {
  /** Restore persisted entries from storage. Call once on init. */
  hydrate(): void {
    if (hydrated) return;
    hydrated = true;
    try {
      const restored = storage.get<ErrorBufferEntry[]>(STORAGE_KEY, []);
      if (Array.isArray(restored)) {
        entries.length = 0;
        for (const entry of restored) {
          if (entry && typeof entry === 'object' && typeof entry.code === 'string') {
            entries.push(entry);
          }
        }
      }
    } catch {
      // Corrupt storage — start fresh.
    }
    // One-time migration: drop residue entries for atom keys that no longer
    // exist in ATOM_FINDERS. Runs at most once per install.
    try {
      const migrated = storage.get<boolean>(MIGRATION_KEY, false);
      if (!migrated) {
        const mutated = migrateStaleEntries();
        storage.set(MIGRATION_KEY, true);
        if (mutated) scheduleFlush();
      }
    } catch {
      // Migration errors are non-fatal — the buffer still works.
    }
    installUnloadHooks();
  },

  /** Record one error event. Dedups consecutive identical (code + context). */
  record(error: QpmError): void {
    if (!hydrated) errorBuffer.hydrate();

    const ctxStr = safeStringifyContext(error.context);
    const last = entries[entries.length - 1];
    if (last && last.code === error.code && safeStringifyContext(last.context) === ctxStr) {
      last.count += 1;
      last.lastSeen = error.timestamp;
      scheduleFlush();
      return;
    }

    const entry: ErrorBufferEntry = {
      code: error.code,
      subsystem: error.subsystem,
      severity: error.severity,
      message: error.message,
      ...(error.context === undefined ? {} : { context: error.context }),
      ...(error.cause === undefined ? {} : { causeText: describeCause(error.cause) ?? '' }),
      count: 1,
      firstSeen: error.timestamp,
      lastSeen: error.timestamp,
    };
    entries.push(entry);

    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }

    scheduleFlush();
  },

  /** Read a snapshot (newest last). */
  readAll(): readonly ErrorBufferEntry[] {
    if (!hydrated) errorBuffer.hydrate();
    return entries.slice();
  },

  /** Read the most-recent N entries (newest last). */
  recent(n: number): readonly ErrorBufferEntry[] {
    if (!hydrated) errorBuffer.hydrate();
    const safe = Math.max(0, Math.floor(n));
    return entries.slice(Math.max(0, entries.length - safe));
  },

  /** Force a synchronous flush — call from the Diagnostics window. */
  flush(): void {
    flush();
  },

  /** Test/debug helper — clears buffer state without writing. */
  clear(): void {
    entries.length = 0;
    flush();
  },
};

export type ErrorBuffer = typeof errorBuffer;
