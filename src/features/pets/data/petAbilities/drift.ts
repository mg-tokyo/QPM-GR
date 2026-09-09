import { getAbilityDef, getAllAbilities, arePetAbilitiesCaptured, areCatalogsReady } from '../../../../catalogs/gameCatalogs';
import { ABILITY_DEFINITIONS } from './definitions';
import { canResolveParameterKey } from './catalogAdapter';
import { isHighValueAbility, isLowValueAbility } from './classification';
import { classifySizeBoostAbility, FLAT_SIZE_KEYS, PERCENT_SIZE_KEYS } from './sizeBoost';

const KNOWN_TRIGGERS = new Set(['continuous', 'hatchEgg', 'sellAllCrops', 'sellPet', 'harvest', 'playerActivated']);

export interface AbilityCatalogDrift {
  catalogOnly: string[];
  hardcodedOnly: string[];
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
  const hardcoded = new Set(ABILITY_DEFINITIONS.map((d) => d.id));
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
