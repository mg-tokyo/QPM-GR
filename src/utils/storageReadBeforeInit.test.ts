import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIndexedDb, fakeLocalStorage, type FakeMirrorRow } from './storageTestFakes';

// The bundle evaluates every module before initializeStorage (one IIFE), and until the mirror
// hydrates, storage.get under a GM runtime returns the GM copy. Each case loads the module first,
// as the bundle does, with GM holding an older value than the mirror, then reads it after init.

let idbRows: Map<string, FakeMirrorRow>;
let gmStore: Map<string, string>;

beforeEach(() => {
  idbRows = new Map();
  gmStore = new Map();
  vi.stubGlobal('indexedDB', fakeIndexedDb(idbRows));
  vi.stubGlobal('localStorage', fakeLocalStorage(new Map()));
  vi.stubGlobal('GM_getValue', (k: string) => gmStore.get(k));
  vi.stubGlobal('GM_setValue', (k: string, v: string) => { gmStore.set(k, v); });
  vi.stubGlobal('GM_deleteValue', (k: string) => { gmStore.delete(k); });
  vi.stubGlobal('GM_listValues', () => [...gmStore.keys()]);
  vi.stubGlobal('GM', undefined);
  // utils/dom/dom.ts reads document.readyState at import (sellAll's and inventoryCapacity's graphs).
  vi.stubGlobal('document', { readyState: 'complete', hidden: false, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} });
  vi.resetModules();
});

interface Case<M> {
  key: string;
  gm: unknown;
  mirror: unknown;
  load: () => Promise<M>;
  read: (mod: M) => unknown;
  expected: unknown;
}

function stagedCase<M>(c: Case<M>): () => Promise<void> {
  return async () => {
    gmStore.set(c.key, JSON.stringify(c.gm));
    idbRows.set(c.key, { key: c.key, raw: JSON.stringify(c.mirror), savedAt: 2000 });

    const mod = await c.load();
    const s = await import('./storage');
    await s.initializeStorage();
    expect(c.read(mod)).toEqual(c.expected);
    expect(s.storageReadsBeforeInit()).not.toContain(c.key);
  };
}

describe('a module loaded before storage init reads the mirror, not an older GM value', () => {
  it('locker config', stagedCase({
    key: 'qpm.locker.config.v1',
    gm: { petSellGuard: false },
    mirror: { petSellGuard: true },
    load: () => import('../features/locker/state'),
    read: (m) => m.getLockerConfig().petSellGuard,
    expected: true,
  }));

  it('garden QOL config', stagedCase({
    key: 'qpm.gardenQol.config.v1',
    gm: { ariesHold: false },
    mirror: { ariesHold: true },
    load: () => import('../features/gardenQol/state'),
    read: (m) => m.getGardenQolConfig().ariesHold,
    expected: true,
  }));

  it('inventory capacity config', stagedCase({
    key: 'qpm.inventoryCapacity.v1',
    gm: { enabled: true },
    mirror: { enabled: false },
    load: () => import('../features/economy/inventoryCapacity'),
    read: (m) => m.getInventoryCapacityConfig().enabled,
    expected: false,
  }));

  it('pet food rules', stagedCase({
    key: 'quinoa-pet-food-rules',
    gm: { avoidFavorited: true, overrides: {} },
    mirror: { avoidFavorited: false, overrides: {} },
    load: () => import('../features/pets/foodRules/rules'),
    read: (m) => m.getPetFoodRules().avoidFavorited,
    expected: false,
  }));

  it('sell-all pets settings', stagedCase({
    key: 'qpm.petTeams.sellAllPets.v1',
    gm: { keybind: 'j' },
    mirror: { keybind: 'k' },
    load: () => import('../features/pets/sellAll'),
    read: (m) => m.getSellAllPetsSettings().keybind,
    expected: 'k',
  }));

  it('bulk favorite config', stagedCase({
    key: 'qpm.bulkFavorite.v1',
    gm: { enabled: true },
    mirror: { enabled: false },
    load: () => import('../features/standalone/bulkFavorite/state'),
    read: (m) => m.configRef.current.enabled,
    expected: false,
  }));
});

describe('storageReadsBeforeInit', () => {
  it('records a get issued before init and nothing after', async () => {
    gmStore.set('qpm.test.early', JSON.stringify({ v: 1 }));
    idbRows.set('qpm.test.early', { key: 'qpm.test.early', raw: JSON.stringify({ v: 2 }), savedAt: 2000 });
    const s = await import('./storage');
    expect(s.storage.get('qpm.test.early', null)).toEqual({ v: 1 });
    await s.initializeStorage();
    expect(s.storage.get('qpm.test.early', null)).toEqual({ v: 2 });
    s.storage.get('qpm.test.late', null);
    expect(s.storageReadsBeforeInit()).toEqual(['qpm.test.early']);
  });
});
