// src/rive-engine/fileOverrideStore.ts
//
// IndexedDB-backed persistence for whole-file .riv overrides.
//
// Why IDB and not the standard QPM storage layer: overrides are binary
// blobs that routinely run into the megabytes (petz.riv is ~6 MB). The
// localStorage/GM-mirror backend caps near 5–10 MB per origin, and even
// fitting one large override forces a base64 round-trip (+33% bloat,
// tens of ms of main-thread work). IDB stores Uint8Array natively and
// has GB-scale browser-managed quotas.
//
// Scope: this wrapper is intentionally minimal — one DB, one store,
// row-per-override keyed by rivFile. No external dependencies, no
// migration scaffolding. If we ever need a second binary-payload
// feature in the rive-engine, generalise then.
//
// Failure mode: every operation swallows errors at the caller boundary
// (fileOverrides.ts logs via riveLog). Persistence is best-effort; the
// in-memory map is always the source of truth at runtime.

const DB_NAME = 'qpm-rive-overrides';
const DB_VERSION = 1;
const STORE = 'files';

export interface StoredOverride {
  rivFile: string;
  bytes: Uint8Array;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available in this context'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'rivFile' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('IDB open failed'));
  });
}

export async function getAllOverrides(): Promise<StoredOverride[]> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const dbRef = db;
    return await new Promise<StoredOverride[]>((resolve, reject) => {
      const tx = dbRef.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () =>
        resolve((req.result as StoredOverride[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db?.close();
  }
}

/**
 * Replace the entire stored override set with `entries`. Single
 * transaction — partial failure leaves the prior state intact.
 */
export async function putAllOverrides(
  entries: StoredOverride[],
): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const dbRef = db;
    await new Promise<void>((resolve, reject) => {
      const tx = dbRef.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      for (const e of entries) store.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db?.close();
  }
}
