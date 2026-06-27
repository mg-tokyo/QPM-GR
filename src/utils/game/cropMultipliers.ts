// src/utils/cropMultipliers.ts
// Shared helpers for resolving mutation multipliers and keeping alias handling consistent.
//
// Game formula (from sell.ts / mutationsDex.ts):
//   mutationMultiplier = growthMult × (1 + SUM(envCoinMultipliers) - count(envMutations))
// where "growth" = Gold/Rainbow and "environment" = everything else.

import { getMutationCatalog, getMutation as getCatalogMutation } from '../../catalogs/gameCatalogs';

export type MutationCategory = 'color' | 'weather' | 'time';

export interface MutationDefinition {
  readonly name: string;
  readonly category: MutationCategory;
  /** Raw coinMultiplier value from mutationsDex (NOT the effective contribution). */
  readonly multiplier: number;
  readonly aliases?: readonly string[];
}

export interface MutationEntry {
  readonly definition: MutationDefinition;
  readonly sourceName: string;
}

export interface MutationMultiplierBreakdown {
  readonly color: MutationEntry | null;
  readonly weather: MutationEntry | null;
  readonly time: MutationEntry | null;
  /** @deprecated Combo table removed — game uses additive formula, not pre-computed combos. */
  readonly combo: WeatherTimeCombination | null;
  readonly totalMultiplier: number;
}

export interface WeatherTimeCombination {
  readonly weather: MutationDefinition;
  readonly time: MutationDefinition;
  readonly multiplier: number;
}

// ---------------------------------------------------------------------------
// Mutation definitions — values from game's mutationsDex.ts
// ---------------------------------------------------------------------------

const COLOR_MUTATIONS: readonly MutationDefinition[] = [
  { name: 'Gold', category: 'color', multiplier: 25, aliases: ['Golden'] },
  { name: 'Rainbow', category: 'color', multiplier: 50 },
];

const WEATHER_MUTATIONS: readonly MutationDefinition[] = [
  { name: 'Wet', category: 'weather', multiplier: 2, aliases: ['Rainy'] },
  { name: 'Chilled', category: 'weather', multiplier: 2 },
  { name: 'Frozen', category: 'weather', multiplier: 6 },
  { name: 'Thunderstruck', category: 'weather', multiplier: 5 },
  { name: 'Thundercharged', category: 'weather', multiplier: 7, aliases: ['Thunder charged', 'Thunder-charged'] },
];

// Internal key → display name mapping:
//   Dawncharged → "Dawnbound"
//   Ambershine  → "Amberlit"
//   Ambercharged → "Amberbound"
const TIME_MUTATIONS: readonly MutationDefinition[] = [
  { name: 'Dawnlit', category: 'time', multiplier: 4, aliases: ['Dawn-lit'] },
  { name: 'Dawncharged', category: 'time', multiplier: 7, aliases: ['Dawnbound', 'Dawn bound', 'Dawn charged'] },
  { name: 'Ambershine', category: 'time', multiplier: 6, aliases: ['Amberlit', 'Amber lit', 'Amber shine'] },
  { name: 'Ambercharged', category: 'time', multiplier: 10, aliases: ['Amberbound', 'Amber Radiant', 'Amberradiant', 'Amber-radiant', 'Amber radiant', 'Amber charged'] },
];

const ALL_MUTATIONS: readonly MutationDefinition[] = [...COLOR_MUTATIONS, ...WEATHER_MUTATIONS, ...TIME_MUTATIONS];

const NORMALIZED_LOOKUP: ReadonlyMap<string, MutationDefinition> = buildLookupTable(ALL_MUTATIONS);

function buildLookupTable(definitions: readonly MutationDefinition[]): ReadonlyMap<string, MutationDefinition> {
  const table = new Map<string, MutationDefinition>();

  for (const definition of definitions) {
    table.set(normalizeKey(definition.name), definition);
    if (definition.aliases) {
      for (const alias of definition.aliases) {
        table.set(normalizeKey(alias), definition);
      }
    }
  }

  return table;
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeMutationName(input: string | null | undefined): string | null {
  const definition = resolveMutation(input);
  return definition ? definition.name : null;
}

export function resolveMutation(input: string | null | undefined): MutationDefinition | null {
  if (!input) {
    return null;
  }

  const normalized = normalizeKey(input);
  if (!normalized) {
    return null;
  }

  // Hardcoded lookup for identity (name, category, aliases)
  const known = NORMALIZED_LOOKUP.get(normalized);

  if (known) {
    // Use catalog's coinMultiplier as authoritative when available
    const catalogEntry = getCatalogMutation(known.name);
    if (catalogEntry && catalogEntry.coinMultiplier !== known.multiplier) {
      return { ...known, multiplier: catalogEntry.coinMultiplier };
    }
    return known;
  }

  // Fallback: check mutation catalog for mutations added by game updates
  return resolveMutationFromCatalog(input.trim());
}

/**
 * Attempts to resolve an unknown mutation from the runtime catalog.
 * Used for mutations added to the game after this mod was built.
 * Heuristic for category: coinMultiplier >= 25 → 'color' (growth), else 'weather' (environment).
 * This matches the game's GROWTH_MUTATIONS list (Gold=25, Rainbow=50) vs env mutations (max 10).
 */
function resolveMutationFromCatalog(mutationId: string): MutationDefinition | null {
  const catalog = getMutationCatalog();
  if (!catalog) return null;

  // Try exact key match (e.g., 'Frozen', 'Dawncharged')
  let entry = catalog[mutationId];

  // If not found, try matching by the entry's display name (e.g., 'Dawnbound' → key 'Dawncharged')
  if (!entry) {
    const inputLower = mutationId.toLowerCase();
    for (const candidateEntry of Object.values(catalog)) {
      if (typeof candidateEntry.name === 'string' && candidateEntry.name.toLowerCase() === inputLower) {
        entry = candidateEntry;
        break;
      }
    }
  }

  if (!entry) return null;

  const displayName = typeof entry.name === 'string' && entry.name ? entry.name : mutationId;
  const category: MutationCategory = entry.coinMultiplier >= 25 ? 'color' : 'weather';

  return {
    name: displayName,
    category,
    multiplier: entry.coinMultiplier,
  };
}

export function classifyMutations(inputs: readonly string[] | null | undefined): {
  colors: MutationEntry[];
  weathers: MutationEntry[];
  times: MutationEntry[];
  unknown: readonly string[];
} {
  const colors: MutationEntry[] = [];
  const weathers: MutationEntry[] = [];
  const times: MutationEntry[] = [];
  const unknown: string[] = [];

  if (!inputs || inputs.length === 0) {
    return { colors, weathers, times, unknown };
  }

  for (const raw of inputs) {
    const definition = resolveMutation(raw);
    if (!definition) {
      unknown.push(raw);
      continue;
    }

    const entry: MutationEntry = { definition, sourceName: raw };
    if (definition.category === 'color') {
      colors.push(entry);
    } else if (definition.category === 'weather') {
      weathers.push(entry);
    } else {
      times.push(entry);
    }
  }

  return { colors, weathers, times, unknown };
}

/**
 * Compute the mutation multiplier using the game's actual formula:
 *   growthMult × (1 + SUM(envCoinMultipliers) - count(envMutations))
 *
 * "Growth" = Gold or Rainbow (only one can exist; pick highest if multiple).
 * "Environment" = all other mutations (weather + time); they stack additively.
 */
export function computeMutationMultiplier(inputs: readonly string[] | null | undefined): MutationMultiplierBreakdown {
  if (!inputs || inputs.length === 0) {
    return {
      color: null,
      weather: null,
      time: null,
      combo: null,
      totalMultiplier: 1,
    };
  }

  const { colors, weathers, times } = classifyMutations(inputs);

  // Growth mutation: Gold or Rainbow (only one allowed; pick highest)
  const color = pickHighest(colors);

  // For breakdown display purposes, track the highest individual weather and time
  const weather = pickHighest(weathers);
  const time = pickHighest(times);

  // Game formula: growthMult × (1 + SUM(envCoinMultipliers) - count(envMutations))
  const growthMult = color?.definition.multiplier ?? 1;

  // All non-growth mutations are "environment" mutations — they stack additively
  const envEntries = [...weathers, ...times];
  const envSum = envEntries.reduce((acc, entry) => acc + entry.definition.multiplier, 0);
  const envCount = envEntries.length;

  const totalMultiplier = growthMult * (1 + envSum - envCount);

  return {
    color,
    weather,
    time,
    combo: null, // Game uses additive formula, not pre-computed combos
    totalMultiplier,
  };
}

function pickHighest(entries: readonly MutationEntry[]): MutationEntry | null {
  if (!entries.length) {
    return null;
  }
  return entries.reduce((best, current) => {
    if (!best) {
      return current;
    }
    return current.definition.multiplier > best.definition.multiplier ? current : best;
  }, null as MutationEntry | null);
}

export function getAllMutationDefinitions(): readonly MutationDefinition[] {
  const catalog = getMutationCatalog();
  if (!catalog) return ALL_MUTATIONS;

  const knownKeys = new Set(ALL_MUTATIONS.map(m => normalizeKey(m.name)));

  const merged: MutationDefinition[] = ALL_MUTATIONS.map(def => {
    const entry = catalog[def.name];
    if (entry && entry.coinMultiplier !== def.multiplier) {
      return { ...def, multiplier: entry.coinMultiplier };
    }
    return def;
  });

  for (const [id, entry] of Object.entries(catalog)) {
    if (knownKeys.has(normalizeKey(id))) continue;
    const category: MutationCategory = entry.coinMultiplier >= 25 ? 'color' : 'weather';
    merged.push({ name: id, category, multiplier: entry.coinMultiplier });
  }

  return merged;
}

/** @deprecated Combo table removed — game uses additive formula. Returns empty array. */
export function getWeatherTimeCombinations(): readonly WeatherTimeCombination[] {
  return [];
}
