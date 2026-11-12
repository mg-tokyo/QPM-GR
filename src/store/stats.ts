import { startWeatherHub, onWeatherSnapshot, getWeatherSnapshot, type WeatherSnapshot } from './weatherHub';
import { visibleInterval } from '../utils/scheduling/timerManager';
import { createStoreDiagnostics } from './_storeDiagnostics';
import { createPlayerScoped, type PlayerScopedHandle, type PlayerScopedLayout } from './playerScoped';
import {
  MAX_HISTORY,
  createDefaultStatsState,
  mergeStats,
  normalizeStats,
  pruneShopItems,
  type ShopCategoryKey,
  type StatsSnapshot,
  type StatsState,
} from './statsMerge';

export type { ShopCategoryKey, StatsSnapshot } from './statsMerge';

const diag = createStoreDiagnostics('storeStats', 'stats');

const STORAGE_KEY = 'quinoa:stats:v1';
const SAVE_DEBOUNCE_MS = 1200;
const WEATHER_TICK_INTERVAL = 5000;
const WEATHER_COMMIT_MIN_INTERVAL_MS = 60_000;
const MAX_PENDING = 500;

let state: StatsState;
let initialized = false;
let stopped = false;
let handle: PlayerScopedHandle<StatsState> | null = null;
/** Record calls made before the player id resolves; replayed onto the player's copy, since a PD3 max merge would drop them. */
let pending: Array<() => void> = [];
let saveTimer: number | null = null;
let weatherUnsubscribe: (() => void) | null = null;
let weatherTickTimerCleanup: (() => void) | null = null;
let lastWeatherTickAt = Date.now();
let lastWeatherCommit = 0;

const listeners = new Set<(snapshot: StatsSnapshot) => void>();

const statsLayout: PlayerScopedLayout<StatsState> = {
  parts: [STORAGE_KEY],
  join: ([raw]) => normalizeStats(raw),
  split: (value) => [value],
};

function ensureInitialized(): void {
  if (!initialized && !stopped) {
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
      diag.warn('QPM-STORE-003', { phase: 'emitSnapshot' }, error);
    }
  }
}

function saveNow(): void {
  if (saveTimer != null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!handle?.isReady()) return;
  try {
    if (!handle.write(state)) diag.warn('QPM-STORE-004', { what: 'stats', key: handle.scopedKey() ?? STORAGE_KEY });
  } catch (error) {
    diag.warn('QPM-STORE-003', { phase: 'save' }, error);
  }
}

function scheduleSave(): void {
  if (saveTimer != null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(saveNow, SAVE_DEBOUNCE_MS) as unknown as number;
}

function commitState(): void {
  state.meta.updatedAt = Date.now();
  lastWeatherCommit = state.meta.updatedAt;
  scheduleSave();
  emitSnapshot();
}

function commitWeatherIfDue(kindChanged: boolean): void {
  if (kindChanged || Date.now() - lastWeatherCommit >= WEATHER_COMMIT_MIN_INTERVAL_MS) {
    commitState();
  }
}

/** Applies now; before the bind it is also queued so the bound copy gets it too. */
function record(apply: () => void): void {
  ensureInitialized();
  apply();
  if (handle && !handle.isReady() && pending.length < MAX_PENDING) pending.push(apply);
  commitState();
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

/** Weather time counts from the bind on, so time before the id resolves is not credited to a default copy. */
function attachWeatherTracking(): void {
  const current = getWeatherSnapshot();
  state.weather.activeKind = current.kind ?? 'unknown';
  state.weather.lastSnapshotAt = current.timestamp;
  lastWeatherTickAt = Date.now();
  lastWeatherCommit = Date.now();
  if (weatherUnsubscribe) return;

  weatherUnsubscribe = onWeatherSnapshot((snapshot: WeatherSnapshot) => {
    const durationChanged = recordWeatherDuration(snapshot.timestamp);
    const newKind = snapshot.kind ?? 'unknown';
    const kindChanged = newKind !== state.weather.activeKind;
    state.weather.activeKind = newKind;
    if (kindChanged || durationChanged) commitWeatherIfDue(kindChanged);
  }, true);

  weatherTickTimerCleanup = visibleInterval('stats-weather-tick', () => {
    const changed = recordWeatherDuration(Date.now());
    if (changed) commitWeatherIfDue(false);
  }, WEATHER_TICK_INTERVAL);
}

function onBound(value: StatsState): void {
  try {
    state = value;
    const replay = pending;
    pending = [];
    for (const apply of replay) apply();
    attachWeatherTracking();
    if (replay.length > 0) saveNow();
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'load', key: STORAGE_KEY }, error);
  }
  emitSnapshot();
  diag.publishOk(
    `${state.feed.totalFeeds} feeds, ${state.shop.totalPurchases} purchases`,
    {
      totalFeeds: state.feed.totalFeeds,
      totalPurchases: state.shop.totalPurchases,
      totalPlanted: state.garden.totalPlanted,
      totalHarvested: state.garden.totalHarvested,
    },
  );
}

/** Totals are kept per player (`<key>.<playerId>`) and load once the id resolves. */
export function initializeStatsStore(): void {
  if (initialized) return;
  initialized = true;
  stopped = false;
  diag.register('Waiting for the player id to load stats');
  state = createDefaultStatsState(Date.now());
  pending = [];
  startWeatherHub();
  const fallback = createDefaultStatsState(Date.now());
  handle = createPlayerScoped<StatsState>({
    baseKey: STORAGE_KEY,
    fallback,
    merge: mergeStats,
    // The fallback is shared across binds and the store mutates its state in place.
    onReady: (value) => onBound(value === fallback ? createDefaultStatsState(Date.now()) : value),
    flush: saveNow,
  }, statsLayout);
  handle.start();
}

/** Saves pending totals to the bound player's key; later record calls no longer restart the store. */
export function stopStatsStore(): void {
  if (!initialized) return;
  saveNow();
  handle?.stop();
  handle = null;
  weatherUnsubscribe?.();
  weatherUnsubscribe = null;
  weatherTickTimerCleanup?.();
  weatherTickTimerCleanup = null;
  pending = [];
  initialized = false;
  stopped = true;
}

export function subscribeToStats(listener: (snapshot: StatsSnapshot) => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  try {
    listener(getStatsSnapshot());
  } catch (error) {
    diag.warn('QPM-STORE-003', { phase: 'subscribeToStats.immediate' }, error);
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
  record(() => {
    state.abilities.totalProcs += 1;
    state.abilities.totalEstimatedValue += estimatedValue;
    state.abilities.procsByAbility[abilityId] = (state.abilities.procsByAbility[abilityId] ?? 0) + 1;
    state.abilities.valueByAbility[abilityId] = (state.abilities.valueByAbility[abilityId] ?? 0) + estimatedValue;
    state.abilities.lastProcAt = timestamp;
    state.abilities.lastProcAbility = abilityId;
  });
}

export function recordFeedEvent(petName: string, timestamp = Date.now()): void {
  const key = (petName || '').trim() || 'Unknown Pet';
  record(() => {
    if (!state.feed.perPet[key]) {
      state.feed.perPet[key] = { count: 0, lastFeedAt: null };
    }
    state.feed.perPet[key].count += 1;
    state.feed.perPet[key].lastFeedAt = timestamp;
    state.feed.totalFeeds += 1;
    state.feed.lastFeedAt = timestamp;
  });
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
  const safeCount = Math.max(0, Math.round(count));
  const safeCoins = Math.max(0, Math.round(coins));
  const safeCredits = Math.max(0, Math.round(credits));
  const safeDust = Math.max(0, Math.round(magicDust));
  const label = itemName || 'Unknown Item';

  record(() => {
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

    pruneShopItems(state.shop.items);

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
  });
}

export function recordGardenPlant(count: number = 1, timestamp = Date.now()): void {
  record(() => {
    state.garden.totalPlanted += count;
    state.garden.lastPlantedAt = timestamp;
  });
}

export function recordGardenHarvest(count: number = 1, timestamp = Date.now()): void {
  record(() => {
    state.garden.totalHarvested += count;
    state.garden.lastHarvestedAt = timestamp;
  });
}

export function recordGardenDestroy(count: number = 1, timestamp = Date.now()): void {
  record(() => {
    state.garden.totalDestroyed += count;
    state.garden.lastDestroyedAt = timestamp;
  });
}

export function recordWateringCan(timestamp = Date.now()): void {
  record(() => {
    state.garden.totalWateringCans += 1;
    state.garden.lastWateredAt = timestamp;
  });
}

export function recordPetHatch(rarity: 'normal' | 'gold' | 'rainbow', timestamp = Date.now()): void {
  record(() => {
    state.pets.totalHatched += 1;
    state.pets.hatchedByRarity[rarity] += 1;
    state.pets.lastHatchedAt = timestamp;
    state.pets.lastHatchedRarity = rarity;
  });
}

/** Before the bind a reset only clears this session; the player's copy replaces it at the bind. */
export function resetStats(): void {
  ensureInitialized();
  const now = Date.now();
  state = createDefaultStatsState(now);
  pending = [];
  const current = getWeatherSnapshot();
  state.weather.activeKind = current.kind ?? 'unknown';
  state.weather.lastSnapshotAt = current.timestamp;
  lastWeatherTickAt = now;
  emitSnapshot();
  scheduleSave();
}
