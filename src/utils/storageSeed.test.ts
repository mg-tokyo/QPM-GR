import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_RECONCILE_KEY } from './storageKeys';
import { fakeIndexedDb, fakeLocalStorage, type FakeMirrorRow } from './storageTestFakes';

const WEB = 'https://magicgarden.gg';
const DISCORD = 'https://1227719606223765687.discordsays.com';
const KEY = 'qpm.test.setting';
const OTHER = 'qpm.test.other';
const THIRD = 'qpm.test.third';
const UNSTAMPED = 'qpm.test.unstamped';
const OLD = JSON.stringify({ v: 1 });
const NEW = JSON.stringify({ v: 2 });

let idbRows: Map<string, FakeMirrorRow>;
let gmStore: Map<string, string>;
let gmSets: string[];

function stubLegacyGm(withList = true): void {
  vi.stubGlobal('GM_getValue', (k: string) => gmStore.get(k));
  vi.stubGlobal('GM_setValue', (k: string, v: string) => { gmSets.push(k); gmStore.set(k, v); });
  vi.stubGlobal('GM_deleteValue', (k: string) => { gmStore.delete(k); });
  vi.stubGlobal('GM_listValues', withList ? () => [...gmStore.keys()] : undefined);
  vi.stubGlobal('GM', undefined);
}

function row(key: string, raw: string, savedAt: number): void {
  idbRows.set(key, { key, raw, savedAt });
}

function marker(): { v: number; origins: string[]; stamps: Record<string, number> } | null {
  const raw = gmStore.get(STORAGE_RECONCILE_KEY);
  return raw == null ? null : JSON.parse(raw);
}

async function loadAt(origin: string): Promise<typeof import('./storage')> {
  vi.stubGlobal('location', { origin });
  vi.resetModules();
  const s = await import('./storage');
  await s.initializeStorage();
  return s;
}

beforeEach(() => {
  idbRows = new Map();
  gmStore = new Map();
  gmSets = [];
  vi.stubGlobal('indexedDB', fakeIndexedDb(idbRows));
  vi.stubGlobal('localStorage', fakeLocalStorage(new Map()));
  stubLegacyGm();
});

describe('storage seed of a new GM store', () => {
  it('copies every mirror value row into a fresh store and stamps each', async () => {
    row(KEY, NEW, 2000);
    row(OTHER, OLD, 1500);
    idbRows.set(THIRD, { key: THIRD, raw: '', savedAt: 1700, deleted: true });
    idbRows.set('unrelated.key', { key: 'unrelated.key', raw: OLD, savedAt: 1800 });
    const s = await loadAt(WEB);
    expect(gmStore.get(KEY)).toBe(NEW);
    expect(gmStore.get(OTHER)).toBe(OLD);
    expect(gmStore.has(THIRD)).toBe(false);
    expect(gmStore.has('unrelated.key')).toBe(false);
    expect(marker()).toEqual({ v: 1, origins: [WEB], stamps: { [KEY]: 2000, [OTHER]: 1500 } });
    expect(await s.readDurable(KEY, null)).toEqual({ v: 2 });
  });

  it('a second init on the seeding origin is a no-op', async () => {
    row(KEY, NEW, 2000);
    await loadAt(WEB);
    gmSets = [];
    await loadAt(WEB);
    expect(gmSets).toEqual([]);
  });

  it('a second origin adds only keys the store lacks or holds older than their stamp', async () => {
    gmStore.set(KEY, OLD);
    gmStore.set(OTHER, OLD);
    gmStore.set(UNSTAMPED, OLD);
    gmStore.set(STORAGE_RECONCILE_KEY, JSON.stringify({ v: 1, origins: [WEB], stamps: { [KEY]: 2000, [OTHER]: 3000 } }));
    row(KEY, NEW, 2500); // newer than its stamp: pushed
    row(OTHER, NEW, 2500); // older than its stamp: kept
    row(THIRD, NEW, 100); // the store lacks it: pushed
    row(UNSTAMPED, NEW, 9000); // the store holds it with no stamp: kept
    await loadAt(DISCORD);
    expect(gmStore.get(KEY)).toBe(NEW);
    expect(gmStore.get(OTHER)).toBe(OLD);
    expect(gmStore.get(THIRD)).toBe(NEW);
    expect(gmStore.get(UNSTAMPED)).toBe(OLD);
    expect(marker()).toEqual({
      v: 1,
      origins: [WEB, DISCORD],
      stamps: { [KEY]: 2500, [OTHER]: 3000, [THIRD]: 100 },
    });
    gmSets = [];
    await loadAt(DISCORD);
    expect(gmSets).toEqual([]);
  });

  it('a second origin with nothing to add still records itself', async () => {
    gmStore.set(KEY, NEW);
    gmStore.set(STORAGE_RECONCILE_KEY, JSON.stringify({ v: 1, origins: [WEB], stamps: { [KEY]: 2000 } }));
    row(KEY, NEW, 2000);
    await loadAt(DISCORD);
    expect(gmSets).toEqual([STORAGE_RECONCILE_KEY]);
    expect(marker()?.origins).toEqual([WEB, DISCORD]);
  });

  it('never seeds a store that has QPM keys but no marker', async () => {
    gmStore.set(OTHER, OLD);
    row(KEY, NEW, 2000);
    await loadAt(WEB);
    expect(gmStore.has(KEY)).toBe(false);
    expect(gmSets).toEqual([]);
    expect(marker()).toBeNull();
  });

  it('treats a reconcile marker with no origins as an existing install', async () => {
    gmStore.set(STORAGE_RECONCILE_KEY, JSON.stringify({ v: 1, origins: [], stamps: {} }));
    row(KEY, NEW, 2000);
    await loadAt(WEB);
    expect(gmStore.has(KEY)).toBe(false);
    expect(gmSets).toEqual([]);
  });

  it('never seeds when listValues is unavailable', async () => {
    stubLegacyGm(false);
    row(KEY, NEW, 2000);
    await loadAt(WEB);
    expect(gmStore.has(KEY)).toBe(false);
    expect(marker()).toBeNull();
  });

  it('ignores non-QPM keys when deciding the store is fresh', async () => {
    gmStore.set('someOtherMod.key', OLD);
    row(KEY, NEW, 2000);
    await loadAt(WEB);
    expect(gmStore.get(KEY)).toBe(NEW);
    expect(marker()?.origins).toEqual([WEB]);
  });

  it('runs before the T7 pass, which then finds the candidate already stamped', async () => {
    row(KEY, NEW, 2000);
    const local = new Map([[KEY, NEW]]);
    vi.stubGlobal('localStorage', fakeLocalStorage(local));
    await loadAt(WEB);
    expect(gmSets.filter((k) => k === KEY)).toHaveLength(1);
    expect(marker()).toEqual({ v: 1, origins: [WEB], stamps: { [KEY]: 2000 } });
    expect(local.has(KEY)).toBe(false);
  });

  it('modern GM: seeds through the async API', async () => {
    for (const name of ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues']) vi.stubGlobal(name, undefined);
    vi.stubGlobal('GM', {
      getValue: async (k: string, d: unknown) => (gmStore.has(k) ? gmStore.get(k) : d),
      setValue: async (k: string, v: string) => { gmSets.push(k); gmStore.set(k, v); },
      deleteValue: async (k: string) => { gmStore.delete(k); },
      listValues: async () => [...gmStore.keys()],
    });
    row(KEY, NEW, 2000);
    const s = await loadAt(WEB);
    expect(s.getStorageRuntime()).toBe('modern-gm');
    expect(gmStore.get(KEY)).toBe(NEW);
    expect(marker()?.stamps).toEqual({ [KEY]: 2000 });
  });

  it('does nothing without IndexedDB or without a GM backend', async () => {
    vi.stubGlobal('indexedDB', undefined);
    row(KEY, NEW, 2000);
    await loadAt(WEB);
    expect(gmSets).toEqual([]);
    const { seedGmStore } = await import('./storageReconcile');
    expect(await seedGmStore(null, () => true, WEB)).toBe(0);
  });
});
