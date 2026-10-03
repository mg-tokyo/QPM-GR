// Fresh-value mirror for the storage layer: in-memory map backed by IndexedDB.
//
// Why it exists: script managers like SMM bake GM values into the userscript at
// registration and only re-bake a few seconds after the last write, so a quick
// reload reads stale GM values. The mirror is written synchronously (memory) and
// persisted to IDB, and is read before GM. It used to live in localStorage, which
// shares the game's ~5 MB origin quota — once full, writes failed silently and
// reads returned stale data forever.

const DB_NAME = 'qpm-storage-mirror';
const DB_VERSION = 1;
const STORE = 'kv';

interface MirrorRow {
  key: string;
  raw: string;
  savedAt: number;
  // A removal: the script manager may still serve the old value until it re-bakes.
  deleted?: true;
}

const cache = new Map<string, string>();
const deleted = new Set<string>();
let available = false;
let hydrated = false;
let dbPromise: Promise<IDBDatabase> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let failureHandler: ((error: unknown) => void) | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // A version change (another tab upgrading) closes us; reopen lazily next time.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
  });
  return dbPromise;
}

function runWrite(work: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function enqueue(key: string, work: (store: IDBObjectStore) => void): void {
  if (!available) return;
  writeQueue = writeQueue
    .then(() => runWrite(work))
    .catch((error: unknown) => {
      // A value we could not persist must not be served as fresh on the next load.
      cache.delete(key);
      failureHandler?.(error);
    });
}

/** Loads every persisted row into memory. Resolves to whether IDB is usable. */
export async function hydrateMirror(): Promise<boolean> {
  if (hydrated) return available;
  hydrated = true;
  try {
    const db = await openDb();
    const rows = await new Promise<MirrorRow[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as MirrorRow[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    for (const row of rows) {
      if (typeof row?.key !== 'string') continue;
      if (row.deleted === true) deleted.add(row.key);
      else if (typeof row.raw === 'string') cache.set(row.key, row.raw);
    }
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function isMirrorAvailable(): boolean {
  return available;
}

export function setMirrorFailureHandler(handler: ((error: unknown) => void) | null): void {
  failureHandler = handler;
}

export function mirrorGet(key: string): string | null {
  return cache.get(key) ?? null;
}

/** True when the mirror holds the key's current state, a removal included. */
export function mirrorHas(key: string): boolean {
  return cache.has(key) || deleted.has(key);
}

export function mirrorIsDeleted(key: string): boolean {
  return deleted.has(key);
}

export function mirrorKeys(): string[] {
  return Array.from(cache.keys());
}

export function mirrorSet(key: string, raw: string): void {
  cache.set(key, raw);
  deleted.delete(key);
  enqueue(key, (store) => { store.put({ key, raw, savedAt: Date.now() } satisfies MirrorRow); });
}

export function mirrorRemove(key: string): void {
  cache.delete(key);
  deleted.add(key);
  enqueue(key, (store) => { store.put({ key, raw: '', savedAt: Date.now(), deleted: true } satisfies MirrorRow); });
}

/** Drops removal markers once `isStale` says nothing durable still serves the old value. */
export function pruneMirrorDeletions(isStale: (key: string) => boolean): void {
  for (const key of Array.from(deleted)) {
    if (isStale(key)) continue;
    deleted.delete(key);
    enqueue(key, (store) => { store.delete(key); });
  }
}

/** Resolves once every queued write has settled — for tests and pre-unload flushes. */
export function flushMirror(): Promise<void> {
  return writeQueue;
}
