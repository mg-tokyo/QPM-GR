import { getStatsSnapshot } from '../../../store/stats';
import { getInventoryItems, type InventoryItem } from '../../../store/inventory';
import { getGardenSnapshot } from '../../garden/bridge';
import { getWorkingStrength } from './scoring';
import type {
  ComparePetInput,
  ProgressionSignalSnapshot,
  ProgressionStage,
  ProgressionStageSnapshot,
} from './types';

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseCoinsValue(raw: unknown): number | null {
  const direct = parseNumber(raw);
  if (direct != null) return Math.max(0, Math.floor(direct));

  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const candidates = [
    record.coins,
    record.count,
    record.value,
    record.amount,
    record.balance,
    record.current,
    (record.data as Record<string, unknown> | undefined)?.coins,
    (record.player as Record<string, unknown> | undefined)?.coins,
    (record.state as Record<string, unknown> | undefined)?.coins,
  ];

  for (const candidate of candidates) {
    const parsed = parseCoinsValue(candidate);
    if (parsed != null) return parsed;
  }

  return null;
}

function findStorageRecord(storageEntries: unknown[], keys: string[]): Record<string, unknown> | null {
  for (const entry of storageEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const values = [record.decorId, record.type, record.id, record.storageId, record.name]
      .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''));
    if (values.some((value) => keys.some((key) => value.includes(key)))) {
      return record;
    }
  }
  return null;
}

function scoreStorageSignal(value: number | null): number | null {
  if (value == null) return null;
  if (value <= 0) return 0.2;
  if (value <= 1) return 0.6;
  return 1.0;
}

function scoreCountBand(value: number | null): number | null {
  if (value == null) return null;
  if (value <= 0) return 0.2;
  if (value <= 2) return 0.6;
  return 1.0;
}

function scoreRbwBand(value: number | null): number | null {
  if (value == null) return null;
  if (value <= 2) return 0.2;
  if (value <= 4) return 0.6;
  return 1.0;
}

function scoreEggBand(value: number | null): number | null {
  if (value == null) return null;
  if (value < 1000) return 0.2;
  if (value < 6000) return 0.6;
  return 1.0;
}

function scoreCoinBand(value: number | null): number | null {
  if (value == null) return null;
  if (value < 10_000_000_000) return 0.2;
  if (value < 500_000_000_000) return 0.6;
  return 1.0;
}

function scoreRainbowGranterBand(value: number): number {
  if (value <= 0) return 0.2;
  if (value === 1) return 0.6;
  return 1.0;
}

function scorePetPowerBand(pets: ComparePetInput[]): number | null {
  if (!Array.isArray(pets) || pets.length === 0) return null;

  const strengths = pets
    .map((pet) => getWorkingStrength(pet))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a);

  if (strengths.length === 0) return null;

  const sample = strengths.slice(0, Math.min(6, strengths.length));
  const average = sample.reduce((sum, value) => sum + value, 0) / sample.length;

  if (average < 75) return 0.2;
  if (average < 88) return 0.6;
  return 1.0;
}

function weightedAverage(values: Array<{ weight: number; value: number | null }>): number | null {
  let weighted = 0;
  let totalWeight = 0;

  for (const entry of values) {
    if (entry.value == null) continue;
    weighted += entry.weight * entry.value;
    totalWeight += entry.weight;
  }

  if (totalWeight <= 0) return null;
  return weighted / totalWeight;
}

function countCelestialFromInventory(items: InventoryItem[]): { starweaver: number; moon: number; dawn: number } {
  const counts = { starweaver: 0, moon: 0, dawn: 0 };

  for (const item of items) {
    const labelCandidates = [item.species, item.name, item.displayName, (item as unknown as Record<string, unknown>).decorId, item.itemId]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());

    const quantity = Math.max(1, Math.floor(parseNumber(item.quantity) ?? parseNumber(item.count) ?? parseNumber(item.amount) ?? 1));

    if (labelCandidates.some((value) => value.includes('starweaver'))) {
      counts.starweaver += quantity;
    }
    if (labelCandidates.some((value) => value.includes('moonbinder') || value.includes('mooncelestial'))) {
      counts.moon += quantity;
    }
    if (labelCandidates.some((value) => value.includes('dawnbinder') || value.includes('dawncelestial'))) {
      counts.dawn += quantity;
    }
  }

  return counts;
}

function countCelestialFromGarden(): { starweaver: number; moon: number; dawn: number } {
  const counts = { starweaver: 0, moon: 0, dawn: 0 };
  const snapshot = getGardenSnapshot();
  if (!snapshot) return counts;

  const collections = [snapshot.tileObjects, snapshot.boardwalkTileObjects];
  for (const collection of collections) {
    if (!collection || typeof collection !== 'object') continue;
    for (const tile of Object.values(collection)) {
      if (!tile || typeof tile !== 'object') continue;
      const slots = (tile as Record<string, unknown>).slots;
      if (!Array.isArray(slots)) continue;

      for (const slot of slots) {
        if (!slot || typeof slot !== 'object') continue;
        const species = (slot as Record<string, unknown>).species;
        if (typeof species !== 'string') continue;
        const normalized = species.toLowerCase();

        if (normalized.includes('starweaver')) counts.starweaver += 1;
        if (normalized.includes('moonbinder') || normalized.includes('mooncelestial')) counts.moon += 1;
        if (normalized.includes('dawnbinder') || normalized.includes('dawncelestial')) counts.dawn += 1;
      }
    }
  }

  return counts;
}

function resolveStorageSignals(items: InventoryItem[]): { petHutch: number | null; seedSilo: number | null; decorShed: number | null } {
  const result = {
    petHutch: null as number | null,
    seedSilo: null as number | null,
    decorShed: null as number | null,
  };

  const pageData = (window as unknown as Record<string, unknown>).myData as Record<string, unknown> | undefined;
  const storageEntries = Array.isArray((pageData?.inventory as Record<string, unknown> | undefined)?.storages)
    ? ((pageData?.inventory as Record<string, unknown>).storages as unknown[])
    : [];

  const extractStorageValue = (record: Record<string, unknown> | null): number | null => {
    if (!record) return null;

    const candidates = [
      record.level,
      record.tier,
      record.stage,
      record.upgradeLevel,
      record.capacity,
      record.maxSlots,
      record.maxItems,
      Array.isArray(record.items) ? record.items.length : null,
    ];

    for (const candidate of candidates) {
      const parsed = parseNumber(candidate);
      if (parsed != null && parsed >= 0) {
        return parsed;
      }
    }

    return 1;
  };

  result.petHutch = extractStorageValue(findStorageRecord(storageEntries, ['pethutch', 'pet_hutch', 'hutch']));
  result.seedSilo = extractStorageValue(findStorageRecord(storageEntries, ['seedsilo', 'seed_silo', 'silo']));
  result.decorShed = extractStorageValue(findStorageRecord(storageEntries, ['decorshed', 'decor_shed', 'shed']));

  // Fallback hints from inventory if storage records are unavailable.
  for (const item of items) {
    const candidates = [(item as unknown as Record<string, unknown>).decorId, item.itemId, item.species, item.name, item.displayName]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());

    const quantity = parseNumber(item.quantity) ?? parseNumber(item.count) ?? parseNumber(item.amount) ?? 0;

    if (result.petHutch == null && candidates.some((value) => value.includes('pethutch') || value.includes('pet hutch'))) {
      result.petHutch = quantity > 0 ? quantity : 1;
    }
    if (result.seedSilo == null && candidates.some((value) => value.includes('seedsilo') || value.includes('seed silo'))) {
      result.seedSilo = quantity > 0 ? quantity : 1;
    }
    if (result.decorShed == null && candidates.some((value) => value.includes('decorshed') || value.includes('decor shed'))) {
      result.decorShed = quantity > 0 ? quantity : 1;
    }
  }

  return result;
}

function resolveCoinSignal(): number | null {
  const pageData = (window as unknown as Record<string, unknown>).myData;
  return parseCoinsValue(pageData);
}

export function captureProgressionSignals(pets: ComparePetInput[] = []): ProgressionSignalSnapshot {
  let eggs: number | null = null;
  let rbwCountFromStats: number | null = null;

  try {
    const stats = getStatsSnapshot();
    eggs = Number.isFinite(stats.pets.totalHatched) ? Math.max(0, Math.floor(stats.pets.totalHatched)) : null;
    const rainbow = Number.isFinite(stats.pets.hatchedByRarity.rainbow)
      ? Math.max(0, Math.floor(stats.pets.hatchedByRarity.rainbow))
      : null;
    rbwCountFromStats = rainbow;
  } catch {
    eggs = null;
    rbwCountFromStats = null;
  }

  const rbwCountFromPets = pets.reduce((sum, pet) => {
    const mutations = Array.isArray(pet.mutations) ? pet.mutations : [];
    return sum + (mutations.some((mutation) => /rainbow/i.test(mutation)) ? 1 : 0);
  }, 0);
  const rainbowGranterPetCount = pets.reduce((sum, pet) => {
    const abilities = Array.isArray(pet.abilities) ? pet.abilities : [];
    return sum + (abilities.some((ability) => ability === 'RainbowGranter') ? 1 : 0);
  }, 0);

  const items = getInventoryItems();
  const storageSignals = resolveStorageSignals(items);

  const celestialInventory = countCelestialFromInventory(items);
  const celestialGarden = countCelestialFromGarden();

  const celestial = {
    starweaver: celestialInventory.starweaver + celestialGarden.starweaver,
    moon: celestialInventory.moon + celestialGarden.moon,
    dawn: celestialInventory.dawn + celestialGarden.dawn,
  };

  const rbwMerged = Math.max(rbwCountFromStats ?? 0, rbwCountFromPets);

  return {
    rbwCount: Number.isFinite(rbwMerged) ? rbwMerged : null,
    rainbowGranterPetCount,
    petPowerBand: scorePetPowerBand(pets),
    storage: storageSignals,
    celestial,
    eggs,
    coins: resolveCoinSignal(),
  };
}

export function evaluateProgressionStage(signals: ProgressionSignalSnapshot): ProgressionStageSnapshot {
  const storageScore = weightedAverage([
    { weight: 0.35, value: scoreStorageSignal(signals.storage.petHutch) },
    { weight: 0.5, value: scoreStorageSignal(signals.storage.seedSilo) },
    { weight: 0.15, value: scoreStorageSignal(signals.storage.decorShed) },
  ]);

  const celestialScore = weightedAverage([
    { weight: 0.25, value: scoreCountBand(signals.celestial.starweaver) },
    { weight: 0.35, value: scoreCountBand(signals.celestial.moon) },
    { weight: 0.4, value: scoreCountBand(signals.celestial.dawn) },
  ]);

  const totalScore = weightedAverage([
    { weight: 18, value: scoreRbwBand(signals.rbwCount) },
    { weight: 18, value: scoreEggBand(signals.eggs) },
    { weight: 16, value: storageScore },
    { weight: 10, value: celestialScore },
    { weight: 10, value: scoreCoinBand(signals.coins) },
    { weight: 14, value: signals.petPowerBand },
    { weight: 14, value: scoreRainbowGranterBand(signals.rainbowGranterPetCount) },
  ]);

  const score = Math.round(((totalScore ?? 0) * 100) * 100) / 100;

  let stage: ProgressionStage = 'early';
  if (score >= 75) {
    stage = 'late';
  } else if (score >= 42) {
    stage = 'mid';
  }

  return {
    stage,
    score,
    signals,
  };
}

export function captureProgressionStage(pets: ComparePetInput[] = []): ProgressionStageSnapshot {
  const signals = captureProgressionSignals(pets);
  return evaluateProgressionStage(signals);
}
