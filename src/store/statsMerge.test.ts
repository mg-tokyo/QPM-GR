import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, createDefaultStatsState, mergeStats, normalizeStats, type ShopHistoryRow, type StatsState } from './statsMerge';

function copy(edit: (s: StatsState) => void, now = 1000): StatsState {
  const s = createDefaultStatsState(now);
  edit(s);
  return s;
}

const row = (timestamp: number, itemName = 'Carrot'): ShopHistoryRow => ({
  itemName, category: 'seeds', count: 1, coins: 10, credits: 0, magicDust: 0, timestamp, success: true,
});

describe('normalizeStats', () => {
  it('returns undefined for no copy and fills defaults for a partial one', () => {
    expect(normalizeStats(null)).toBeUndefined();
    expect(normalizeStats('x')).toBeUndefined();
    expect(normalizeStats([1])).toBeUndefined();
    const s = normalizeStats({ weather: { timeByKind: { sunny: 5 } }, meta: { initializedAt: 7 } }, 50);
    expect(s?.weather.timeByKind).toEqual({ sunny: 5 });
    expect(s?.meta.initializedAt).toBe(7);
    expect(s?.shop.purchasesByCategory).toEqual({ seeds: 0, eggs: 0, tools: 0, decor: 0, dawn: 0 });
  });

  it('keeps history rows, defaults success to true and drops non-objects', () => {
    const s = normalizeStats({ shop: { history: [{ itemName: 'A', timestamp: 3 }, 4, null] } }, 50);
    expect(s?.shop.history).toEqual([{ itemName: 'A', category: 'seeds', count: 0, coins: 0, credits: 0, magicDust: 0, timestamp: 3, success: true }]);
  });
});

describe('mergeStats (PD3 per-field max)', () => {
  const live = copy((s) => {
    s.weather.timeByKind = { sunny: 100, rain: 20 };
    s.pets.totalHatched = 10;
    s.pets.hatchedByRarity.gold = 2;
    s.pets.lastHatchedAt = 50;
    s.pets.lastHatchedRarity = 'gold';
    s.shop.history = [row(1), row(2)];
    s.shop.totalPurchases = 2;
  });

  it('returns a itself when b adds nothing, including merging a copy with itself', () => {
    expect(mergeStats(live, live)).toBe(live);
    expect(mergeStats(live, structuredClone(live))).toBe(live);
    expect(mergeStats(live, createDefaultStatsState(1))).toBe(live);
  });

  it('never sums: repeated merges of the same copy keep the values', () => {
    const other = copy((s) => { s.weather.timeByKind = { sunny: 40, snow: 7 }; });
    const once = mergeStats(live, other);
    const twice = mergeStats(once, other);
    expect(once.weather.timeByKind).toEqual({ sunny: 100, rain: 20, snow: 7 });
    expect(twice).toBe(once);
  });

  it('takes the larger value per field and per key', () => {
    const other = copy((s) => {
      s.pets.totalHatched = 4;
      s.pets.hatchedByRarity.rainbow = 3;
      s.feed.totalFeeds = 9;
      s.feed.perPet = { Bee: { count: 9, lastFeedAt: 70 } };
      s.abilities.procsByAbility = { A: 2 };
      s.garden.totalHarvested = 5;
      s.garden.lastHarvestedAt = 80;
    });
    const m = mergeStats(live, other);
    expect(m.pets.totalHatched).toBe(10);
    expect(m.pets.hatchedByRarity).toEqual({ normal: 0, gold: 2, rainbow: 3 });
    expect(m.feed.totalFeeds).toBe(9);
    expect(m.feed.perPet.Bee).toEqual({ count: 9, lastFeedAt: 70 });
    expect(m.abilities.procsByAbility).toEqual({ A: 2 });
    expect(m.garden.totalHarvested).toBe(5);
    expect(m.garden.lastHarvestedAt).toBe(80);
  });

  it('takes last-hatch rarity and last purchase from the later copy', () => {
    const later = copy((s) => {
      s.pets.lastHatchedAt = 90;
      s.pets.lastHatchedRarity = 'rainbow';
      s.shop.lastPurchase = { itemName: 'Egg', category: 'eggs', count: 1, coins: 5, credits: 0, magicDust: 0, timestamp: 9 };
    });
    const m = mergeStats(live, later);
    expect(m.pets.lastHatchedRarity).toBe('rainbow');
    expect(m.shop.lastPurchase?.itemName).toBe('Egg');
    const earlier = copy((s) => { s.pets.lastHatchedAt = 10; s.pets.lastHatchedRarity = 'normal'; });
    expect(mergeStats(live, earlier).pets.lastHatchedRarity).toBe('gold');
  });

  it('unions shop history by row identity in time order, newest kept past the cap', () => {
    const other = copy((s) => { s.shop.history = [row(2), row(0, 'Bean'), row(3)]; });
    const m = mergeStats(live, other);
    expect(m.shop.history.map((r) => r.timestamp)).toEqual([0, 1, 2, 3]);
    const big = copy((s) => { s.shop.history = Array.from({ length: MAX_HISTORY }, (_, i) => row(100 + i)); });
    const capped = mergeStats(live, big);
    expect(capped.shop.history).toHaveLength(MAX_HISTORY);
    expect(capped.shop.history[0]?.timestamp).toBe(100);
  });

  it('keeps the earliest initializedAt only when something else changed', () => {
    const older = copy(() => {}, 5);
    expect(mergeStats(live, older)).toBe(live);
    const olderWithData = copy((s) => { s.garden.totalPlanted = 1; }, 5);
    expect(mergeStats(live, olderWithData).meta.initializedAt).toBe(5);
  });
});
