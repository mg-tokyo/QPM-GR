// src/features/petFoodRules/rules.ts
// State CRUD, persistence, event dispatch, override management

import { storage } from '../../../utils/storage';
import { normalizeSpeciesKey } from '../../../utils/helpers';
import { getAllPetDiets } from '../../../catalogs/gameCatalogs';
import { healthBus } from '../../../diagnostics/healthBus';
import { createNamedLogger } from '../../../diagnostics/logger';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';
import type { PetFoodRulesState, SpeciesOverride, SpeciesCatalogEntry } from './types';
import { formatFoodLabelForSpecies } from './diet';

// ── Diagnostics ───────────────────────────────────────────────────────────

export const PET_FOOD_RULES_SUBSYSTEM: Subsystem = 'feature:petFoodRules';
const FEATURE_NAME = 'petFoodRules';
export const petFoodRulesLog = createNamedLogger(PET_FOOD_RULES_SUBSYSTEM);
let busRegistered = false;

/**
 * Re-attribute a FEATURE-* code emission to this feature's bus row. The
 * registered placeholder subsystem on FEATURE-* is `'feature'`; without this
 * override the bus would degrade a generic `feature` entry instead of
 * `feature:petFoodRules`.
 */
export function warnPetFoodRulesFeature(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  petFoodRulesLog.warn({ ...built, subsystem: PET_FOOD_RULES_SUBSYSTEM, severity: 'warn' });
}

export function initializeFoodRules(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(PET_FOOD_RULES_SUBSYSTEM, { category: 'feature', status: 'starting' });
  healthBus.publish({
    subsystem: PET_FOOD_RULES_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message: 'Rules loaded',
    metrics: { overrides: Object.keys(rulesState.overrides).length, avoidFavorited: String(rulesState.avoidFavorited) },
  });
  petFoodRulesLog.info('Initialized', { overrides: Object.keys(rulesState.overrides).length });
}

const STORAGE_KEY = 'quinoa-pet-food-rules';
const PET_FOOD_RULES_EVENT = 'qpm:pet-food-rules-changed';
export const PET_FOOD_RULES_CHANGED_EVENT = PET_FOOD_RULES_EVENT;

const DEFAULT_STATE: PetFoodRulesState = {
  avoidFavorited: true,
  overrides: {},
  updatedAt: Date.now(),
};

export const DEFAULT_SAFE_FOODS = ['Carrot', 'Strawberry', 'Blueberry', 'Apple', 'Watermelon', 'Pumpkin'];

export const DEFAULT_SAFE_NORMALIZED = DEFAULT_SAFE_FOODS.map(food => normalizeSpeciesKey(food));

let rulesState: PetFoodRulesState = loadState();

export function getRulesState(): PetFoodRulesState {
  return rulesState;
}

export function formatFriendlyName(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .trim();
}

function loadState(): PetFoodRulesState {
  const stored = storage.get<Partial<PetFoodRulesState>>(STORAGE_KEY, {});
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_STATE };
  }
  return {
    avoidFavorited: typeof stored.avoidFavorited === 'boolean' ? stored.avoidFavorited : DEFAULT_STATE.avoidFavorited,
    overrides: typeof stored.overrides === 'object' && stored.overrides
      ? stored.overrides as Record<string, SpeciesOverride>
      : {},
    updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : Date.now(),
  };
}

function saveState(): void {
  storage.set(STORAGE_KEY, rulesState);
}

function emitRulesChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(PET_FOOD_RULES_EVENT, {
      detail: {
        avoidFavorited: rulesState.avoidFavorited,
        updatedAt: rulesState.updatedAt,
      },
    }));
  } catch (err) {
    warnPetFoodRulesFeature('QPM-FEATURE-004', { what: 'emit:rulesChanged' }, err);
  }
}

export function getPetFoodRules(): PetFoodRulesState {
  return {
    avoidFavorited: rulesState.avoidFavorited,
    overrides: { ...rulesState.overrides },
    updatedAt: rulesState.updatedAt,
  };
}

export function setAvoidFavoritedFoods(enabled: boolean): void {
  if (rulesState.avoidFavorited === enabled) {
    return;
  }
  rulesState = {
    ...rulesState,
    avoidFavorited: enabled,
    updatedAt: Date.now(),
  };
  saveState();
  emitRulesChanged();
}

export function updateSpeciesOverride(species: string, override: SpeciesOverride | null): void {
  const key = normalizeSpeciesKey(species);
  if (!key) return;

  const overrides = { ...rulesState.overrides };
  if (!override || (!override.allowed && !override.forbidden && !override.preferred)) {
    delete overrides[key];
  } else {
    const nextOverride: SpeciesOverride = {};
    if (Array.isArray(override.allowed) && override.allowed.length > 0) {
      nextOverride.allowed = override.allowed
        .map(entry => normalizeSpeciesKey(entry))
        .filter((entry): entry is string => !!entry);
      if (nextOverride.allowed.length === 0) {
        delete nextOverride.allowed;
      }
    }
    if (Array.isArray(override.forbidden) && override.forbidden.length > 0) {
      nextOverride.forbidden = override.forbidden
        .map(entry => normalizeSpeciesKey(entry))
        .filter((entry): entry is string => !!entry);
      if (nextOverride.forbidden.length === 0) {
        delete nextOverride.forbidden;
      }
    }
    if (override.preferred) {
      const preferred = normalizeSpeciesKey(override.preferred);
      if (preferred) {
        nextOverride.preferred = preferred;
      }
    }

    if (!nextOverride.allowed && !nextOverride.forbidden && !nextOverride.preferred) {
      delete overrides[key];
    } else {
      overrides[key] = nextOverride;
    }
  }

  rulesState = {
    ...rulesState,
    overrides,
    updatedAt: Date.now(),
  };
  saveState();
  emitRulesChanged();
}

export function resetPetFoodRules(): void {
  rulesState = { ...DEFAULT_STATE, updatedAt: Date.now() };
  saveState();
  emitRulesChanged();
}

export function getPetSpeciesCatalog(): SpeciesCatalogEntry[] {
  const entries = new Map<string, SpeciesCatalogEntry>();
  const runtimeDiets = getAllPetDiets();

  for (const species of Object.keys(runtimeDiets)) {
    const key = normalizeSpeciesKey(species);
    if (!key) continue;
    entries.set(key, {
      species,
      key,
      label: formatFriendlyName(species),
    });
  }

  for (const key of Object.keys(rulesState.overrides)) {
    if (entries.has(key)) continue;
    entries.set(key, {
      species: key,
      key,
      label: formatFriendlyName(key),
    });
  }

  return Array.from(entries.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function getSpeciesPreferredFood(species: string): string | null {
  const key = normalizeSpeciesKey(species);
  if (!key) return null;
  const override = rulesState.overrides[key] || null;
  if (override?.preferred) {
    return override.preferred;
  }
  return null;
}

export function setSpeciesPreferredFood(species: string, foodKey: string | null): void {
  const speciesKey = normalizeSpeciesKey(species);
  if (!speciesKey) return;

  const overrides = { ...rulesState.overrides };
  const existing = overrides[speciesKey];

  const nextOverride: SpeciesOverride = {};
  if (existing?.allowed && existing.allowed.length > 0) {
    nextOverride.allowed = [...existing.allowed];
  }
  if (existing?.forbidden && existing.forbidden.length > 0) {
    nextOverride.forbidden = [...existing.forbidden];
  }

  if (foodKey && foodKey.trim()) {
    const normalizedFood = normalizeSpeciesKey(foodKey);
    if (normalizedFood) {
      nextOverride.preferred = normalizedFood;
    }
  }

  const hasPreferred = typeof nextOverride.preferred === 'string' && nextOverride.preferred.length > 0;
  const hasAllowed = Array.isArray(nextOverride.allowed) && nextOverride.allowed.length > 0;
  const hasForbidden = Array.isArray(nextOverride.forbidden) && nextOverride.forbidden.length > 0;

  if (!hasPreferred) {
    delete nextOverride.preferred;
  }
  if (!hasAllowed) {
    delete nextOverride.allowed;
  }
  if (!hasForbidden) {
    delete nextOverride.forbidden;
  }

  if (hasPreferred || hasAllowed || hasForbidden) {
    overrides[speciesKey] = nextOverride;
  } else {
    delete overrides[speciesKey];
  }

  rulesState = {
    ...rulesState,
    overrides,
    updatedAt: Date.now(),
  };
  saveState();
  emitRulesChanged();

  const speciesLabel = formatFriendlyName(species);
  if (hasPreferred && nextOverride.preferred) {
    const foodLabel = formatFoodLabelForSpecies(species, nextOverride.preferred);
    petFoodRulesLog.info(`Preferred food set for ${speciesLabel}: ${foodLabel}`);
  } else {
    petFoodRulesLog.info(`Preferred food cleared for ${speciesLabel}`);
  }
}
