import { getAbilityDef, getAllAbilities, arePetAbilitiesCaptured, areCatalogsReady, getPetCatalog } from '../../../../catalogs/gameCatalogs';
import { getDayCycle, getDayCycleSourceStatus } from '../../../../catalogs/logic/dayCycleCatalog';
import type { DayCycleData, DayCycleSourceStatus, StageKeyMismatch } from '../../../../catalogs/logic/dayCycleCatalog';
import { compareStageKeys } from '../../../../catalogs/logic/dayCycleParsing';
import { getBundleFetchStats } from '../../../../catalogs/logic/bundleParser';
import { isGameStateReady, readSync } from '../../../../core/gameState';
import { getCapturedBuildId } from '../../../../diagnostics/gameVersionCapture';
import { ABILITY_METADATA } from './definitions';
import { canResolveParameterKey, getAbilityDefinition, getAllAbilityDefinitions } from './catalogAdapter';
import { getAbilityRateContext, getActiveCrystalTypes, getCrystalStrengthBonus } from './dayStage';
import { computeAbilityStats } from './stats';
import { getActivePetInfos } from '../../../../store/pets';
import { isHighValueAbility, isLowValueAbility } from './classification';
import { classifySizeBoostAbility, FLAT_SIZE_KEYS, PERCENT_SIZE_KEYS } from './sizeBoost';

const KNOWN_TRIGGERS = new Set(['continuous', 'hatchEgg', 'sellAllCrops', 'sellPet', 'harvest', 'playerActivated']);

export interface AbilityCatalogDrift {
  catalogOnly: string[];     // catalog ids QPM's alias metadata does not list (informational)
  hardcodedOnly: string[];   // metadata ids the catalog lacks: partial capture, stale bundle or rename
  unknownParamKeys: string[];
  unknownTriggers: string[];
  unclassified: string[];
}

const SIZE_LIKE_KEY_RE = /scale|size/i;

export interface CropSizeBoostAbilityInfo {
  effectMode: 'flatSize' | 'scalePercent' | 'unknown';
  parameterKey: string | null;
  parameterValue: number | null;
  baseProbability: number | null;
  requiredWeather: string | null;
  strengthScalesEffect: boolean | null;
}

export interface CropSizeBoostUnknown {
  abilityId: string;
  params: Record<string, unknown>;
  why: string;
}

export interface CropSizeBoostDrift {
  detectedIds: string[];
  perAbility: Record<string, CropSizeBoostAbilityInfo>;
  unknownShapes: CropSizeBoostUnknown[];
  catalogReady: boolean;
  petAbilitiesReady: boolean;
}

function pickSizeLikeKey(params: Record<string, unknown>): { key: string; value: unknown } | null {
  for (const [key, value] of Object.entries(params)) {
    if (SIZE_LIKE_KEY_RE.test(key)) return { key, value };
  }
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function getCropSizeBoostDrift(): CropSizeBoostDrift {
  const catalogReady = areCatalogsReady();
  const petAbilitiesReady = arePetAbilitiesCaptured();
  const detectedIds: string[] = [];
  const perAbility: Record<string, CropSizeBoostAbilityInfo> = {};
  const unknownShapes: CropSizeBoostUnknown[] = [];

  for (const id of getAllAbilities()) {
    const entry = getAbilityDef(id);
    if (!entry) continue;
    const params = (entry.baseParameters && typeof entry.baseParameters === 'object')
      ? (entry.baseParameters as Record<string, unknown>)
      : {};
    const shape = classifySizeBoostAbility(id);
    const requiredWeather = typeof params['requiredWeather'] === 'string' ? params['requiredWeather'] : null;
    const baseProbability = typeof entry.baseProbability === 'number' && Number.isFinite(entry.baseProbability) ? entry.baseProbability : null;

    if (shape) {
      detectedIds.push(id);
      const parameterKey = shape.kind === 'flatSize'
        ? [...FLAT_SIZE_KEYS].find((k) => k in params) ?? null
        : [...PERCENT_SIZE_KEYS].find((k) => k in params) ?? null;
      const parameterValue = shape.kind === 'flatSize' ? shape.amountPerProc : shape.percentPerProc;
      perAbility[id] = {
        effectMode: shape.kind,
        parameterKey,
        parameterValue,
        baseProbability,
        requiredWeather,
        strengthScalesEffect: shape.strengthScalesEffect,
      };
      continue;
    }

    const sizeLike = pickSizeLikeKey(params);
    if (sizeLike) {
      const value = toNumberOrNull(sizeLike.value);
      unknownShapes.push({
        abilityId: id,
        params,
        why: `unrecognized param key: ${sizeLike.key}${value == null ? ' (non-numeric)' : ''}`,
      });
      perAbility[id] = {
        effectMode: 'unknown',
        parameterKey: sizeLike.key,
        parameterValue: value,
        baseProbability,
        requiredWeather,
        strengthScalesEffect: null,
      };
    }
  }

  return {
    detectedIds,
    perAbility,
    unknownShapes,
    catalogReady,
    petAbilitiesReady,
  };
}

export function getAbilityCatalogDrift(): AbilityCatalogDrift {
  const catalogIds = getAllAbilities();
  const hardcoded = new Set(ABILITY_METADATA.map((d) => d.id));
  const catalogSet = new Set(catalogIds);
  const unknownParamKeys = new Set<string>();
  const unknownTriggers = new Set<string>();
  for (const id of catalogIds) {
    const entry = getAbilityDef(id);
    if (!entry) continue;
    if (typeof entry.trigger === 'string' && !KNOWN_TRIGGERS.has(entry.trigger)) unknownTriggers.add(entry.trigger);
    for (const key of Object.keys(entry.baseParameters ?? {})) {
      if (!canResolveParameterKey(key)) unknownParamKeys.add(key);
    }
  }
  return {
    catalogOnly: catalogIds.filter((id) => !hardcoded.has(id)),
    hardcodedOnly: [...hardcoded].filter((id) => !catalogSet.has(id)),
    unknownParamKeys: [...unknownParamKeys],
    unknownTriggers: [...unknownTriggers],
    unclassified: catalogIds.filter((id) => !isHighValueAbility(id) && !isLowValueAbility(id)),
  };
}

export interface DayStageDrift extends DayCycleData {
  build: string | null;
  source: DayCycleSourceStatus;
  cycleMinutes: number | null;
  bonusStageMismatch: StageKeyMismatch | null;
  currentStage: string | null;
  unknownStagesSeen: string[];        // stage values on the atom that the parsed cycle lacks
  nocturnalSpecies: string[];
  abilitiesInScope: Record<string, string[]>;  // continuous chance abilities by category
  activeCrystalTypes: string[];       // placed crystals with charge left in my garden
  crystalStrengthBonus: number;
  bundleFetch: ReturnType<typeof getBundleFetchStats>;  // REL-7: failed and given-up chunk URLs
}

export function getDayStageDrift(): DayStageDrift {
  const data = getDayCycle();
  const source = getDayCycleSourceStatus();
  const stageIds = data.stages ? new Set(data.stages.map((s) => s.id)) : null;
  const nocturnalSpecies = Object.entries(getPetCatalog() ?? {})
    .filter(([, entry]) => entry.isNocturnal === true)
    .map(([species]) => species);
  const abilitiesInScope: Record<string, string[]> = {};
  for (const def of getAllAbilityDefinitions()) {
    if (def.trigger !== 'continuous' || !((def.baseProbability ?? 0) > 0)) continue;
    (abilitiesInScope[def.category] ??= []).push(def.id);
  }
  return {
    ...data,
    build: getCapturedBuildId(),
    source,
    cycleMinutes: data.stages ? data.stages.reduce((sum, s) => sum + s.minutes, 0) : null,
    bonusStageMismatch: data.stages && data.nocturnalBonus ? compareStageKeys(data.stages, data.nocturnalBonus) : null,
    currentStage: isGameStateReady() ? readSync('dayNightStage') : null,
    unknownStagesSeen: stageIds ? source.stagesSeen.filter((s) => !stageIds.has(s)) : [],
    nocturnalSpecies,
    abilitiesInScope,
    activeCrystalTypes: [...getActiveCrystalTypes()],
    crystalStrengthBonus: getCrystalStrengthBonus(data),
    bundleFetch: getBundleFetchStats(),
  };
}

export interface AbilityRateRow {
  slotIndex: number;
  species: string | null;
  strength: number | null;
  abilityId: string;
  stage: string | null;
  nocturnal: boolean;
  stageBonus: number;
  crystalBonus: number;
  multiplier: number;
  cardChancePerMinute: number;   // percent, as the game's ability card shows it
  procsPerHour: number;
  dayAverageProcsPerHour: number | null;
}

/** Every active pet's continuous chance ability through the shared maths (REL-6). */
export function getAbilityRateReport(): AbilityRateRow[] {
  const rows: AbilityRateRow[] = [];
  for (const pet of getActivePetInfos()) {
    const context = getAbilityRateContext(pet.species);
    for (const abilityId of pet.abilities) {
      const def = getAbilityDefinition(abilityId);
      if (!def || def.trigger !== 'continuous' || !((def.baseProbability ?? 0) > 0)) continue;
      const stats = computeAbilityStats(def, pet.strength, context);
      rows.push({
        slotIndex: pet.slotIndex,
        species: pet.species,
        strength: pet.strength,
        abilityId: def.id,
        stage: stats.stage,
        nocturnal: context.isNocturnal,
        stageBonus: stats.stageBonus,
        crystalBonus: context.strengthBonus,
        multiplier: stats.multiplier,
        cardChancePerMinute: stats.chancePerMinute,
        procsPerHour: stats.procsPerHour,
        dayAverageProcsPerHour: stats.dayAverage?.procsPerHour ?? null,
      });
    }
  }
  return rows;
}
