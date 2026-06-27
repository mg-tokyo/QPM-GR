// src/rive-engine/fileOverrides.ts
//
// Whole-file .riv replacement. The setter is wired through index.ts and
// consumed by fetchInterceptor.ts — every .riv fetch consults
// getFileOverride(requestUrl) before passing bytes to the Rive runtime, so
// the matching override bytes are served instead. Registering an override
// after the game has already cached a .riv won't retroactively swap it; the
// substitution only fires on the next fetch.
//
// Persistence: backed by IndexedDB via ./fileOverrideStore. Every
// mutation (set / cleanup / revertAll) fires a fire-and-forget write of
// the full current set so overrides registered from the page console
// survive a reload. The in-memory `activeOverrides` map is always the
// source of truth at runtime; IDB is a durable mirror.

import type { OverrideInfo } from './types';
import { riveLog, EventBus } from './helpers';
import {
  getAllOverrides,
  putAllOverrides,
  type StoredOverride,
} from './fileOverrideStore';

interface ActiveFileOverride {
  info: OverrideInfo;
  rivFile: string;
  bytes: Uint8Array;
}

const activeOverrides = new Map<string, ActiveFileOverride>();
let nextId = 1;

function snapshotForStore(): StoredOverride[] {
  const out: StoredOverride[] = [];
  const now = Date.now();
  for (const entry of activeOverrides.values()) {
    out.push({ rivFile: entry.rivFile, bytes: entry.bytes, savedAt: now });
  }
  return out;
}

// Writes serialize via this chain so a fast-fire sequence (set / cleanup /
// set again) doesn't race. Callers that need to be sure a write committed
// before navigating away can `await awaitOverridePersist()`.
let pendingPersist: Promise<void> = Promise.resolve();

function persist(): void {
  const snapshot = snapshotForStore();
  pendingPersist = pendingPersist
    .then(() => putAllOverrides(snapshot))
    .catch((e) => {
      riveLog('File override persist failed', e);
    });
}

/**
 * Resolves when every in-flight persist has committed (or failed) to
 * IndexedDB. Use before any action that may tear down the page mid-write
 * (page reload from a debug console, navigation, manager uninstall).
 */
export function awaitOverridePersist(): Promise<void> {
  return pendingPersist;
}

export function setFileOverride(
  rivFile: string,
  bytes: Uint8Array,
  eventBus: EventBus,
): () => void {
  const id = `file_${nextId++}`;

  const info: OverrideInfo = {
    id,
    kind: 'file',
    scope: { type: 'global', source: rivFile },
    property: rivFile,
    cleanup: () => {},
  };

  const entry: ActiveFileOverride = { info, rivFile, bytes };
  activeOverrides.set(id, entry);
  persist();

  const cleanup = () => {
    if (!activeOverrides.has(id)) return;
    activeOverrides.delete(id);
    persist();
    eventBus.emit('overrideReverted', info);
    riveLog(`File override reverted: ${rivFile}`);
  };

  info.cleanup = cleanup;
  eventBus.emit('overrideApplied', info);
  riveLog(`File override registered: ${rivFile} (${bytes.byteLength} bytes)`);
  return cleanup;
}

export function getFileOverride(src: string): Uint8Array | null {
  const lower = src.toLowerCase();
  for (const entry of activeOverrides.values()) {
    if (lower.includes(entry.rivFile.toLowerCase())) {
      return entry.bytes;
    }
  }
  return null;
}

export function revertAllFileOverrides(): void {
  for (const entry of activeOverrides.values()) {
    entry.info.cleanup();
  }
  activeOverrides.clear();
  persist();
}

export function getActiveFileOverrides(): OverrideInfo[] {
  return Array.from(activeOverrides.values()).map((e) => e.info);
}

/**
 * Replay persisted overrides into the in-memory map. Returns when all
 * restored entries have been registered (so callers can sequence
 * fetch-dependent work after the replay if needed). Call once at
 * engine init, after the EventBus exists. Each restored entry goes
 * through the normal setFileOverride code path so emit/log behaviour
 * matches a fresh registration.
 */
export async function restoreFileOverridesFromStorage(
  eventBus: EventBus,
): Promise<void> {
  let arr: StoredOverride[];
  try {
    arr = await getAllOverrides();
  } catch (e) {
    riveLog('File override restore: storage read failed', e);
    return;
  }
  if (arr.length === 0) return;

  let restored = 0;
  for (const p of arr) {
    if (!p || typeof p.rivFile !== 'string' || !(p.bytes instanceof Uint8Array)) {
      continue;
    }
    try {
      setFileOverride(p.rivFile, p.bytes, eventBus);
      restored++;
    } catch (e) {
      riveLog(`File override restore: failed for ${p.rivFile}`, e);
    }
  }
  if (restored > 0) {
    riveLog(`Restored ${restored} file override(s) from storage`);
  }
}
