// Test-only fakes for the storage layer (imported by *.test.ts, never by runtime code).

export interface FakeMirrorRow { key: string; raw: string; savedAt: number; deleted?: boolean }

/** Minimal async IndexedDB over `rows`: one object store, getAll/put/delete. */
export function fakeIndexedDb(rows: Map<string, FakeMirrorRow>): unknown {
  const later = (fn: () => void): void => { queueMicrotask(fn); };
  return {
    open: () => {
      const req: { result?: unknown; onsuccess?: () => void } = {};
      req.result = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        close: () => {},
        transaction: () => {
          const tx: { oncomplete?: () => void; objectStore?: () => unknown } = {};
          tx.objectStore = () => ({
            getAll: () => {
              const r: { result?: unknown; onsuccess?: () => void } = {};
              later(() => { r.result = [...rows.values()].map((row) => ({ ...row })); r.onsuccess?.(); });
              return r;
            },
            put: (row: FakeMirrorRow) => { rows.set(row.key, { ...row }); },
            delete: (key: string) => { rows.delete(key); },
          });
          later(() => tx.oncomplete?.());
          return tx;
        },
      };
      later(() => req.onsuccess?.());
      return req;
    },
  };
}

/** localStorage over `items`; `Object.keys()` lists the stored keys like a real Storage. */
export function fakeLocalStorage(items: Map<string, string>): unknown {
  const methods = {
    getItem: (key: string): string | null => items.get(key) ?? null,
    setItem: (key: string, value: string): void => { items.set(key, String(value)); },
    removeItem: (key: string): void => { items.delete(key); },
  };
  return new Proxy({}, {
    get: (_t, prop) => (typeof prop === 'string' && prop in methods ? methods[prop as keyof typeof methods] : undefined),
    ownKeys: () => [...items.keys()],
    getOwnPropertyDescriptor: (_t, prop) => (typeof prop === 'string' && items.has(prop)
      ? { value: items.get(prop), enumerable: true, configurable: true, writable: true }
      : undefined),
  });
}
