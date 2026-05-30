import type { ActivePetInfo } from '../store/pets';
import { findAbilityHistoryForIdentifiers, type AbilityHistory, type AbilityEvent } from '../store/abilityLogs';
import { getAbilityDefinition, computeAbilityStats, computeEffectPerHour, type AbilityDefinition } from '../features/pets/data/petAbilities';
import { buildAbilityValuationContext, resolveDynamicAbilityEffect, type DynamicAbilityEffect } from '../features/pets/abilityValuation';

// ---- Constants ----

export const ABILITY_HISTORY_LOOKBACK_MS = 1000 * 60 * 60 * 4;

// ---- Internal helpers ----

const normalizeNumericValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.+-]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const extractNumericField = (source: unknown, ...fields: string[]): number | null => {
  if (!source || typeof source !== 'object') {
    return null;
  }
  const record = source as Record<string, unknown>;
  for (const field of fields) {
    if (!(field in record)) continue;
    const numeric = normalizeNumericValue(record[field]);
    if (numeric != null) {
      return numeric;
    }
  }
  return null;
};

const getAbilityHistoryForPet = (info: ActivePetInfo, abilityId: string): AbilityHistory | null => {
  const fallback: string[] = [];
  if (info.petId) fallback.push(info.petId);
  if (info.slotId) fallback.push(info.slotId);
  if (typeof info.slotIndex === 'number' && Number.isFinite(info.slotIndex)) {
    fallback.push(String(Math.max(0, Math.round(info.slotIndex))));
  }

  return findAbilityHistoryForIdentifiers(abilityId, {
    petId: info.petId,
    slotId: info.slotId,
    slotIndex: typeof info.slotIndex === 'number' && Number.isFinite(info.slotIndex) ? info.slotIndex : null,
    fallbackKeys: fallback,
  });
};

const getRecentAbilityEvents = (history: AbilityHistory): AbilityEvent[] => {
  const cutoff = Date.now() - ABILITY_HISTORY_LOOKBACK_MS;
  return history.events.filter((event) => event.performedAt >= cutoff);
};

interface AbilityObservation {
  procsPerHour: number | null;
  effectPerProc: number | null;
  lastProcAt: number | null;
  sampleCount: number;
}

const extractAbilityEventEffect = (definition: AbilityDefinition, event: AbilityEvent): number | null => {
  const data = event.data;
  switch (definition.category) {
    case 'xp':
      return extractNumericField(data, 'bonusXp', 'xp', 'value');
    case 'plantGrowth':
      return extractNumericField(data, 'plantGrowthReductionMinutes', 'reductionMinutes', 'minutes');
    case 'eggGrowth':
      return extractNumericField(data, 'eggGrowthTimeReductionMinutes', 'reductionMinutes', 'minutes');
    case 'coins':
      return extractNumericField(
        data,
        'coinsFound',
        'coins',
        'coinsEarned',
        'sellPrice',
        'bonusCoins',
        'value',
        'valueEarned',
        'coinsValue',
      );
    default:
      return null;
  }
};

export const computeObservedMetrics = (history: AbilityHistory, definition: AbilityDefinition): AbilityObservation | null => {
  const recent = getRecentAbilityEvents(history);
  if (!recent.length) {
    return null;
  }

  const latest = recent[recent.length - 1]!;
  const earliest = recent[0]!;

  let procsPerHour: number | null = null;
  if (recent.length >= 2) {
    const spanMs = latest.performedAt - earliest.performedAt;
    if (spanMs > 0) {
      procsPerHour = (recent.length - 1) / (spanMs / 3_600_000);
    }
  }

  const effects: number[] = [];
  for (const event of recent) {
    const effect = extractAbilityEventEffect(definition, event);
    if (effect != null && Number.isFinite(effect)) {
      effects.push(effect);
    }
  }
  const effectPerProc = effects.length ? effects.reduce((sum, value) => sum + value, 0) / effects.length : null;

  return {
    procsPerHour,
    effectPerProc,
    lastProcAt: latest.performedAt,
    sampleCount: recent.length,
  };
};

// ---- Exported types ----

type AbilityEffectSource = 'observed' | 'definition' | 'computed';

export interface AbilityContribution {
  pet: ActivePetInfo;
  petIndex: number;
  displayName: string;
  abilityName: string;
  definition: AbilityDefinition;
  procsPerHour: number;
  procsPerHourSource: 'observed' | 'estimated';
  chancePerMinute: number;
  expectedMinutesBetween: number | null;
  lastProcAt: number | null;
  sampleCount: number;
  effectPerProc: number | null;
  effectSource: AbilityEffectSource;
  effectDetail: string | null;
  effectPerHour: number;
}

export interface AbilityGroup {
  definition: AbilityDefinition;
  entries: AbilityContribution[];
  totalProcsPerHour: number;
  chancePerMinute: number;
  combinedEtaMinutes: number | null;
  effectPerHour: number;
  totalSamples: number;
  lastProcAt: number | null;
  averageEffectPerProc: number | null;
}

export interface AbilityTotals {
  xpPerHour: number;
  plantMinutesPerHour: number;
  eggMinutesPerHour: number;
  coinsPerHour: number;
}

interface UnknownAbilityEntry {
  abilityName: string;
  pet: ActivePetInfo;
}

export interface AbilityAnalysis {
  groups: AbilityGroup[];
  totals: AbilityTotals;
  unknown: UnknownAbilityEntry[];
}

export type TrackerTargetMode = 'nextLevel' | 'maxLevel';

function createEmptyAbilityAnalysis(): AbilityAnalysis {
  return {
    groups: [],
    totals: {
      xpPerHour: 0,
      plantMinutesPerHour: 0,
      eggMinutesPerHour: 0,
      coinsPerHour: 0,
    },
    unknown: [],
  };
}

export function getPetDisplayName(pet: ActivePetInfo): string {
  if (pet.name && pet.name.trim().length > 0) {
    return pet.name;
  }
  if (pet.species && pet.species.trim().length > 0) {
    return pet.species;
  }
  if (typeof pet.slotIndex === 'number' && Number.isFinite(pet.slotIndex)) {
    return `Pet ${pet.slotIndex + 1}`;
  }
  return 'Unknown pet';
}

export function analyzeActivePetAbilities(infos: ActivePetInfo[]): AbilityAnalysis {
  if (!infos.length) {
    return createEmptyAbilityAnalysis();
  }

  const valuationContext = buildAbilityValuationContext();
  const dynamicEffectCache = new Map<string, DynamicAbilityEffect | null>();

  const groupMap = new Map<string, AbilityGroup>();
  const unknown: UnknownAbilityEntry[] = [];

  infos.forEach((info, petIndex) => {
    const abilities = Array.isArray(info.abilities) ? info.abilities : [];
    for (const raw of abilities) {
      if (!raw) continue;

      const definition = getAbilityDefinition(raw);
      if (!definition) {
        unknown.push({ abilityName: raw, pet: info });
        continue;
      }
      if (definition.trigger !== 'continuous') {
        continue;
      }

      const stats = computeAbilityStats(definition, info.strength);
      const history = getAbilityHistoryForPet(info, definition.id);
      const observation = history ? computeObservedMetrics(history, definition) : null;

      const normalizedStrength = typeof info.strength === 'number' && Number.isFinite(info.strength) ? info.strength : null;
      const cacheKey = `${definition.id}::${normalizedStrength != null ? normalizedStrength.toFixed(2) : 'baseline'}`;
      let dynamicEffect = dynamicEffectCache.get(cacheKey);
      if (dynamicEffect === undefined) {
        dynamicEffect = resolveDynamicAbilityEffect(definition.id, valuationContext, normalizedStrength);
        dynamicEffectCache.set(cacheKey, dynamicEffect ?? null);
      }

      const observedProcsPerHour = observation?.procsPerHour ?? null;
      const procsPerHour =
        observedProcsPerHour != null && observedProcsPerHour > 0 ? observedProcsPerHour : stats.procsPerHour;
      const procsPerHourSource = observedProcsPerHour != null && observedProcsPerHour > 0 ? 'observed' : 'estimated';

      const observedEffectPerProc = observation?.effectPerProc ?? null;
      const computedEffectPerProc = dynamicEffect?.effectPerProc ?? null;
      const definitionEffectPerProc = definition.effectValuePerProc ?? null;

      let effectPerProc: number | null = null;
      let effectSource: AbilityEffectSource = 'definition';
      let effectDetail: string | null = dynamicEffect?.detail ?? null;

      if (observedEffectPerProc != null && observedEffectPerProc > 0) {
        effectPerProc = observedEffectPerProc;
        effectSource = 'observed';
        effectDetail = observation?.sampleCount ? `Observed average from ${observation.sampleCount} recent sample${observation.sampleCount === 1 ? '' : 's'}.` : 'Observed from ability log.';
      } else if (computedEffectPerProc != null && computedEffectPerProc > 0) {
        effectPerProc = computedEffectPerProc;
        effectSource = 'computed';
      } else if (definitionEffectPerProc != null && definitionEffectPerProc > 0) {
        effectPerProc = definitionEffectPerProc;
        effectSource = 'definition';
        effectDetail = definition.notes ?? null;
      }

      const effectPerHour =
        effectPerProc != null && procsPerHour > 0 ? procsPerHour * effectPerProc : computeEffectPerHour(definition, stats, info.strength);

      const lastProcAt = observation?.lastProcAt ?? (history?.lastPerformedAt ?? null);
      const sampleCount = observation?.sampleCount ?? 0;

      const contribution: AbilityContribution = {
        pet: info,
        petIndex,
        displayName: getPetDisplayName(info),
        abilityName: raw,
        definition,
        procsPerHour,
        procsPerHourSource,
        chancePerMinute: stats.chancePerMinute,
        expectedMinutesBetween: procsPerHour > 0 ? 60 / procsPerHour : null,
        lastProcAt,
        sampleCount,
        effectPerProc,
        effectSource,
        effectDetail,
        effectPerHour,
      };

      const key = definition.id;
      const existing = groupMap.get(key);
      if (existing) {
        existing.entries.push(contribution);
        existing.totalProcsPerHour += procsPerHour;
        existing.effectPerHour += effectPerHour;
        existing.totalSamples += sampleCount;
        if (existing.lastProcAt == null || (lastProcAt != null && lastProcAt > existing.lastProcAt)) {
          existing.lastProcAt = lastProcAt;
        }
      } else {
        groupMap.set(key, {
          definition,
          entries: [contribution],
          totalProcsPerHour: procsPerHour,
          chancePerMinute: procsPerHour / 60,
          combinedEtaMinutes: procsPerHour > 0 ? 60 / procsPerHour : null,
          effectPerHour,
          totalSamples: sampleCount,
          lastProcAt,
          averageEffectPerProc: effectPerProc,
        });
      }
    }
  });

  if (groupMap.size === 0 && unknown.length === 0) {
    return createEmptyAbilityAnalysis();
  }

  const totals: AbilityTotals = {
    xpPerHour: 0,
    plantMinutesPerHour: 0,
    eggMinutesPerHour: 0,
    coinsPerHour: 0,
  };

  const orderedGroups = Array.from(groupMap.values())
    .map((group) => {
      group.chancePerMinute = group.entries.reduce((sum, entry) => sum + entry.chancePerMinute, 0);
      group.combinedEtaMinutes = group.totalProcsPerHour > 0 ? 60 / group.totalProcsPerHour : null;
      group.averageEffectPerProc =
        group.totalProcsPerHour > 0 ? group.effectPerHour / group.totalProcsPerHour : null;

      switch (group.definition.category) {
        case 'xp':
          totals.xpPerHour += group.effectPerHour;
          break;
        case 'plantGrowth':
          totals.plantMinutesPerHour += group.effectPerHour;
          break;
        case 'eggGrowth':
          totals.eggMinutesPerHour += group.effectPerHour;
          break;
        case 'coins':
          totals.coinsPerHour += group.effectPerHour;
          break;
        default:
          // misc abilities with effectUnit 'coins' (granters, scale boosts, etc.)
          if (group.definition.effectUnit === 'coins' && group.effectPerHour > 0) {
            totals.coinsPerHour += group.effectPerHour;
          }
          break;
      }

      return group;
    })
    .sort((a, b) => b.totalProcsPerHour - a.totalProcsPerHour);

  return {
    groups: orderedGroups,
    totals,
    unknown,
  };
}
