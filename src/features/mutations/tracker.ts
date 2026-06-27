// src/features/mutationTracker.ts
import { getGardenSnapshot, onGardenSnapshot, type GardenSnapshot } from '../garden/bridge';
import {
  buildMutationSummary,
  combineMutationSources,
  computeSlotStateFromMutationNames,
  createMutationCountMap,
  deriveWeatherWindowFromSnapshot,
  type MutationLetter,
  type MutationStage,
  type PlantData,
  type PlantSlotState,
  type WeatherType,
} from './reminder';
import {
  createEmptyMutationDebugMap,
  publishMutationSummary,
  updateMutationDebugSnapshot,
  createMutationDebugMetadata,
  type MutationDebugWeatherEntry,
} from '../../store/mutationSummary';
import { getWeatherSnapshot, onWeatherSnapshot, startWeatherHub, type WeatherSnapshot } from '../../store/weatherHub';
import type { DetailedWeather } from '../../utils/game/weatherDetection';
import { log } from '../../utils/logger';

let initialized = false;
let gardenUnsubscribe: (() => void) | null = null;
let weatherUnsubscribe: (() => void) | null = null;
let latestSnapshot: GardenSnapshot | null = null;
let currentWeather: WeatherType = 'unknown';
let evaluationTimer: number | null = null;
let latestWeatherSnapshot: WeatherSnapshot | null = null;

const EVALUATION_DELAY_MS = 75;
const STAGE_KEYS: MutationStage[] = ['wet', 'dawn', 'amber'];

export function startMutationTracker(): void {
  if (initialized) return;
  initialized = true;

  log('🌿 Garden mutation tracker starting...');

  startWeatherHub();
  latestWeatherSnapshot = getWeatherSnapshot();
  currentWeather = mapDetailedWeather(latestWeatherSnapshot.kind);
  latestSnapshot = getGardenSnapshot();

  weatherUnsubscribe = onWeatherSnapshot((snapshot) => {
    const prevSnapshot = latestWeatherSnapshot;
    latestWeatherSnapshot = snapshot;
    const nextWeather = mapDetailedWeather(snapshot.kind);
    const weatherChanged = nextWeather !== currentWeather;
    const windowChanged =
      !prevSnapshot ||
      prevSnapshot.startedAt !== snapshot.startedAt ||
      prevSnapshot.expectedEndAt !== snapshot.expectedEndAt ||
      prevSnapshot.hash !== snapshot.hash;

    if (weatherChanged) {
      currentWeather = nextWeather;
      scheduleEvaluation();
    } else if (windowChanged && nextWeather !== 'unknown') {
      scheduleEvaluation();
    }
  });

  gardenUnsubscribe = onGardenSnapshot((snapshot) => {
    latestSnapshot = snapshot;
    scheduleEvaluation();
  }, true);

  scheduleEvaluation();
  log('🌿 Garden mutation tracker ready');
}

export function stopMutationTracker(): void {
  if (!initialized) return;
  gardenUnsubscribe?.();
  weatherUnsubscribe?.();
  gardenUnsubscribe = null;
  weatherUnsubscribe = null;
  latestSnapshot = null;
  latestWeatherSnapshot = null;
  if (evaluationTimer !== null) {
    clearTimeout(evaluationTimer);
    evaluationTimer = null;
  }
  initialized = false;
  log('🌿 Garden mutation tracker stopped');
}

function scheduleEvaluation(): void {
  if (!initialized) return;
  if (evaluationTimer !== null) return;
  evaluationTimer = window.setTimeout(() => {
    evaluationTimer = null;
    evaluate();
  }, EVALUATION_DELAY_MS);
}

function evaluate(): void {
  if (!initialized) return;
  const plants = collectPlants(latestSnapshot);
  const debugPerWeather = createEmptyMutationDebugMap();
  const summary = buildMutationSummary(
    plants,
    currentWeather,
    deriveWeatherWindowFromSnapshot(currentWeather, latestWeatherSnapshot),
    (weather, plant, stats) => {
      const entry: MutationDebugWeatherEntry = {
        name: plant.name,
        pendingFruit: stats.pendingFruit,
        needsSnowFruit: stats.needsSnowFruit,
        fruitCount: plant.fruitCount,
        source: plant.slotSource,
      };
      if (stats.tag) {
        entry.tag = stats.tag;
      }
      debugPerWeather[weather].push(entry);
    },
  );
  publishMutationSummary('garden', summary);
  updateMutationDebugSnapshot({
    source: 'garden',
    generatedAt: summary.timestamp,
    summary,
    perWeather: debugPerWeather,
    metadata: createMutationDebugMetadata(summary, {
      scannedPlantCount: plants.length,
    }),
  });
}

function collectPlants(snapshot: GardenSnapshot | null): PlantData[] {
  const plants: PlantData[] = [];
  if (!snapshot) {
    return plants;
  }

  const areas: Array<{ label: 'garden' | 'boardwalk'; tiles: Record<string, unknown> | null | undefined }> = [
    { label: 'garden', tiles: snapshot.tileObjects as Record<string, unknown> | undefined },
    { label: 'boardwalk', tiles: snapshot.boardwalkTileObjects as Record<string, unknown> | undefined },
  ];

  for (const { label, tiles } of areas) {
    if (!tiles || typeof tiles !== 'object') continue;

    for (const [tileId, rawTile] of Object.entries(tiles)) {
      if (!rawTile || typeof rawTile !== 'object') continue;
      const tile = rawTile as Record<string, unknown>;
      if (tile.objectType !== 'plant') continue;

      const { slotStates, inferredSpecies } = extractSlotStates(tile);
      const fruitCount = slotStates.length;
      if (fruitCount === 0) continue;

      const domMutationCounts = buildMutationCounts(slotStates);
      const domBoldCounts = buildBoldCounts(slotStates);
      const mutations = combineMutationSources(slotStates, domMutationCounts, domBoldCounts);
      const baseName = resolvePlantName(tile, inferredSpecies);
      const name = `${baseName} [${label}:${tileId}]`;

      plants.push({
        name,
        mutations,
        element: document.createElement('div'),
        fruitCount,
        slotStates,
        slotSource: 'garden',
        domMutationCounts,
        domBoldCounts,
      });
    }
  }

  return plants;
}

function extractSlotStates(tile: Record<string, unknown>): { slotStates: PlantSlotState[]; inferredSpecies: string | null } {
  const slotsRaw = Array.isArray(tile.slots) ? tile.slots : [];
  const slotStates: PlantSlotState[] = [];
  let inferredSpecies: string | null = null;

  for (const slotRaw of slotsRaw) {
    if (!slotRaw || typeof slotRaw !== 'object') continue;
    const slot = slotRaw as Record<string, unknown>;

    const slotSpecies = readSlotSpecies(slot);
    if (slotSpecies && !inferredSpecies) {
      inferredSpecies = slotSpecies;
    }

    const mutationsRaw = Array.isArray(slot.mutations) ? slot.mutations : [];
    const mutationNames = (mutationsRaw as unknown[])
      .map((value) => (typeof value === 'string' ? value : null))
      .filter((value): value is string => !!value);

    const slotState = computeSlotStateFromMutationNames(mutationNames);
    mergeSlotProgress(slotState, slot);
    slotStates.push(slotState);
  }

  return { slotStates, inferredSpecies };
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

function mergeSlotProgress(slotState: PlantSlotState, slot: Record<string, unknown>): void {
  const progressSources = [
    (slot as { progress?: unknown }).progress,
    (slot as { mutationProgress?: unknown }).mutationProgress,
  ];

  for (const source of progressSources) {
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    for (const stage of STAGE_KEYS) {
      const entry = record[stage];
      if (!entry || typeof entry !== 'object') continue;
      const progress = entry as Record<string, unknown>;
      const complete = Number(progress.complete);
      const total = Number(progress.total);
      if (!Number.isFinite(total) || total <= 0) continue;
      if (!Number.isFinite(complete) || complete < 0) continue;
      const existing = slotState.progress[stage];
      if (!existing || total > existing.total || (total === existing.total && complete > existing.complete)) {
        slotState.progress[stage] = { complete, total };
      }
    }
  }
}

function buildMutationCounts(slotStates: PlantSlotState[]): Record<MutationLetter, number> {
  const counts = createMutationCountMap(0);
  for (const slot of slotStates) {
    if (slot.hasFrozen) counts.F += 1;
    if (slot.hasWet) counts.W += 1;
    if (slot.hasChilled) counts.C += 1;
    if (slot.hasDawnlit || slot.hasDawnbound) counts.D += 1;
    if (slot.hasAmberlit || slot.hasAmberbound) counts.A += 1;
    if (slot.hasRainbow) counts.R += 1;
    if (slot.hasGold) counts.G += 1;
  }
  return counts;
}

function buildBoldCounts(slotStates: PlantSlotState[]): Record<'D' | 'A', number> {
  return {
    D: slotStates.filter((slot) => slot.hasDawnbound).length,
    A: slotStates.filter((slot) => slot.hasAmberbound).length,
  };
}

function resolvePlantName(tile: Record<string, unknown>, species: string | null): string {
  const candidates: unknown[] = [
    tile.name,
    tile.displayName,
    tile.plantName,
    tile.label,
  ];

  const plant = tile.plant;
  if (plant && typeof plant === 'object') {
    const nested = plant as Record<string, unknown>;
    candidates.push(nested.name);
    candidates.push(nested.displayName);
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  if (species && species.length > 0) {
    return species.toLowerCase().includes('plant') ? species : `${species} Plant`;
  }

  return 'Unknown Plant';
}

function mapDetailedWeather(kind: DetailedWeather): WeatherType {
  switch (kind) {
    case 'rain':
    case 'snow':
    case 'dawn':
    case 'amber':
    case 'thunderstorm':
      return kind;
    case 'sunny':
      return 'sunny';
    default:
      return 'unknown';
  }
}
