import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row { key: string; raw: string; savedAt: number; deleted?: boolean }

let idbRows: Map<string, Row>;
// `persisted` is what the script manager has stored; `served` is what GM_getValue returns on this
// load. SMM bakes values into the script and re-bakes a few seconds after the last write, so a quick
// reload is served an older snapshot.
let persisted: Map<string, string>;
let served: Map<string, string>;

function fakeIndexedDb(): unknown {
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
              later(() => { r.result = [...idbRows.values()].map((row) => ({ ...row })); r.onsuccess?.(); });
              return r;
            },
            put: (row: Row) => { idbRows.set(row.key, { ...row }); },
            delete: (key: string) => { idbRows.delete(key); },
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

async function load(): Promise<{ s: typeof import('./storage'); m: typeof import('./storageMirror') }> {
  vi.resetModules();
  const s = await import('./storage');
  const m = await import('./storageMirror');
  await s.initializeStorage();
  return { s, m };
}

const KEY = 'qpm.test.removed';

beforeEach(() => {
  idbRows = new Map();
  persisted = new Map();
  served = new Map();
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  vi.stubGlobal('GM_getValue', (k: string) => served.get(k));
  vi.stubGlobal('GM_setValue', (k: string, v: string) => { persisted.set(k, v); served.set(k, v); });
  vi.stubGlobal('GM_deleteValue', (k: string) => { persisted.delete(k); served.delete(k); });
  vi.stubGlobal('GM', undefined);
});

describe('storage.remove under a script manager that serves stale values', () => {
  it('a removed key stays removed when the next load is served the old value', async () => {
    let { s, m } = await load();
    s.storage.set(KEY, { completed: true });
    const staleBake = new Map(persisted);
    s.storage.remove(KEY);
    await m.flushMirror();

    served = staleBake;
    ({ s, m } = await load());
    expect(s.storage.get(KEY, null)).toBeNull();
    await m.flushMirror();
    expect(idbRows.get(KEY)?.deleted).toBe(true);
  });

  it('drops the deletion marker once the script manager no longer serves the key', async () => {
    let { s, m } = await load();
    s.storage.set(KEY, { completed: true });
    s.storage.remove(KEY);
    await m.flushMirror();

    served = new Map(persisted);
    ({ s, m } = await load());
    expect(s.storage.get(KEY, null)).toBeNull();
    await m.flushMirror();
    expect(idbRows.has(KEY)).toBe(false);
  });

  it('a set after the remove wins over both the marker and the stale value', async () => {
    let { s, m } = await load();
    s.storage.set(KEY, { v: 1 });
    const staleBake = new Map(persisted);
    s.storage.remove(KEY);
    s.storage.set(KEY, { v: 2 });
    await m.flushMirror();

    served = staleBake;
    ({ s } = await load());
    expect(s.storage.get(KEY, null)).toEqual({ v: 2 });
  });
});

describe('readDurable', () => {
  const SHARED = 'qpm.test.shared';

  it('legacy GM: returns the shared copy while get keeps the mirror value', async () => {
    const { s } = await load();
    s.storage.set(SHARED, { v: 1 });
    served.set(SHARED, JSON.stringify({ v: 2 }));
    expect(s.storage.get(SHARED, null)).toEqual({ v: 1 });
    expect(await s.readDurable(SHARED, null)).toEqual({ v: 2 });
    expect(s.storage.get(SHARED, null)).toEqual({ v: 1 });
  });

  it('legacy GM: missing key returns the fallback', async () => {
    const { s } = await load();
    expect(await s.readDurable('qpm.test.absent', 'fb')).toBe('fb');
  });

  it('a removal on this origin wins over a value GM still serves', async () => {
    const { s } = await load();
    s.storage.set(SHARED, { v: 1 });
    const staleBake = new Map(served);
    s.storage.remove(SHARED);
    served = staleBake;
    expect(await s.readDurable(SHARED, null)).toBeNull();
  });

  it('modern GM: reads the shared copy after this page\'s pending writes land', async () => {
    const gmStore = new Map<string, string>();
    vi.stubGlobal('GM_getValue', undefined);
    vi.stubGlobal('GM_setValue', undefined);
    vi.stubGlobal('GM_deleteValue', undefined);
    vi.stubGlobal('GM', {
      getValue: async (k: string, d: unknown) => (gmStore.has(k) ? gmStore.get(k) : d),
      setValue: async (k: string, v: string) => { await Promise.resolve(); gmStore.set(k, v); },
      deleteValue: async (k: string) => { gmStore.delete(k); },
    });
    const { s } = await load();
    expect(s.getStorageRuntime()).toBe('modern-gm');

    s.storage.set(SHARED, { v: 3 });
    expect(await s.readDurable(SHARED, null)).toEqual({ v: 3 });

    gmStore.set(SHARED, JSON.stringify({ v: 4 }));
    expect(s.storage.get(SHARED, null)).toEqual({ v: 3 });
    expect(await s.readDurable(SHARED, null)).toEqual({ v: 4 });
    expect(await s.readDurable('qpm.test.absent', 'fb')).toBe('fb');
  });

  it('local-storage: returns the origin copy, no share exists', async () => {
    vi.stubGlobal('GM_getValue', undefined);
    vi.stubGlobal('GM_setValue', undefined);
    vi.stubGlobal('GM_deleteValue', undefined);
    const { s } = await load();
    expect(s.getStorageRuntime()).toBe('local-storage');

    s.storage.set(SHARED, { v: 5 });
    expect(await s.readDurable(SHARED, null)).toEqual({ v: 5 });
    expect(await s.readDurable('qpm.test.absent', 'fb')).toBe('fb');
  });
});

describe('exportAllValues', () => {
  it('leaves out per-player copies of excluded logs but keeps the activity UI prefs', async () => {
    const { s } = await load();
    const scoped = ['qpm.petActivity.v1.p1', 'qpm.petHatchingTracker.knownPetIds.v1.p1'];
    for (const key of scoped) { s.storage.set(key, ['x']); s.registerDynamicKey(key); }
    s.storage.set('qpm.petActivity.v1', { version: 1, events: [] });
    s.storage.set('qpm.petActivity.ui.v1', { kind: 'all' });
    const out = s.exportAllValues();
    for (const key of [...scoped, 'qpm.petActivity.v1']) expect(out).not.toHaveProperty(key);
    expect(out).toHaveProperty('qpm.petActivity.ui.v1');
  });
});
