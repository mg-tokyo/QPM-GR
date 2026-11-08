import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../store/shopRegistry', () => ({
  getKnownShopIds: () => ['seeds', 'eggs', 'tools', 'decor'],
  isStandardShop: () => true,
}));

const gatedCategories = new Set<string>();
const buckets = new Map<string, unknown>();
const categories: Record<string, unknown> = {};
vi.mock('../../../store/shopStock', () => ({
  getShopStockState: () => ({ updatedAt: 0, categories }),
  getPurchaseBucket: (category: string) => buckets.get(category) ?? null,
  isCategoryGated: (category: string) => gatedCategories.has(category),
}));

let serverNow: number | null = 2_000;
vi.mock('../../../store/serverClock', () => ({ getServerNowMs: () => serverNow }));

const { buildCycleEntry, readCycleView, summarizeCycles } = await import('./cycleView');

const EGG = { restockId: 'egg:2', startedAtMs: 1_000, deadlineMs: 301_000, inventory: [] };

describe('cycle view', () => {
  it('classifies the bucket against the shop cycle like the game', () => {
    expect(buildCycleEntry(EGG, { restockId: 'egg:2', startedAtMs: 1_000, purchases: {} }, false, 3, 2_000)).toEqual({
      restockId: 'egg:2', startedAtMs: 1_000, deadlineMs: 301_000, serverNowMs: 2_000,
      gated: false, bucketRestockId: 'egg:2', classification: 'current', available: 3,
    });
    expect(buildCycleEntry(EGG, { restockId: 'egg:1', startedAtMs: 500 }, false, 3, null).classification).toBe('stale');
    expect(buildCycleEntry(EGG, { restockId: 'egg:3', startedAtMs: 9_000 }, false, 0, null).classification).toBe('ahead');
    expect(buildCycleEntry(EGG, null, false, 3, null)).toMatchObject({ bucketRestockId: null, classification: 'none' });
  });

  it('reports unknown shop fields as null', () => {
    expect(buildCycleEntry(null, null, false, 0, null)).toMatchObject({ restockId: null, startedAtMs: null, deadlineMs: null });
  });

  it('builds one entry per known shop keyed by the game shop id, with the store gate flag', () => {
    categories.eggs = { raw: EGG, availableCount: 0 };
    gatedCategories.add('eggs');
    buckets.set('eggs', { restockId: 'egg:2', startedAtMs: 1_000, purchases: { CommonEgg: 1 } });
    const view = readCycleView();
    expect(Object.keys(view).sort()).toEqual(['decor', 'egg', 'seed', 'tool']);
    expect(view.egg).toMatchObject({ gated: true, classification: 'current', serverNowMs: 2_000, available: 0 });
    expect(view.seed).toMatchObject({ restockId: null, classification: 'none', gated: false });
  });

  it('summarizes only the requested shops, sorted, with the gate marked', () => {
    serverNow = null;
    const view = readCycleView();
    expect(summarizeCycles(view, ['egg', 'seed', 'egg', 'weather'])).toEqual(['egg:current:gated', 'seed:none']);
    expect(summarizeCycles(view, [])).toEqual([]);
  });
});
