// src/features/cropMutationAnalytics.ts - Analytics for Crop Mutation Boost abilities

import { getGardenSnapshot } from './bridge';
import { getWeatherSnapshot } from '../../store/weatherHub';
import { calculatePlantValue } from '../economy/valueCalculator';
import { getWeatherCatalog } from '../../catalogs/gameCatalogs';
import { getMutationApplicationResult } from '../../utils/mutationCompatibility';
import { isRecord } from '../../utils/typeGuards';
import { getFriendBonusMultiplier } from '../../store/friendBonus';
const HYDRO_EVENT_DURATION_MINUTES = 5;
const LUNAR_EVENT_DURATION_MINUTES = 10;

type MutationWeatherKind = 'rain' | 'snow' | 'dawn' | 'amber';

export interface EligibleCrop {
  species: string;
  scale: number;
  mutations: string[];
  currentValue: number;
  fruitCount: number;
  index: number;
}

export interface MutationPotential {
  weather: MutationWeatherKind | null;
  weatherDisplayName: string | null;
  grantedMutation: string | null;
  eligibleCrops: EligibleCrop[];
  eligibleFruits: number;
  averageValueGain: number;
  projectedMutationsPerEvent: number;
  baseMutationChance: number;
}

interface WeatherMutationEntry {
  mutation: string | null;
  displayName: string | null;
  chancePerMinutePerCrop: number | null;
  groupId: string | null;
}

function emptyMutationPotential(): MutationPotential {
  return {
    weather: null,
    weatherDisplayName: null,
    grantedMutation: null,
    eligibleCrops: [],
    eligibleFruits: 0,
    averageValueGain: 0,
    projectedMutationsPerEvent: 0,
    baseMutationChance: 0,
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeWeatherKind(
  value: string | null | undefined,
): MutationWeatherKind | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('rain')) return 'rain';
  if (normalized.includes('frost') || normalized.includes('snow')) return 'snow';
  if (normalized.includes('dawn')) return 'dawn';
  if (normalized.includes('amber')) return 'amber';
  return null;
}

function getMutationForWeather(weather: MutationWeatherKind): string {
  switch (weather) {
    case 'rain':
      return 'Wet';
    case 'snow':
      return 'Chilled';
    case 'dawn':
      return 'Dawnlit';
    case 'amber':
      return 'Ambershine';
  }
}

function getFallbackChancePerMinute(weather: MutationWeatherKind): number {
  return weather === 'rain' || weather === 'snow' ? 7 : 1;
}

function getFallbackDurationMinutes(weather: MutationWeatherKind): number {
  return weather === 'rain' || weather === 'snow'
    ? HYDRO_EVENT_DURATION_MINUTES
    : LUNAR_EVENT_DURATION_MINUTES;
}

function resolveWeatherDurationMinutes(
  groupId: string | null,
  startedAt: number | null,
  expectedEndAt: number | null,
  weather: MutationWeatherKind,
): number {
  if (startedAt != null && expectedEndAt != null && expectedEndAt > startedAt) {
    return (expectedEndAt - startedAt) / 60000;
  }

  const normalizedGroup = String(groupId ?? '').trim().toLowerCase();
  if (normalizedGroup === 'hydro') return HYDRO_EVENT_DURATION_MINUTES;
  if (normalizedGroup === 'lunar') return LUNAR_EVENT_DURATION_MINUTES;
  return getFallbackDurationMinutes(weather);
}

function resolvePerEventMutationChance(chancePerMinutePerCrop: number, durationMinutes: number): number {
  const perMinuteChance = Math.min(1, Math.max(0, chancePerMinutePerCrop / 100));
  if (perMinuteChance <= 0 || durationMinutes <= 0) return 0;
  return (1 - Math.pow(1 - perMinuteChance, durationMinutes)) * 100;
}

function resolveWeatherMutationEntry(weatherType: string | undefined | null): WeatherMutationEntry {
  if (!weatherType) {
    return {
      mutation: null,
      displayName: null,
      chancePerMinutePerCrop: null,
      groupId: null,
    };
  }

  const catalog = getWeatherCatalog();
  if (catalog) {
    const normalized = weatherType.toLowerCase();
    for (const [id, rawEntry] of Object.entries(catalog)) {
      if (!isRecord(rawEntry)) continue;
      const entryName = typeof rawEntry.name === 'string' ? rawEntry.name.toLowerCase() : '';
      if (
        id.toLowerCase() === normalized ||
        entryName === normalized ||
        id.toLowerCase().includes(normalized) ||
        normalized.includes(id.toLowerCase())
      ) {
        const mutator = isRecord(rawEntry.mutator) ? rawEntry.mutator : null;
        const mutation = typeof mutator?.mutation === 'string' ? mutator.mutation : null;
        const chancePerMinutePerCrop = toFiniteNumber(mutator?.chancePerMinutePerCrop);
        const displayName = typeof rawEntry.name === 'string' && rawEntry.name.trim().length > 0
          ? rawEntry.name
          : id;
        const groupId = typeof rawEntry.groupId === 'string' ? rawEntry.groupId : null;
        if (mutation) {
          return {
            mutation,
            displayName,
            chancePerMinutePerCrop,
            groupId,
          };
        }
      }
    }
  }

  const classified = normalizeWeatherKind(weatherType);
  if (!classified) {
    return {
      mutation: null,
      displayName: null,
      chancePerMinutePerCrop: null,
      groupId: null,
    };
  }

  return {
    mutation: getMutationForWeather(classified),
    displayName: classified === 'rain'
      ? 'Rain'
      : classified === 'snow'
        ? 'Snow'
        : classified === 'dawn'
          ? 'Dawn'
          : 'Amber Moon',
    chancePerMinutePerCrop: getFallbackChancePerMinute(classified),
    groupId: classified === 'rain' || classified === 'snow' ? 'Hydro' : 'Lunar',
  };
}

function extractFruitCount(tile: Record<string, unknown>): number {
  const fruitCount = toFiniteNumber(tile.fruitCount);
  if (fruitCount != null && fruitCount > 0) {
    return Math.floor(fruitCount);
  }

  const slotStates = tile.slotStates;
  if (Array.isArray(slotStates) && slotStates.length > 0) {
    return slotStates.length;
  }

  const displayName = typeof tile.displayName === 'string'
    ? tile.displayName
    : typeof tile.name === 'string'
      ? tile.name
      : null;
  if (displayName) {
    const match = displayName.match(/\+(\d+)/);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
  }

  return 1;
}

export function analyzeCropMutationPotential(): MutationPotential {
  const snapshot = getGardenSnapshot();
  const weather = getWeatherSnapshot();

  if (!snapshot) {
    return emptyMutationPotential();
  }

  const weatherType = weather.label ?? weather.kind ?? null;
  const activeWeather = weather.kind === 'rain'
    || weather.kind === 'snow'
    || weather.kind === 'dawn'
    || weather.kind === 'amber'
    ? weather.kind
    : normalizeWeatherKind(weatherType);

  if (!activeWeather) {
    return emptyMutationPotential();
  }

  const weatherEntry = resolveWeatherMutationEntry(weatherType);
  const grantedMutation = weatherEntry.mutation ?? getMutationForWeather(activeWeather);
  if (!grantedMutation) {
    return emptyMutationPotential();
  }

  const eligible: EligibleCrop[] = [];
  let totalFruits = 0;
  let totalPotentialValue = 0;

  const tileObjects = snapshot.tileObjects;
  if (tileObjects && typeof tileObjects === 'object') {
    for (const [tileIndex, rawTile] of Object.entries(tileObjects)) {
      if (!isRecord(rawTile) || rawTile.objectType !== 'plant') continue;

      const species = typeof rawTile.species === 'string'
        ? rawTile.species
        : typeof rawTile.plantSpecies === 'string'
          ? rawTile.plantSpecies
          : typeof rawTile.seedSpecies === 'string'
            ? rawTile.seedSpecies
            : null;
      if (!species) continue;

      const isMature = rawTile.fullyMature === true || rawTile.isMature === true;
      if (!isMature) continue;

      const scale = toFiniteNumber(rawTile.scale) ?? 1;
      const mutations = Array.isArray(rawTile.mutations)
        ? rawTile.mutations.filter((value): value is string => typeof value === 'string')
        : [];

      const nextMutations = getMutationApplicationResult(mutations, grantedMutation);
      if (!nextMutations) continue;

      const fruitCount = extractFruitCount(rawTile);
      if (fruitCount <= 0) continue;

      const currentValue = calculatePlantValue(species, scale, mutations, getFriendBonusMultiplier());
      const newValue = calculatePlantValue(species, scale, nextMutations, getFriendBonusMultiplier());
      const valueGain = newValue - currentValue;

      if (!Number.isFinite(valueGain) || valueGain <= 0) continue;

      eligible.push({
        species,
        scale,
        mutations,
        currentValue,
        fruitCount,
        index: Number.parseInt(tileIndex, 10),
      });
      totalFruits += fruitCount;
      totalPotentialValue += valueGain * fruitCount;
    }
  }

  const averageValueGain = totalFruits > 0 ? totalPotentialValue / totalFruits : 0;
  const chancePerMinutePerCrop = weatherEntry.chancePerMinutePerCrop ?? getFallbackChancePerMinute(activeWeather);
  const durationMinutes = resolveWeatherDurationMinutes(
    weatherEntry.groupId,
    weather.startedAt,
    weather.expectedEndAt,
    activeWeather,
  );
  const baseMutationChance = resolvePerEventMutationChance(chancePerMinutePerCrop, durationMinutes);
  const projectedMutationsPerEvent = eligible.length * (baseMutationChance / 100);

  return {
    weather: activeWeather,
    weatherDisplayName: weatherEntry.displayName ?? (
      activeWeather === 'rain'
        ? 'Rain'
        : activeWeather === 'snow'
          ? 'Snow'
          : activeWeather === 'dawn'
            ? 'Dawn'
            : 'Amber Moon'
    ),
    grantedMutation,
    eligibleCrops: eligible,
    eligibleFruits: totalFruits,
    averageValueGain,
    projectedMutationsPerEvent,
    baseMutationChance,
  };
}
