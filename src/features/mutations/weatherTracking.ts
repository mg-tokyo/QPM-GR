// Tracks weather mutation (Wet, Chilled, Frozen, Amberlit, Amberbound, Dawnlit, Dawnbound) generation rates and value.

import { getGardenSnapshot, onGardenSnapshot, type GardenSnapshot } from '../garden/bridge';
import { getCropStats } from '../garden/data/cropBaseStats';
import { computeMutationMultiplier } from '../../utils/game/cropMultipliers';
import { storage } from '../../utils/storage';
import { debounce } from '../../utils/scheduling/debounce';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import {
  computeSlotStateFromMutationNames,
  type PlantSlotState,
} from './reminder';


const STORAGE_KEY = 'qpm.weatherMutationTracking.v1';
const SAVE_DEBOUNCE_MS = 3000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type WeatherMutationType = 'wet' | 'chilled' | 'frozen' | 'dawnlit' | 'dawnbound' | 'amberlit' | 'amberbound';

export interface WeatherMutationStats {
  wetCount: number;
  wetPerHour: number;
  wetTotalValue: number;
  wetLastAt: number | null;

  chilledCount: number;
  chilledPerHour: number;
  chilledTotalValue: number;
  chilledLastAt: number | null;

  frozenCount: number;
  frozenPerHour: number;
  frozenTotalValue: number;
  frozenLastAt: number | null;

  dawnlitCount: number;
  dawnlitPerHour: number;
  dawnlitTotalValue: number;
  dawnlitLastAt: number | null;

  dawnboundCount: number;
  dawnboundPerHour: number;
  dawnboundTotalValue: number;
  dawnboundLastAt: number | null;

  amberlitCount: number;
  amberlitPerHour: number;
  amberlitTotalValue: number;
  amberlitLastAt: number | null;

  amberboundCount: number;
  amberboundPerHour: number;
  amberboundTotalValue: number;
  amberboundLastAt: number | null;

  sessionValue: number;
  sessionStart: number;

  bestHourValue: number;
  bestHourTime: number | null;
  bestSessionValue: number;
  bestSessionTime: number | null;
}

export interface WeatherMutationSnapshot {
  stats: WeatherMutationStats;
  updatedAt: number;
}

interface PersistedSnapshot {
  version: number;
  stats: WeatherMutationStats;
  updatedAt: number;
  trackedSlots: Map<string, Set<WeatherMutationType>>; // Track slot ID -> mutations we've counted
}

interface CropSlot {
  tileId: string;
  slotIndex: number;
  cropName: string | null;
  mutations: string[];
  slotState: PlantSlotState;
}

let snapshot: WeatherMutationSnapshot = {
  stats: {
    wetCount: 0,
    wetPerHour: 0,
    wetTotalValue: 0,
    wetLastAt: null,
    chilledCount: 0,
    chilledPerHour: 0,
    chilledTotalValue: 0,
    chilledLastAt: null,
    frozenCount: 0,
    frozenPerHour: 0,
    frozenTotalValue: 0,
    frozenLastAt: null,
    dawnlitCount: 0,
    dawnlitPerHour: 0,
    dawnlitTotalValue: 0,
    dawnlitLastAt: null,
    dawnboundCount: 0,
    dawnboundPerHour: 0,
    dawnboundTotalValue: 0,
    dawnboundLastAt: null,
    amberlitCount: 0,
    amberlitPerHour: 0,
    amberlitTotalValue: 0,
    amberlitLastAt: null,
    amberboundCount: 0,
    amberboundPerHour: 0,
    amberboundTotalValue: 0,
    amberboundLastAt: null,
    sessionValue: 0,
    sessionStart: Date.now(),
    bestHourValue: 0,
    bestHourTime: null,
    bestSessionValue: 0,
    bestSessionTime: null,
  },
  updatedAt: Date.now(),
};

let trackedSlots = new Map<string, Set<WeatherMutationType>>(); // Slot ID -> set of weather mutations we've already counted
let initialized = false;
const listeners = new Set<(snapshot: WeatherMutationSnapshot) => void>();
let gardenUnsubscribe: (() => void) | null = null;

// Cheap fingerprint: total mutation count across all slots.
// processGardenUpdate only runs when this changes (new mutation appeared or plant harvested).
let lastGardenMutationCount = -1;

function getGardenMutationCount(gardenSnapshot: GardenSnapshot | null): number {
  if (!gardenSnapshot) return 0;
  let count = 0;
  for (const area of [
    gardenSnapshot.tileObjects as Record<string, unknown> | undefined,
    gardenSnapshot.boardwalkTileObjects as Record<string, unknown> | undefined,
  ]) {
    if (!area || typeof area !== 'object') continue;
    for (const rawTile of Object.values(area)) {
      if (!rawTile || typeof rawTile !== 'object') continue;
      const tile = rawTile as Record<string, unknown>;
      if (!Array.isArray(tile.slots)) continue;
      for (const slot of tile.slots as unknown[]) {
        if (slot && typeof slot === 'object' && Array.isArray((slot as any).mutations)) {
          count += (slot as any).mutations.length;
        }
      }
    }
  }
  return count;
}

function extractCropSlots(gardenSnapshot: GardenSnapshot | null): CropSlot[] {
  const slots: CropSlot[] = [];
  if (!gardenSnapshot) return slots;

  const areas: Array<{ tiles: Record<string, unknown> | null | undefined }> = [
    { tiles: gardenSnapshot.tileObjects as Record<string, unknown> | undefined },
    { tiles: gardenSnapshot.boardwalkTileObjects as Record<string, unknown> | undefined },
  ];

  for (const { tiles } of areas) {
    if (!tiles || typeof tiles !== 'object') continue;

    for (const [tileId, rawTile] of Object.entries(tiles)) {
      if (!rawTile || typeof rawTile !== 'object') continue;
      const tile = rawTile as Record<string, unknown>;
      if (tile.objectType !== 'plant') continue;

      const slotsRaw = Array.isArray(tile.slots) ? tile.slots : [];

      slotsRaw.forEach((slotRaw, slotIndex) => {
        if (!slotRaw || typeof slotRaw !== 'object') return;
        const slot = slotRaw as Record<string, unknown>;

        const mutationsRaw = Array.isArray(slot.mutations) ? slot.mutations : [];
        const mutations = (mutationsRaw as unknown[])
          .map((value) => (typeof value === 'string' ? value : null))
          .filter((value): value is string => !!value);

        if (mutations.length === 0) return;

        const cropName = readSlotSpecies(slot);
        const slotState = computeSlotStateFromMutationNames(mutations);

        slots.push({
          tileId,
          slotIndex,
          cropName,
          mutations,
          slotState,
        });
      });
    }
  }

  return slots;
}

function readSlotSpecies(slot: Record<string, unknown>): string | null {
  const candidates: unknown[] = [
    slot.species,
    slot.seedSpecies,
    slot.plantSpecies,
    slot.cropSpecies,
    slot.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function calculateSlotValue(cropName: string | null, mutations: string[]): number {
  if (!cropName) return 0;

  const cropStats = getCropStats(cropName);
  if (!cropStats) return 0;

  const { totalMultiplier } = computeMutationMultiplier(mutations);
  return cropStats.baseSellPrice * totalMultiplier;
}

function processGardenUpdate(gardenSnapshot: GardenSnapshot | null): void {
  const now = Date.now();
  const slots = extractCropSlots(gardenSnapshot);

  const currentSlotIds = new Set<string>();

  for (const slot of slots) {
    const slotId = `${slot.tileId}-${slot.slotIndex}`;
    currentSlotIds.add(slotId);

    let seenMutations = trackedSlots.get(slotId);
    if (!seenMutations) {
      seenMutations = new Set<WeatherMutationType>();
      trackedSlots.set(slotId, seenMutations);
    }

    const slotValue = calculateSlotValue(slot.cropName, slot.mutations);

    if (slot.slotState.hasWet && !seenMutations.has('wet')) {
      seenMutations.add('wet');
      snapshot.stats.wetCount++;
      snapshot.stats.wetLastAt = now;
      snapshot.stats.wetTotalValue += slotValue;
    }

    if (slot.slotState.hasChilled && !seenMutations.has('chilled')) {
      seenMutations.add('chilled');
      snapshot.stats.chilledCount++;
      snapshot.stats.chilledLastAt = now;
      snapshot.stats.chilledTotalValue += slotValue;
    }

    if (slot.slotState.hasFrozen && !seenMutations.has('frozen')) {
      seenMutations.add('frozen');
      snapshot.stats.frozenCount++;
      snapshot.stats.frozenLastAt = now;
      snapshot.stats.frozenTotalValue += slotValue;
    }

    if (slot.slotState.hasDawnlit && !seenMutations.has('dawnlit')) {
      seenMutations.add('dawnlit');
      snapshot.stats.dawnlitCount++;
      snapshot.stats.dawnlitLastAt = now;
      snapshot.stats.dawnlitTotalValue += slotValue;
    }

    if (slot.slotState.hasDawnbound && !seenMutations.has('dawnbound')) {
      seenMutations.add('dawnbound');
      snapshot.stats.dawnboundCount++;
      snapshot.stats.dawnboundLastAt = now;
      snapshot.stats.dawnboundTotalValue += slotValue;
    }

    if (slot.slotState.hasAmberlit && !seenMutations.has('amberlit')) {
      seenMutations.add('amberlit');
      snapshot.stats.amberlitCount++;
      snapshot.stats.amberlitLastAt = now;
      snapshot.stats.amberlitTotalValue += slotValue;
    }

    if (slot.slotState.hasAmberbound && !seenMutations.has('amberbound')) {
      seenMutations.add('amberbound');
      snapshot.stats.amberboundCount++;
      snapshot.stats.amberboundLastAt = now;
      snapshot.stats.amberboundTotalValue += slotValue;
    }
  }

  // Remove tracked slots that no longer exist (harvested)
  for (const slotId of trackedSlots.keys()) {
    if (!currentSlotIds.has(slotId)) {
      trackedSlots.delete(slotId);
    }
  }

  recalculateRates();
}

function recalculateRates(): void {
  const now = Date.now();
  const sessionStart = snapshot.stats.sessionStart;
  const duration = Math.max(1, now - sessionStart);
  const hours = duration / HOUR_MS;

  snapshot.stats.wetPerHour = hours > 0 ? snapshot.stats.wetCount / hours : 0;
  snapshot.stats.chilledPerHour = hours > 0 ? snapshot.stats.chilledCount / hours : 0;
  snapshot.stats.frozenPerHour = hours > 0 ? snapshot.stats.frozenCount / hours : 0;
  snapshot.stats.dawnlitPerHour = hours > 0 ? snapshot.stats.dawnlitCount / hours : 0;
  snapshot.stats.dawnboundPerHour = hours > 0 ? snapshot.stats.dawnboundCount / hours : 0;
  snapshot.stats.amberlitPerHour = hours > 0 ? snapshot.stats.amberlitCount / hours : 0;
  snapshot.stats.amberboundPerHour = hours > 0 ? snapshot.stats.amberboundCount / hours : 0;

  snapshot.stats.sessionValue =
    snapshot.stats.wetTotalValue +
    snapshot.stats.chilledTotalValue +
    snapshot.stats.frozenTotalValue +
    snapshot.stats.dawnlitTotalValue +
    snapshot.stats.dawnboundTotalValue +
    snapshot.stats.amberlitTotalValue +
    snapshot.stats.amberboundTotalValue;

  if (snapshot.stats.sessionValue > snapshot.stats.bestSessionValue) {
    snapshot.stats.bestSessionValue = snapshot.stats.sessionValue;
    snapshot.stats.bestSessionTime = now;
  }

  snapshot.updatedAt = now;
  scheduleSave();
  notifyListeners();
}

const scheduleSave = debounce(() => {
  try {
    storage.set(STORAGE_KEY, serializeSnapshot());
  } catch (error) {
    console.error('[weatherMutationTracking] Failed to save:', error);
  }
}, SAVE_DEBOUNCE_MS);

function serializeSnapshot(): any {
  const trackedSlotsArray: Array<[string, WeatherMutationType[]]> = [];
  for (const [slotId, mutations] of trackedSlots.entries()) {
    trackedSlotsArray.push([slotId, Array.from(mutations)]);
  }

  return {
    version: 2,
    stats: { ...snapshot.stats },
    updatedAt: snapshot.updatedAt,
    trackedSlots: trackedSlotsArray,
  };
}

function restoreSnapshot(persisted: any): void {
  if (!persisted) return;

  if (persisted.version !== 1 && persisted.version !== 2) return;

  // Only restore best records; counts/session data reset for the new session
  snapshot.stats.bestHourValue = persisted.stats.bestHourValue || 0;
  snapshot.stats.bestHourTime = persisted.stats.bestHourTime || null;
  snapshot.stats.bestSessionValue = persisted.stats.bestSessionValue || 0;
  snapshot.stats.bestSessionTime = persisted.stats.bestSessionTime || null;

  snapshot.stats.sessionStart = Date.now();
  snapshot.updatedAt = Date.now();

  // Do NOT restore trackedSlots — start fresh so only NEW mutations this session count
  trackedSlots = new Map();
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('[weatherMutationTracking] Listener error:', error);
    }
  }
}

export function initializeWeatherMutationTracking(): void {
  if (initialized) return;
  initialized = true;

  try {
    const persisted = storage.get<any>(STORAGE_KEY, null);
    restoreSnapshot(persisted);
  } catch (error) {
    console.error('[weatherMutationTracking] Failed to restore:', error);
  }

  // CRITICAL: Pre-populate trackedSlots with current garden state
  // This prevents existing mutations from being counted on first update
  const currentGarden = getGardenSnapshot();
  const currentSlots = extractCropSlots(currentGarden);

  for (const slot of currentSlots) {
    const slotId = `${slot.tileId}-${slot.slotIndex}`;
    const seenMutations = new Set<WeatherMutationType>();

    if (slot.slotState.hasWet) seenMutations.add('wet');
    if (slot.slotState.hasChilled) seenMutations.add('chilled');
    if (slot.slotState.hasFrozen) seenMutations.add('frozen');
    if (slot.slotState.hasDawnlit) seenMutations.add('dawnlit');
    if (slot.slotState.hasDawnbound) seenMutations.add('dawnbound');
    if (slot.slotState.hasAmberlit) seenMutations.add('amberlit');
    if (slot.slotState.hasAmberbound) seenMutations.add('amberbound');

    if (seenMutations.size > 0) {
      trackedSlots.set(slotId, seenMutations);
    }
  }

  // Prime so the subscription's first fireImmediately fire passes the guard and populates
  lastGardenMutationCount = -1;

  console.log(`[QPM] 🔄 Weather mutation tracking initialized - ${trackedSlots.size} existing slots marked, tracking NEW mutations only`);

  // Guard against re-running extractCropSlots/calculateSlotValue/recalculateRates on every game tick
  gardenUnsubscribe = onGardenSnapshot((gardenSnapshot) => {
    const count = getGardenMutationCount(gardenSnapshot);
    if (count === lastGardenMutationCount) return;
    lastGardenMutationCount = count;
    processGardenUpdate(gardenSnapshot);
  }, true);

  // In-memory rate refresh only; listeners are notified by processGardenUpdate instead
  visibleInterval('weather-mutation-recalc', () => {
    const now = Date.now();
    const sessionStart = snapshot.stats.sessionStart;
    const hours = Math.max(1, now - sessionStart) / HOUR_MS;
    snapshot.stats.wetPerHour = snapshot.stats.wetCount / hours;
    snapshot.stats.chilledPerHour = snapshot.stats.chilledCount / hours;
    snapshot.stats.frozenPerHour = snapshot.stats.frozenCount / hours;
    snapshot.stats.dawnlitPerHour = snapshot.stats.dawnlitCount / hours;
    snapshot.stats.dawnboundPerHour = snapshot.stats.dawnboundCount / hours;
    snapshot.stats.amberlitPerHour = snapshot.stats.amberlitCount / hours;
    snapshot.stats.amberboundPerHour = snapshot.stats.amberboundCount / hours;
  }, 10000);
}

export function clearAllWeatherMutationHistory(): void {
  try {
    storage.remove(STORAGE_KEY);
    console.log('[QPM] 🗑️ All weather mutation history cleared from storage');
  } catch (error) {
    console.error('[weatherMutationTracking] Failed to clear storage:', error);
  }

  snapshot = {
    stats: {
      wetCount: 0,
      wetPerHour: 0,
      wetTotalValue: 0,
      wetLastAt: null,
      chilledCount: 0,
      chilledPerHour: 0,
      chilledTotalValue: 0,
      chilledLastAt: null,
      frozenCount: 0,
      frozenPerHour: 0,
      frozenTotalValue: 0,
      frozenLastAt: null,
      dawnlitCount: 0,
      dawnlitPerHour: 0,
      dawnlitTotalValue: 0,
      dawnlitLastAt: null,
      dawnboundCount: 0,
      dawnboundPerHour: 0,
      dawnboundTotalValue: 0,
      dawnboundLastAt: null,
      amberlitCount: 0,
      amberlitPerHour: 0,
      amberlitTotalValue: 0,
      amberlitLastAt: null,
      amberboundCount: 0,
      amberboundPerHour: 0,
      amberboundTotalValue: 0,
      amberboundLastAt: null,
      sessionValue: 0,
      sessionStart: Date.now(),
      bestHourValue: 0,
      bestHourTime: null,
      bestSessionValue: 0,
      bestSessionTime: null,
    },
    updatedAt: Date.now(),
  };

  trackedSlots = new Map();
  notifyListeners();
}

export function getWeatherMutationSnapshot(): WeatherMutationSnapshot {
  return {
    stats: { ...snapshot.stats },
    updatedAt: snapshot.updatedAt,
  };
}

export function subscribeToWeatherMutationTracking(
  listener: (snapshot: WeatherMutationSnapshot) => void
): () => void {
  listeners.add(listener);
  listener(getWeatherMutationSnapshot());
  return () => listeners.delete(listener);
}

export function forceRecalculateWeatherMutations(): void {
  const gardenSnapshot = getGardenSnapshot();
  processGardenUpdate(gardenSnapshot);
}

export function resetWeatherMutationTracking(): void {
  snapshot = {
    stats: {
      wetCount: 0,
      wetPerHour: 0,
      wetTotalValue: 0,
      wetLastAt: null,
      chilledCount: 0,
      chilledPerHour: 0,
      chilledTotalValue: 0,
      chilledLastAt: null,
      frozenCount: 0,
      frozenPerHour: 0,
      frozenTotalValue: 0,
      frozenLastAt: null,
      dawnlitCount: 0,
      dawnlitPerHour: 0,
      dawnlitTotalValue: 0,
      dawnlitLastAt: null,
      dawnboundCount: 0,
      dawnboundPerHour: 0,
      dawnboundTotalValue: 0,
      dawnboundLastAt: null,
      amberlitCount: 0,
      amberlitPerHour: 0,
      amberlitTotalValue: 0,
      amberlitLastAt: null,
      amberboundCount: 0,
      amberboundPerHour: 0,
      amberboundTotalValue: 0,
      amberboundLastAt: null,
      sessionValue: 0,
      sessionStart: Date.now(),
      bestHourValue: snapshot.stats.bestHourValue, // Keep best records
      bestHourTime: snapshot.stats.bestHourTime,
      bestSessionValue: snapshot.stats.bestSessionValue,
      bestSessionTime: snapshot.stats.bestSessionTime,
    },
    updatedAt: Date.now(),
  };

  // CRITICAL FIX: Re-populate trackedSlots with current garden state
  // This prevents existing crops from being counted as "new" after reset
  trackedSlots = new Map();
  const currentGarden = getGardenSnapshot();
  const currentSlots = extractCropSlots(currentGarden);

  for (const slot of currentSlots) {
    const slotId = `${slot.tileId}-${slot.slotIndex}`;
    const seenMutations = new Set<WeatherMutationType>();

    if (slot.slotState.hasWet) seenMutations.add('wet');
    if (slot.slotState.hasChilled) seenMutations.add('chilled');
    if (slot.slotState.hasFrozen) seenMutations.add('frozen');
    if (slot.slotState.hasDawnlit) seenMutations.add('dawnlit');
    if (slot.slotState.hasDawnbound) seenMutations.add('dawnbound');
    if (slot.slotState.hasAmberlit) seenMutations.add('amberlit');
    if (slot.slotState.hasAmberbound) seenMutations.add('amberbound');

    if (seenMutations.size > 0) {
      trackedSlots.set(slotId, seenMutations);
    }
  }

  // Skip debounce — save immediately after reset
  try {
    storage.set(STORAGE_KEY, serializeSnapshot());
  } catch (error) {
    console.error('[weatherMutationTracking] Failed to save after reset:', error);
  }

  notifyListeners();
  console.log(`[QPM] 🔄 Weather mutation tracking reset - ${trackedSlots.size} existing slots marked as seen`);
}
