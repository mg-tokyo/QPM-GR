// src/store/stats.ts
import { storage } from '../utils/storage';
import { startWeatherHub, onWeatherSnapshot, getWeatherSnapshot, type WeatherSnapshot } from './weatherHub';
import { visibleInterval } from '../utils/timerManager';
export type ShopCategoryKey = 'seeds' | 'eggs' | 'tools' | 'decor' | 'dawn';

interface FeedEntry {
  count: number;
  lastFeedAt: number | null;
}

interface ShopItemEntry {
  count: number;
  coins: number;
  credits: number;
  magicDust: number;
  lastPurchasedAt: number;
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
    history: Array<{
      itemName: string;
      category: ShopCategoryKey;
      count: number;
      coins: number;
      credits: number;
      magicDust: number;
      timestamp: number;
      success: boolean;
      failureReason?: string;
    }>;
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

interface StatsState extends StatsSnapshot {
  weather: StatsSnapshot['weather'] & {
    lastSnapshotAt: number;
  };
}

const STORAGE_KEY = 'quinoa:stats:v1';
const SAVE_DEBOUNCE_MS = 1200;
const WEATHER_TICK_INTERVAL = 5000;
const MAX_SHOP_ITEMS = 40;
const MAX_HISTORY = 1000; // Store up to 1000 history entries

let state: StatsState;
let initialized = false;
let saveTimer: number | null = null;
let weatherUnsubscribe: (() => void) | null = null;
let weatherTickTimerCleanup: (() => void) | null = null;
let lastWeatherTickAt = Date.now();

const listeners = new Set<(snapshot: StatsSnapshot) => void>();

function createDefaultState(now: number): StatsState {
  return {
    feed: {
      totalFeeds: 0,
      perPet: {},
      lastFeedAt: null,
      sessionStart: now,
    },
    weather: {
      timeByKind: {},
      activeKind: 'unknown',
      lastSnapshotAt: now,
    },
    shop: {
      totalPurchases: 0,
      totalSpentCoins: 0,
      totalSpentCredits: 0,
      totalSpentMagicDust: 0,
      purchasesByCategory: {
        seeds: 0,
        eggs: 0,
        tools: 0,
        decor: 0,
        dawn: 0,
      },
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
      hatchedByRarity: {
        normal: 0,
        gold: 0,
        rainbow: 0,
      },
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
    meta: {
      initializedAt: now,
      updatedAt: now,
      version: 1,
    },
  };
}

function hydrateState(): StatsState {
  const now = Date.now();
  const stored = storage.get<Partial<StatsState> | null>(STORAGE_KEY, null);
  if (!stored || typeof stored !== 'object') {
    return createDefaultState(now);
  }

  const base = createDefaultState(stored.meta?.initializedAt ?? now);

  // Feed
  if (stored.feed) {
    base.feed.totalFeeds = Number(stored.feed.totalFeeds ?? base.feed.totalFeeds);
    base.feed.lastFeedAt = stored.feed.lastFeedAt ?? null;
    base.feed.sessionStart = stored.feed.sessionStart ?? base.feed.sessionStart;
    if (stored.feed.perPet && typeof stored.feed.perPet === 'object') {
      for (const [key, value] of Object.entries(stored.feed.perPet)) {
        const entry = value as FeedEntry;
        if (!entry) continue;
        base.feed.perPet[key] = {
          count: Number(entry.count ?? 0),
          lastFeedAt: entry.lastFeedAt ?? null,
        };
      }
    }
  }

  // Weather
  if (stored.weather) {
    base.weather.activeKind = stored.weather.activeKind ?? base.weather.activeKind;
    base.weather.lastSnapshotAt = stored.weather.lastSnapshotAt ?? now;

    if (stored.weather.timeByKind && typeof stored.weather.timeByKind === 'object') {
      for (const [kind, value] of Object.entries(stored.weather.timeByKind)) {
        base.weather.timeByKind[kind] = Number(value ?? 0);
      }
    }
  }

  // Shop
  if (stored.shop) {
    base.shop.totalPurchases = Number(stored.shop.totalPurchases ?? 0);
    base.shop.totalSpentCoins = Number(stored.shop.totalSpentCoins ?? 0);
    base.shop.totalSpentCredits = Number(stored.shop.totalSpentCredits ?? 0);
    base.shop.totalSpentMagicDust = Number((stored.shop as Record<string, unknown>).totalSpentMagicDust ?? 0);
    if (stored.shop.purchasesByCategory) {
      for (const key of ['seeds', 'eggs', 'tools', 'decor', 'dawn'] as ShopCategoryKey[]) {
        const value = stored.shop.purchasesByCategory[key];
        base.shop.purchasesByCategory[key] = Number(value ?? 0);
      }
    }
    if (stored.shop.items && typeof stored.shop.items === 'object') {
      for (const [item, entry] of Object.entries(stored.shop.items)) {
        const snapshot = entry as ShopItemEntry;
        if (!snapshot) continue;
        base.shop.items[item] = {
          count: Number(snapshot.count ?? 0),
          coins: Number(snapshot.coins ?? 0),
          credits: Number(snapshot.credits ?? 0),
          magicDust: Number((snapshot as unknown as Record<string, unknown>).magicDust ?? 0),
          lastPurchasedAt: snapshot.lastPurchasedAt ?? now,
        };
      }
    }
    if (Array.isArray(stored.shop.history)) {
      base.shop.history = stored.shop.history
        .map((row: any) => ({
          itemName: row.itemName,
          category: (row.category ?? 'seeds') as ShopCategoryKey,
          count: Number(row.count ?? 0),
          coins: Number(row.coins ?? 0),
          credits: Number(row.credits ?? 0),
          magicDust: Number(row.magicDust ?? 0),
          timestamp: row.timestamp ?? now,
          success: row.success ?? true, // backward compatibility: assume old entries were successful
          failureReason: row.failureReason,
        }))
        .slice(-MAX_HISTORY);
    }
    if (stored.shop.lastPurchase) {
      base.shop.lastPurchase = {
        itemName: stored.shop.lastPurchase.itemName,
        category: (stored.shop.lastPurchase.category ?? 'seeds') as ShopCategoryKey,
        count: Number(stored.shop.lastPurchase.count ?? 0),
        coins: Number(stored.shop.lastPurchase.coins ?? 0),
        credits: Number(stored.shop.lastPurchase.credits ?? 0),
        magicDust: Number((stored.shop.lastPurchase as Record<string, unknown>).magicDust ?? 0),
        timestamp: stored.shop.lastPurchase.timestamp ?? now,
      };
    }
  }

  // Garden
  if (stored.garden) {
    base.garden.totalPlanted = Number(stored.garden.totalPlanted ?? 0);
    base.garden.totalHarvested = Number(stored.garden.totalHarvested ?? 0);
    base.garden.totalDestroyed = Number(stored.garden.totalDestroyed ?? 0);
    base.garden.totalWateringCans = Number(stored.garden.totalWateringCans ?? 0);
    base.garden.lastPlantedAt = stored.garden.lastPlantedAt ?? null;
    base.garden.lastHarvestedAt = stored.garden.lastHarvestedAt ?? null;
    base.garden.lastDestroyedAt = stored.garden.lastDestroyedAt ?? null;
    base.garden.lastWateredAt = stored.garden.lastWateredAt ?? null;
  }

  // Pets
  if (stored.pets) {
    base.pets.totalHatched = Number(stored.pets.totalHatched ?? 0);
    if (stored.pets.hatchedByRarity) {
      base.pets.hatchedByRarity.normal = Number(stored.pets.hatchedByRarity.normal ?? 0);
      base.pets.hatchedByRarity.gold = Number(stored.pets.hatchedByRarity.gold ?? 0);
      base.pets.hatchedByRarity.rainbow = Number(stored.pets.hatchedByRarity.rainbow ?? 0);
    }
    base.pets.lastHatchedAt = stored.pets.lastHatchedAt ?? null;
    base.pets.lastHatchedRarity = stored.pets.lastHatchedRarity ?? null;
  }

  // Abilities
  if (stored.abilities) {
    base.abilities.totalProcs = Number(stored.abilities.totalProcs ?? 0);
    base.abilities.totalEstimatedValue = Number(stored.abilities.totalEstimatedValue ?? 0);
    if (stored.abilities.procsByAbility && typeof stored.abilities.procsByAbility === 'object') {
      for (const [abilityId, count] of Object.entries(stored.abilities.procsByAbility)) {
        base.abilities.procsByAbility[abilityId] = Number(count ?? 0);
      }
    }
    if (stored.abilities.valueByAbility && typeof stored.abilities.valueByAbility === 'object') {
      for (const [abilityId, value] of Object.entries(stored.abilities.valueByAbility)) {
        base.abilities.valueByAbility[abilityId] = Number(value ?? 0);
      }
    }
    base.abilities.lastProcAt = stored.abilities.lastProcAt ?? null;
    base.abilities.lastProcAbility = stored.abilities.lastProcAbility ?? null;
  }

  // Meta
  if (stored.meta) {
    base.meta.initializedAt = stored.meta.initializedAt ?? base.meta.initializedAt;
    base.meta.updatedAt = stored.meta.updatedAt ?? base.meta.updatedAt;
    base.meta.version = stored.meta.version ?? base.meta.version;
  }

  return base;
}

function ensureInitialized(): void {
  if (!initialized) {
    initializeStatsStore();
  }
}

function emitSnapshot(): void {
  const snapshot: StatsSnapshot = {
    feed: {
      totalFeeds: state.feed.totalFeeds,
      perPet: Object.fromEntries(
        Object.entries(state.feed.perPet).map(([key, value]) => [key, { ...value }])
      ),
      lastFeedAt: state.feed.lastFeedAt,
      sessionStart: state.feed.sessionStart,
    },
    weather: {
      timeByKind: { ...state.weather.timeByKind },
      activeKind: state.weather.activeKind,
    },
    shop: {
      totalPurchases: state.shop.totalPurchases,
      totalSpentCoins: state.shop.totalSpentCoins,
      totalSpentCredits: state.shop.totalSpentCredits,
      totalSpentMagicDust: state.shop.totalSpentMagicDust,
      purchasesByCategory: { ...state.shop.purchasesByCategory },
      items: Object.fromEntries(
        Object.entries(state.shop.items).map(([key, value]) => [key, { ...value }])
      ),
      history: state.shop.history.map((row) => ({ ...row })),
      lastPurchase: state.shop.lastPurchase ? { ...state.shop.lastPurchase } : null,
    },
    garden: {
      totalPlanted: state.garden.totalPlanted,
      totalHarvested: state.garden.totalHarvested,
      totalDestroyed: state.garden.totalDestroyed,
      totalWateringCans: state.garden.totalWateringCans,
      lastPlantedAt: state.garden.lastPlantedAt,
      lastHarvestedAt: state.garden.lastHarvestedAt,
      lastDestroyedAt: state.garden.lastDestroyedAt,
      lastWateredAt: state.garden.lastWateredAt,
    },
    pets: {
      totalHatched: state.pets.totalHatched,
      hatchedByRarity: { ...state.pets.hatchedByRarity },
      lastHatchedAt: state.pets.lastHatchedAt,
      lastHatchedRarity: state.pets.lastHatchedRarity,
    },
    abilities: {
      totalProcs: state.abilities.totalProcs,
      totalEstimatedValue: state.abilities.totalEstimatedValue,
      procsByAbility: { ...state.abilities.procsByAbility },
      valueByAbility: { ...state.abilities.valueByAbility },
      lastProcAt: state.abilities.lastProcAt,
      lastProcAbility: state.abilities.lastProcAbility,
    },
    meta: { ...state.meta },
  };

  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('[stats] subscriber error', error);
    }
  }
}

function scheduleSave(): void {
  if (saveTimer != null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    try {
      storage.set(STORAGE_KEY, state);
    } catch (error) {
      console.error('[stats] save error', error);
    }
  }, SAVE_DEBOUNCE_MS) as unknown as number;
}

function commitState(): void {
  state.meta.updatedAt = Date.now();
  scheduleSave();
  emitSnapshot();
}

function pruneShopItems(): void {
  const entries = Object.entries(state.shop.items);
  if (entries.length <= MAX_SHOP_ITEMS) return;
  entries.sort((a, b) => (a[1].lastPurchasedAt ?? 0) - (b[1].lastPurchasedAt ?? 0));
  const excess = entries.length - MAX_SHOP_ITEMS;
  for (let i = 0; i < excess; i++) {
    delete state.shop.items[entries[i]![0]];
  }
}

function recordWeatherDuration(targetTimestamp: number): boolean {
  const now = targetTimestamp;
  const delta = Math.max(0, now - lastWeatherTickAt);
  if (delta < 1000) {
    lastWeatherTickAt = now;
    state.weather.lastSnapshotAt = now;
    return false;
  }
  const kindKey = state.weather.activeKind || 'unknown';
  state.weather.timeByKind[kindKey] = (state.weather.timeByKind[kindKey] ?? 0) + delta;
  lastWeatherTickAt = now;
  state.weather.lastSnapshotAt = now;
  return true;
}

function attachWeatherTracking(): void {
  startWeatherHub();
  const current = getWeatherSnapshot();
  state.weather.activeKind = current.kind ?? 'unknown';
  state.weather.lastSnapshotAt = current.timestamp;
  lastWeatherTickAt = Date.now();

  weatherUnsubscribe = onWeatherSnapshot((snapshot: WeatherSnapshot) => {
    const durationChanged = recordWeatherDuration(snapshot.timestamp);
    const newKind = snapshot.kind ?? 'unknown';
    const kindChanged = newKind !== state.weather.activeKind;
    state.weather.activeKind = newKind;
    if (durationChanged || kindChanged) commitState();
  }, true);

  weatherTickTimerCleanup = visibleInterval('stats-weather-tick', () => {
    const changed = recordWeatherDuration(Date.now());
    if (changed) {
      commitState();
    }
  }, WEATHER_TICK_INTERVAL);
}

export function initializeStatsStore(): void {
  if (initialized) return;
  state = hydrateState();
  initialized = true;
  attachWeatherTracking();
  emitSnapshot();
}

export function subscribeToStats(listener: (snapshot: StatsSnapshot) => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  try {
    listener(getStatsSnapshot());
  } catch (error) {
    console.error('[stats] immediate subscriber error', error);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getStatsSnapshot(): StatsSnapshot {
  ensureInitialized();
  return {
    feed: {
      totalFeeds: state.feed.totalFeeds,
      perPet: Object.fromEntries(
        Object.entries(state.feed.perPet).map(([key, value]) => [key, { ...value }])
      ),
      lastFeedAt: state.feed.lastFeedAt,
      sessionStart: state.feed.sessionStart,
    },
    weather: {
      timeByKind: { ...state.weather.timeByKind },
      activeKind: state.weather.activeKind,
    },
    shop: {
      totalPurchases: state.shop.totalPurchases,
      totalSpentCoins: state.shop.totalSpentCoins,
      totalSpentCredits: state.shop.totalSpentCredits,
      totalSpentMagicDust: state.shop.totalSpentMagicDust,
      purchasesByCategory: { ...state.shop.purchasesByCategory },
      items: Object.fromEntries(
        Object.entries(state.shop.items).map(([key, value]) => [key, { ...value }])
      ),
      history: state.shop.history.map((row) => ({ ...row })),
      lastPurchase: state.shop.lastPurchase ? { ...state.shop.lastPurchase } : null,
    },
    garden: {
      totalPlanted: state.garden.totalPlanted,
      totalHarvested: state.garden.totalHarvested,
      totalDestroyed: state.garden.totalDestroyed,
      totalWateringCans: state.garden.totalWateringCans,
      lastPlantedAt: state.garden.lastPlantedAt,
      lastHarvestedAt: state.garden.lastHarvestedAt,
      lastDestroyedAt: state.garden.lastDestroyedAt,
      lastWateredAt: state.garden.lastWateredAt,
    },
    pets: {
      totalHatched: state.pets.totalHatched,
      hatchedByRarity: { ...state.pets.hatchedByRarity },
      lastHatchedAt: state.pets.lastHatchedAt,
      lastHatchedRarity: state.pets.lastHatchedRarity,
    },
    abilities: {
      totalProcs: state.abilities.totalProcs,
      totalEstimatedValue: state.abilities.totalEstimatedValue,
      procsByAbility: { ...state.abilities.procsByAbility },
      valueByAbility: { ...state.abilities.valueByAbility },
      lastProcAt: state.abilities.lastProcAt,
      lastProcAbility: state.abilities.lastProcAbility,
    },
    meta: { ...state.meta },
  };
}

export function recordAbilityProc(abilityId: string, estimatedValue: number = 0, timestamp = Date.now()): void {
  ensureInitialized();

  state.abilities.totalProcs += 1;
  state.abilities.totalEstimatedValue += estimatedValue;
  state.abilities.procsByAbility[abilityId] = (state.abilities.procsByAbility[abilityId] ?? 0) + 1;
  state.abilities.valueByAbility[abilityId] = (state.abilities.valueByAbility[abilityId] ?? 0) + estimatedValue;
  state.abilities.lastProcAt = timestamp;
  state.abilities.lastProcAbility = abilityId;

  commitState();
}

export function recordFeedEvent(petName: string, timestamp = Date.now()): void {
  ensureInitialized();
  const key = (petName || '').trim() || 'Unknown Pet';
  if (!state.feed.perPet[key]) {
    state.feed.perPet[key] = { count: 0, lastFeedAt: null };
  }
  state.feed.perPet[key].count += 1;
  state.feed.perPet[key].lastFeedAt = timestamp;
  state.feed.totalFeeds += 1;
  state.feed.lastFeedAt = timestamp;
  commitState();
}


export function recordShopPurchase(
  category: ShopCategoryKey,
  itemName: string,
  count: number,
  coins: number,
  credits: number,
  magicDust = 0,
  timestamp = Date.now(),
): void {
  ensureInitialized();
  const safeCount = Math.max(0, Math.round(count));
  const safeCoins = Math.max(0, Math.round(coins));
  const safeCredits = Math.max(0, Math.round(credits));
  const safeDust = Math.max(0, Math.round(magicDust));
  const label = itemName || 'Unknown Item';

  state.shop.totalPurchases += safeCount;
  state.shop.totalSpentCoins += safeCoins;
  state.shop.totalSpentCredits += safeCredits;
  state.shop.totalSpentMagicDust += safeDust;
  state.shop.purchasesByCategory[category] = (state.shop.purchasesByCategory[category] ?? 0) + safeCount;

  if (!state.shop.items[label]) {
    state.shop.items[label] = {
      count: 0,
      coins: 0,
      credits: 0,
      magicDust: 0,
      lastPurchasedAt: timestamp,
    };
  }

  const entry = state.shop.items[label]!;
  entry.count += safeCount;
  entry.coins += safeCoins;
  entry.credits += safeCredits;
  entry.magicDust += safeDust;
  entry.lastPurchasedAt = timestamp;

  pruneShopItems();

  state.shop.lastPurchase = {
    itemName: label,
    category,
    count: safeCount,
    coins: safeCoins,
    credits: safeCredits,
    magicDust: safeDust,
    timestamp,
  };

  state.shop.history.push({
    itemName: label,
    category,
    count: safeCount,
    coins: safeCoins,
    credits: safeCredits,
    magicDust: safeDust,
    timestamp,
    success: true,
  });
  if (state.shop.history.length > MAX_HISTORY) {
    state.shop.history.splice(0, state.shop.history.length - MAX_HISTORY);
  }

  commitState();
}

export function recordGardenPlant(count: number = 1, timestamp = Date.now()): void {
  ensureInitialized();
  state.garden.totalPlanted += count;
  state.garden.lastPlantedAt = timestamp;
  commitState();
}

export function recordGardenHarvest(count: number = 1, timestamp = Date.now()): void {
  ensureInitialized();
  state.garden.totalHarvested += count;
  state.garden.lastHarvestedAt = timestamp;
  commitState();
}

export function recordGardenDestroy(count: number = 1, timestamp = Date.now()): void {
  ensureInitialized();
  state.garden.totalDestroyed += count;
  state.garden.lastDestroyedAt = timestamp;
  commitState();
}

export function recordWateringCan(timestamp = Date.now()): void {
  ensureInitialized();
  state.garden.totalWateringCans += 1;
  state.garden.lastWateredAt = timestamp;
  commitState();
}

export function recordPetHatch(rarity: 'normal' | 'gold' | 'rainbow', timestamp = Date.now()): void {
  ensureInitialized();
  state.pets.totalHatched += 1;
  state.pets.hatchedByRarity[rarity] += 1;
  state.pets.lastHatchedAt = timestamp;
  state.pets.lastHatchedRarity = rarity;
  commitState();
}

export function resetStats(): void {
  ensureInitialized();
  const now = Date.now();
  state = createDefaultState(now);
  const current = getWeatherSnapshot();
  state.weather.activeKind = current.kind ?? 'unknown';
  state.weather.lastSnapshotAt = current.timestamp;
  lastWeatherTickAt = now;
  emitSnapshot();
  scheduleSave();
}
