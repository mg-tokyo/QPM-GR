import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_RECONCILE_KEY } from './storageKeys';
import { fakeIndexedDb, fakeLocalStorage, type FakeMirrorRow } from './storageTestFakes';

const KEY = 'qpm.test.setting';
const OTHER = 'qpm.test.other';
const OLD = JSON.stringify({ v: 1 });
const NEW = JSON.stringify({ v: 2 });

let idbRows: Map<string, FakeMirrorRow>;
let gmStore: Map<string, string>;
let local: Map<string, string>;
let gmSets: string[];

function stubLegacyGm(): void {
  vi.stubGlobal('GM_getValue', (k: string) => gmStore.get(k));
  vi.stubGlobal('GM_setValue', (k: string, v: string) => { gmSets.push(k); gmStore.set(k, v); });
  vi.stubGlobal('GM_deleteValue', (k: string) => { gmStore.delete(k); });
  vi.stubGlobal('GM_listValues', () => [...gmStore.keys()]);
  vi.stubGlobal('GM', undefined);
}

function stubNoGm(): void {
  for (const name of ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM']) vi.stubGlobal(name, undefined);
}

/** A value written while GM was unreachable: mirror row + localStorage copy on this origin. */
function writtenWithoutGm(key: string, raw: string, savedAt: number): void {
  idbRows.set(key, { key, raw, savedAt });
  local.set(key, raw);
}

function marker(): { v: number; origins: string[]; stamps: Record<string, number> } | null {
  const raw = gmStore.get(STORAGE_RECONCILE_KEY);
  return raw == null ? null : JSON.parse(raw);
}

async function load(): Promise<{ s: typeof import('./storage'); m: typeof import('./storageMirror') }> {
  vi.resetModules();
  const s = await import('./storage');
  const m = await import('./storageMirror');
  await s.initializeStorage();
  await m.flushMirror();
  return { s, m };
}

beforeEach(() => {
  idbRows = new Map();
  gmStore = new Map();
  local = new Map();
  gmSets = [];
  vi.stubGlobal('indexedDB', fakeIndexedDb(idbRows));
  vi.stubGlobal('localStorage', fakeLocalStorage(local));
  stubLegacyGm();
});

describe('storage reconcile under a GM runtime', () => {
  it('pushes a candidate newer than GM and stamps it with the mirror savedAt', async () => {
    gmStore.set(KEY, OLD);
    writtenWithoutGm(KEY, NEW, 2000);
    const { s } = await load();
    expect(gmStore.get(KEY)).toBe(NEW);
    expect(marker()).toEqual({ v: 1, origins: [], stamps: { [KEY]: 2000 } });
    expect(await s.readDurable(KEY, null)).toEqual({ v: 2 });
    expect(local.has(KEY)).toBe(false);
  });

  it('pushes the mirror value, not a stale localStorage copy', async () => {
    gmStore.set(KEY, OLD);
    idbRows.set(KEY, { key: KEY, raw: NEW, savedAt: 2000 });
    local.set(KEY, JSON.stringify({ v: 'stale' }));
    await load();
    expect(gmStore.get(KEY)).toBe(NEW);
  });

  it('pushes a key GM does not hold yet', async () => {
    writtenWithoutGm(KEY, NEW, 2000);
    await load();
    expect(gmStore.get(KEY)).toBe(NEW);
  });

  it('leaves GM alone when the candidate is older than its stamp', async () => {
    const newer = JSON.stringify({ v: 3 });
    gmStore.set(KEY, newer);
    gmStore.set(STORAGE_RECONCILE_KEY, JSON.stringify({ v: 1, origins: ['https://a'], stamps: { [KEY]: 3000 } }));
    writtenWithoutGm(KEY, NEW, 2000);
    const { s } = await load();
    expect(gmStore.get(KEY)).toBe(newer);
    expect(gmSets).toEqual([]);
    expect(s.storage.get(KEY, null)).toEqual({ v: 2 });
  });

  it('pushes over an older stamp and keeps the marker\'s other fields', async () => {
    gmStore.set(KEY, OLD);
    gmStore.set(STORAGE_RECONCILE_KEY, JSON.stringify({ v: 1, origins: ['https://a'], stamps: { [KEY]: 1000, [OTHER]: 5 } }));
    writtenWithoutGm(KEY, NEW, 2000);
    await load();
    expect(gmStore.get(KEY)).toBe(NEW);
    expect(marker()).toEqual({ v: 1, origins: ['https://a'], stamps: { [KEY]: 2000, [OTHER]: 5 } });
  });

  it('does not push or write the marker when GM already holds the value', async () => {
    gmStore.set(KEY, NEW);
    writtenWithoutGm(KEY, NEW, 2000);
    await load();
    expect(gmSets).toEqual([]);
    expect(marker()).toBeNull();
  });

  it('does not push a key with no localStorage copy', async () => {
    gmStore.set(KEY, OLD);
    idbRows.set(KEY, { key: KEY, raw: NEW, savedAt: 2000 });
    await load();
    expect(gmStore.get(KEY)).toBe(OLD);
    expect(gmSets).toEqual([]);
  });

  it('does not push a key whose mirror row is a removal', async () => {
    gmStore.set(KEY, OLD);
    idbRows.set(KEY, { key: KEY, raw: '', savedAt: 2000, deleted: true });
    local.set(KEY, NEW);
    await load();
    expect(gmStore.get(KEY)).toBe(OLD);
    expect(gmSets).toEqual([]);
  });

  it('a second init is a no-op', async () => {
    gmStore.set(KEY, OLD);
    writtenWithoutGm(KEY, NEW, 2000);
    writtenWithoutGm(OTHER, NEW, 2100);
    await load();
    expect(gmSets.sort()).toEqual([KEY, OTHER, STORAGE_RECONCILE_KEY].sort());
    gmSets = [];
    await load();
    expect(gmSets).toEqual([]);
    expect(gmStore.get(KEY)).toBe(NEW);
  });

  it('keeps the marker out of the mirror and out of exportAllValues', async () => {
    writtenWithoutGm(KEY, NEW, 2000);
    const { s, m } = await load();
    expect(gmStore.has(STORAGE_RECONCILE_KEY)).toBe(true);
    expect(idbRows.has(STORAGE_RECONCILE_KEY)).toBe(false);
    expect(m.mirrorHas(STORAGE_RECONCILE_KEY)).toBe(false);
    const exported = s.exportAllValues();
    expect(exported).toHaveProperty(KEY);
    expect(exported).not.toHaveProperty(STORAGE_RECONCILE_KEY);
  });

  it('a failed GM write is not stamped and init still completes', async () => {
    gmStore.set(KEY, OLD);
    writtenWithoutGm(KEY, NEW, 2000);
    vi.stubGlobal('GM_setValue', () => { throw new Error('quota'); });
    const { s } = await load();
    expect(gmStore.get(KEY)).toBe(OLD);
    expect(marker()).toBeNull();
    expect(local.has(KEY)).toBe(false);
    expect(s.storage.get(KEY, null)).toEqual({ v: 2 });
  });

  it('modern GM: awaits the async reads and pushes', async () => {
    stubNoGm();
    const gm = {
      getValue: async (k: string, d: unknown) => (gmStore.has(k) ? gmStore.get(k) : d),
      setValue: async (k: string, v: string) => { await Promise.resolve(); gmSets.push(k); gmStore.set(k, v); },
      deleteValue: async (k: string) => { gmStore.delete(k); },
      listValues: async () => [...gmStore.keys()],
    };
    vi.stubGlobal('GM', gm);
    gmStore.set(KEY, OLD);
    writtenWithoutGm(KEY, NEW, 2000);
    const { s } = await load();
    expect(s.getStorageRuntime()).toBe('modern-gm');
    expect(gmStore.get(KEY)).toBe(NEW);
    expect(marker()?.stamps).toEqual({ [KEY]: 2000 });
    expect(local.has(KEY)).toBe(false);
  });
});

describe('storage reconcile does nothing', () => {
  it('under the local-storage runtime', async () => {
    stubNoGm();
    writtenWithoutGm(KEY, NEW, 2000);
    const { s } = await load();
    expect(s.getStorageRuntime()).toBe('local-storage');
    expect(local.get(KEY)).toBe(NEW);
    const { reconcileGmStore } = await import('./storageReconcile');
    expect(await reconcileGmStore(null, () => true)).toBe(0);
  });

  it('when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    gmStore.set(KEY, OLD);
    local.set(KEY, NEW);
    await load();
    expect(gmStore.get(KEY)).toBe(OLD);
    expect(gmSets).toEqual([]);
  });
});
