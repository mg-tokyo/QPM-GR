export type ShopCategoryKey = 'seeds' | 'eggs' | 'tools' | 'decor' | 'dawn';

export interface FeedEntry {
  count: number;
  lastFeedAt: number | null;
}

export interface ShopItemEntry {
  count: number;
  coins: number;
  credits: number;
  magicDust: number;
  lastPurchasedAt: number;
}

export interface ShopHistoryRow {
  itemName: string;
  category: ShopCategoryKey;
  count: number;
  coins: number;
  credits: number;
  magicDust: number;
  timestamp: number;
  success: boolean;
  failureReason?: string;
}

export interface StatsSnapshot {
  feed: {
    totalFeeds: number;
    perPet: Record<string, FeedEntry>;
    lastFeedAt: number | null;
    sessionStart: number;
  };
  weather: {
    timeByKind: Record<string, number>;
    activeKind: string;
  };
  shop: {
    totalPurchases: number;
    totalSpentCoins: number;
    totalSpentCredits: number;
    totalSpentMagicDust: number;
    purchasesByCategory: Record<ShopCategoryKey, number>;
    items: Record<string, ShopItemEntry>;
    history: ShopHistoryRow[];
    lastPurchase: {
      itemName: string;
      category: ShopCategoryKey;
      count: number;
      coins: number;
      credits: number;
      magicDust: number;
      timestamp: number;
    } | null;
  };
  garden: {
    totalPlanted: number;
    totalHarvested: number;
    totalDestroyed: number;
    totalWateringCans: number;
    lastPlantedAt: number | null;
    lastHarvestedAt: number | null;
    lastDestroyedAt: number | null;
    lastWateredAt: number | null;
  };
  pets: {
    totalHatched: number;
    hatchedByRarity: {
      normal: number;
      gold: number;
      rainbow: number;
    };
    lastHatchedAt: number | null;
    lastHatchedRarity: 'normal' | 'gold' | 'rainbow' | null;
  };
  abilities: {
    totalProcs: number;
    totalEstimatedValue: number; // Sum of all ability values in coins
    procsByAbility: Record<string, number>; // abilityId -> count
    valueByAbility: Record<string, number>; // abilityId -> estimated total value
    lastProcAt: number | null;
    lastProcAbility: string | null;
  };
  meta: {
    initializedAt: number;
    updatedAt: number;
    version: number;
  };
}

export interface StatsState extends StatsSnapshot {
  weather: StatsSnapshot['weather'] & {
    lastSnapshotAt: number;
  };
}

export const MAX_SHOP_ITEMS = 40;
export const MAX_HISTORY = 1000;
const SHOP_CATEGORIES: readonly ShopCategoryKey[] = ['seeds', 'eggs', 'tools', 'decor', 'dawn'];

export function createDefaultStatsState(now: number): StatsState {
  return {
    feed: { totalFeeds: 0, perPet: {}, lastFeedAt: null, sessionStart: now },
    weather: { timeByKind: {}, activeKind: 'unknown', lastSnapshotAt: now },
    shop: {
      totalPurchases: 0,
      totalSpentCoins: 0,
      totalSpentCredits: 0,
      totalSpentMagicDust: 0,
      purchasesByCategory: { seeds: 0, eggs: 0, tools: 0, decor: 0, dawn: 0 },
      items: {},
      history: [],
      lastPurchase: null,
    },
    garden: {
      totalPlanted: 0,
      totalHarvested: 0,
      totalDestroyed: 0,
      totalWateringCans: 0,
      lastPlantedAt: null,
      lastHarvestedAt: null,
      lastDestroyedAt: null,
      lastWateredAt: null,
    },
    pets: {
      totalHatched: 0,
      hatchedByRarity: { normal: 0, gold: 0, rainbow: 0 },
      lastHatchedAt: null,
      lastHatchedRarity: null,
    },
    abilities: {
      totalProcs: 0,
      totalEstimatedValue: 0,
      procsByAbility: {},
      valueByAbility: {},
      lastProcAt: null,
      lastProcAbility: null,
    },
    meta: { initializedAt: now, updatedAt: now, version: 1 },
  };
}

type Rec = Record<string, unknown>;
const asRec = (value: unknown): Rec | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : null;
const num = (value: unknown): number => Number(value ?? 0);
const tsOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const category = (value: unknown): ShopCategoryKey =>
  (typeof value === 'string' && value ? value : 'seeds') as ShopCategoryKey;

function normalizeHistoryRow(raw: unknown, now: number): ShopHistoryRow | null {
  const row = asRec(raw);
  if (!row) return null;
  const out: ShopHistoryRow = {
    itemName: typeof row.itemName === 'string' ? row.itemName : 'Unknown Item',
    category: category(row.category),
    count: num(row.count),
    coins: num(row.coins),
    credits: num(row.credits),
    magicDust: num(row.magicDust),
    timestamp: typeof row.timestamp === 'number' ? row.timestamp : now,
    success: typeof row.success === 'boolean' ? row.success : true, // old entries predate the flag
  };
  if (typeof row.failureReason === 'string') out.failureReason = row.failureReason;
  return out;
}

function normalizeFeed(base: StatsState, feed: Rec): void {
  base.feed.totalFeeds = num(feed.totalFeeds);
  base.feed.lastFeedAt = tsOrNull(feed.lastFeedAt);
  if (typeof feed.sessionStart === 'number') base.feed.sessionStart = feed.sessionStart;
  for (const [key, value] of Object.entries(asRec(feed.perPet) ?? {})) {
    const entry = asRec(value);
    if (!entry) continue;
    base.feed.perPet[key] = { count: num(entry.count), lastFeedAt: tsOrNull(entry.lastFeedAt) };
  }
}

function normalizeShop(base: StatsState, shop: Rec, now: number): void {
  base.shop.totalPurchases = num(shop.totalPurchases);
  base.shop.totalSpentCoins = num(shop.totalSpentCoins);
  base.shop.totalSpentCredits = num(shop.totalSpentCredits);
  base.shop.totalSpentMagicDust = num(shop.totalSpentMagicDust);
  const byCategory = asRec(shop.purchasesByCategory);
  if (byCategory) {
    for (const key of SHOP_CATEGORIES) base.shop.purchasesByCategory[key] = num(byCategory[key]);
  }
  for (const [item, value] of Object.entries(asRec(shop.items) ?? {})) {
    const entry = asRec(value);
    if (!entry) continue;
    base.shop.items[item] = {
      count: num(entry.count),
      coins: num(entry.coins),
      credits: num(entry.credits),
      magicDust: num(entry.magicDust),
      lastPurchasedAt: typeof entry.lastPurchasedAt === 'number' ? entry.lastPurchasedAt : now,
    };
  }
  if (Array.isArray(shop.history)) {
    base.shop.history = shop.history
      .map((row: unknown) => normalizeHistoryRow(row, now))
      .filter((row): row is ShopHistoryRow => row !== null)
      .slice(-MAX_HISTORY);
  }
  const last = asRec(shop.lastPurchase);
  if (last) {
    base.shop.lastPurchase = {
      itemName: typeof last.itemName === 'string' ? last.itemName : 'Unknown Item',
      category: category(last.category),
      count: num(last.count),
      coins: num(last.coins),
      credits: num(last.credits),
      magicDust: num(last.magicDust),
      timestamp: typeof last.timestamp === 'number' ? last.timestamp : now,
    };
  }
}

function normalizeRest(base: StatsState, stored: Rec): void {
  const garden = asRec(stored.garden);
  if (garden) {
    base.garden.totalPlanted = num(garden.totalPlanted);
    base.garden.totalHarvested = num(garden.totalHarvested);
    base.garden.totalDestroyed = num(garden.totalDestroyed);
    base.garden.totalWateringCans = num(garden.totalWateringCans);
    base.garden.lastPlantedAt = tsOrNull(garden.lastPlantedAt);
    base.garden.lastHarvestedAt = tsOrNull(garden.lastHarvestedAt);
    base.garden.lastDestroyedAt = tsOrNull(garden.lastDestroyedAt);
    base.garden.lastWateredAt = tsOrNull(garden.lastWateredAt);
  }
  const pets = asRec(stored.pets);
  if (pets) {
    base.pets.totalHatched = num(pets.totalHatched);
    const rarity = asRec(pets.hatchedByRarity);
    if (rarity) {
      base.pets.hatchedByRarity = { normal: num(rarity.normal), gold: num(rarity.gold), rainbow: num(rarity.rainbow) };
    }
    base.pets.lastHatchedAt = tsOrNull(pets.lastHatchedAt);
    const r = pets.lastHatchedRarity;
    base.pets.lastHatchedRarity = r === 'normal' || r === 'gold' || r === 'rainbow' ? r : null;
  }
  const abilities = asRec(stored.abilities);
  if (abilities) {
    base.abilities.totalProcs = num(abilities.totalProcs);
    base.abilities.totalEstimatedValue = num(abilities.totalEstimatedValue);
    for (const [id, count] of Object.entries(asRec(abilities.procsByAbility) ?? {})) base.abilities.procsByAbility[id] = num(count);
    for (const [id, value] of Object.entries(asRec(abilities.valueByAbility) ?? {})) base.abilities.valueByAbility[id] = num(value);
    base.abilities.lastProcAt = tsOrNull(abilities.lastProcAt);
    base.abilities.lastProcAbility = typeof abilities.lastProcAbility === 'string' ? abilities.lastProcAbility : null;
  }
  const meta = asRec(stored.meta);
  if (meta) {
    if (typeof meta.updatedAt === 'number') base.meta.updatedAt = meta.updatedAt;
    if (typeof meta.version === 'number') base.meta.version = meta.version;
  }
}

/** A stored copy → full state, or `undefined` when `raw` holds no copy. */
export function normalizeStats(raw: unknown, now = Date.now()): StatsState | undefined {
  const stored = asRec(raw);
  if (!stored) return undefined;
  const meta = asRec(stored.meta);
  const base = createDefaultStatsState(typeof meta?.initializedAt === 'number' ? meta.initializedAt : now);
  const feed = asRec(stored.feed);
  if (feed) normalizeFeed(base, feed);
  const weather = asRec(stored.weather);
  if (weather) {
    if (typeof weather.activeKind === 'string') base.weather.activeKind = weather.activeKind;
    base.weather.lastSnapshotAt = typeof weather.lastSnapshotAt === 'number' ? weather.lastSnapshotAt : now;
    for (const [kind, value] of Object.entries(asRec(weather.timeByKind) ?? {})) base.weather.timeByKind[kind] = num(value);
  }
  const shop = asRec(stored.shop);
  if (shop) normalizeShop(base, shop, now);
  normalizeRest(base, stored);
  return base;
}

export function pruneShopItems(items: Record<string, ShopItemEntry>): void {
  const entries = Object.entries(items);
  if (entries.length <= MAX_SHOP_ITEMS) return;
  entries.sort((a, b) => (a[1].lastPurchasedAt ?? 0) - (b[1].lastPurchasedAt ?? 0));
  const excess = entries.length - MAX_SHOP_ITEMS;
  for (let i = 0; i < excess; i++) delete items[entries[i]![0]];
}

/** Tracks whether a merge took anything from `b`; meta alone never counts. */
interface MergeCtx { changed: boolean }

function maxN(ctx: MergeCtx, a: number, b: number): number {
  if (b > a) { ctx.changed = true; return b; }
  return a;
}

function maxTs(ctx: MergeCtx, a: number | null, b: number | null): number | null {
  if (b !== null && (a === null || b > a)) { ctx.changed = true; return b; }
  return a;
}

function maxMap(ctx: MergeCtx, a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = maxN(ctx, out[key] ?? 0, value);
  for (const key of Object.keys(b)) if (!(key in a)) ctx.changed = true;
  return out;
}

const historyId = (row: ShopHistoryRow): string =>
  [row.timestamp, row.itemName, row.category, row.count, row.coins, row.credits, row.magicDust, row.success].join('\u0000');

function mergeHistory(ctx: MergeCtx, a: ShopHistoryRow[], b: ShopHistoryRow[]): ShopHistoryRow[] {
  const seen = new Set(a.map(historyId));
  const extra = b.filter((row) => !seen.has(historyId(row)));
  if (extra.length === 0) return a;
  ctx.changed = true;
  const merged = [...a, ...extra].sort((x, y) => x.timestamp - y.timestamp);
  return merged.length > MAX_HISTORY ? merged.slice(merged.length - MAX_HISTORY) : merged;
}

function mergeShop(ctx: MergeCtx, a: StatsState['shop'], b: StatsState['shop']): StatsState['shop'] {
  const items: Record<string, ShopItemEntry> = { ...a.items };
  for (const [name, entry] of Object.entries(b.items)) {
    const mine = items[name];
    if (!mine) { ctx.changed = true; items[name] = { ...entry }; continue; }
    items[name] = {
      count: maxN(ctx, mine.count, entry.count),
      coins: maxN(ctx, mine.coins, entry.coins),
      credits: maxN(ctx, mine.credits, entry.credits),
      magicDust: maxN(ctx, mine.magicDust, entry.magicDust),
      lastPurchasedAt: maxN(ctx, mine.lastPurchasedAt, entry.lastPurchasedAt),
    };
  }
  pruneShopItems(items);
  const bLater = b.lastPurchase !== null && (a.lastPurchase === null || b.lastPurchase.timestamp > a.lastPurchase.timestamp);
  if (bLater) ctx.changed = true;
  return {
    totalPurchases: maxN(ctx, a.totalPurchases, b.totalPurchases),
    totalSpentCoins: maxN(ctx, a.totalSpentCoins, b.totalSpentCoins),
    totalSpentCredits: maxN(ctx, a.totalSpentCredits, b.totalSpentCredits),
    totalSpentMagicDust: maxN(ctx, a.totalSpentMagicDust, b.totalSpentMagicDust),
    purchasesByCategory: maxMap(ctx, a.purchasesByCategory, b.purchasesByCategory) as Record<ShopCategoryKey, number>,
    items,
    history: mergeHistory(ctx, a.history, b.history),
    lastPurchase: bLater && b.lastPurchase ? { ...b.lastPurchase } : a.lastPurchase,
  };
}

function mergeFeed(ctx: MergeCtx, a: StatsState['feed'], b: StatsState['feed']): StatsState['feed'] {
  const perPet: Record<string, FeedEntry> = { ...a.perPet };
  for (const [name, entry] of Object.entries(b.perPet)) {
    const mine = perPet[name];
    if (!mine) { ctx.changed = true; perPet[name] = { ...entry }; continue; }
    perPet[name] = { count: maxN(ctx, mine.count, entry.count), lastFeedAt: maxTs(ctx, mine.lastFeedAt, entry.lastFeedAt) };
  }
  return {
    totalFeeds: maxN(ctx, a.totalFeeds, b.totalFeeds),
    perPet,
    lastFeedAt: maxTs(ctx, a.lastFeedAt, b.lastFeedAt),
    sessionStart: a.sessionStart,
  };
}

/**
 * PD3 (2026-11-11): per-field max, never a sum: the player-scoped helper merges a copy with itself
 * (local vs GM scoped copy, one localStorage row read as site and shared legacy). Returns `a` itself when `b` adds nothing.
 */
export function mergeStats(a: StatsState, b: StatsState): StatsState {
  const ctx: MergeCtx = { changed: false };
  const bLaterHatch = b.pets.lastHatchedAt !== null && (a.pets.lastHatchedAt === null || b.pets.lastHatchedAt > a.pets.lastHatchedAt);
  const bLaterProc = b.abilities.lastProcAt !== null && (a.abilities.lastProcAt === null || b.abilities.lastProcAt > a.abilities.lastProcAt);
  const merged: StatsState = {
    feed: mergeFeed(ctx, a.feed, b.feed),
    weather: { ...a.weather, timeByKind: maxMap(ctx, a.weather.timeByKind, b.weather.timeByKind) },
    shop: mergeShop(ctx, a.shop, b.shop),
    garden: {
      totalPlanted: maxN(ctx, a.garden.totalPlanted, b.garden.totalPlanted),
      totalHarvested: maxN(ctx, a.garden.totalHarvested, b.garden.totalHarvested),
      totalDestroyed: maxN(ctx, a.garden.totalDestroyed, b.garden.totalDestroyed),
      totalWateringCans: maxN(ctx, a.garden.totalWateringCans, b.garden.totalWateringCans),
      lastPlantedAt: maxTs(ctx, a.garden.lastPlantedAt, b.garden.lastPlantedAt),
      lastHarvestedAt: maxTs(ctx, a.garden.lastHarvestedAt, b.garden.lastHarvestedAt),
      lastDestroyedAt: maxTs(ctx, a.garden.lastDestroyedAt, b.garden.lastDestroyedAt),
      lastWateredAt: maxTs(ctx, a.garden.lastWateredAt, b.garden.lastWateredAt),
    },
    pets: {
      totalHatched: maxN(ctx, a.pets.totalHatched, b.pets.totalHatched),
      hatchedByRarity: {
        normal: maxN(ctx, a.pets.hatchedByRarity.normal, b.pets.hatchedByRarity.normal),
        gold: maxN(ctx, a.pets.hatchedByRarity.gold, b.pets.hatchedByRarity.gold),
        rainbow: maxN(ctx, a.pets.hatchedByRarity.rainbow, b.pets.hatchedByRarity.rainbow),
      },
      lastHatchedAt: maxTs(ctx, a.pets.lastHatchedAt, b.pets.lastHatchedAt),
      lastHatchedRarity: bLaterHatch ? b.pets.lastHatchedRarity : a.pets.lastHatchedRarity,
    },
    abilities: {
      totalProcs: maxN(ctx, a.abilities.totalProcs, b.abilities.totalProcs),
      totalEstimatedValue: maxN(ctx, a.abilities.totalEstimatedValue, b.abilities.totalEstimatedValue),
      procsByAbility: maxMap(ctx, a.abilities.procsByAbility, b.abilities.procsByAbility),
      valueByAbility: maxMap(ctx, a.abilities.valueByAbility, b.abilities.valueByAbility),
      lastProcAt: maxTs(ctx, a.abilities.lastProcAt, b.abilities.lastProcAt),
      lastProcAbility: bLaterProc ? b.abilities.lastProcAbility : a.abilities.lastProcAbility,
    },
    meta: {
      initializedAt: Math.min(a.meta.initializedAt, b.meta.initializedAt),
      updatedAt: Math.max(a.meta.updatedAt, b.meta.updatedAt),
      version: Math.max(a.meta.version, b.meta.version),
    },
  };
  return ctx.changed ? merged : a;
}
