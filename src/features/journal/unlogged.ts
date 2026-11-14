import { getMutationCatalog } from '../../catalogs/gameCatalogs';
import { getVariantBadges, type VariantBadge } from '../mutations/data/variantBadges';
import type { Journal, SpeciesProduceLog } from './checker';

export const NORMAL_VARIANT = 'Normal';
export const MAX_WEIGHT_VARIANT = 'Max Weight';

export interface ProduceVariant {
  /** What the journal logs: `Normal`, a mutation id (e.g. `Ambershine`), or `Max Weight`. */
  id: string;
  /** The game's display name (e.g. "Amberlit"). */
  displayName: string;
}

export const normalizeJournalKey = (value: string): string => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

let cachedAliases: Record<string, string> | null = null;
// Keyed on catalog identity: a completeness merge replaces the catalog object.
let aliasCatalogRef: unknown = null;

function variantAliases(): Record<string, string> {
  const catalog = getMutationCatalog();
  if (cachedAliases && catalog === aliasCatalogRef) return cachedAliases;
  const aliases: Record<string, string> = {};
  if (!catalog) return aliases;
  for (const [key, entry] of Object.entries(catalog)) {
    const name = normalizeJournalKey(entry.name || key);
    aliases[normalizeJournalKey(key)] = name;
    aliases[name] = name;
  }
  aliasCatalogRef = catalog;
  cachedAliases = aliases;
  return aliases;
}

/** One key for a mutation's id and its display name, so `Ambershine` and `Amberlit` compare equal. */
export function resolveVariantKey(raw: string): string {
  const key = normalizeJournalKey(raw);
  return variantAliases()[key] ?? key;
}

/** Journal display order (Normal, catalog order, Max Weight); null until the mutation catalog is captured. */
export function getProduceVariants(): ProduceVariant[] | null {
  const catalog = getMutationCatalog();
  if (!catalog) return null;
  const out: ProduceVariant[] = [{ id: NORMAL_VARIANT, displayName: NORMAL_VARIANT }];
  for (const [key, entry] of Object.entries(catalog)) {
    if (key.toLowerCase().includes('maxweight')) continue;
    out.push({ id: key, displayName: entry.name || key });
  }
  out.push({ id: MAX_WEIGHT_VARIANT, displayName: MAX_WEIGHT_VARIANT });
  return out;
}

/** Journal keys are the catalog species ids (live 2026-11-14: 60/60 produce, 29/29 pets); the loose match is a guard only. */
export function findProduceLog(journal: Journal, species: string): SpeciesProduceLog | undefined {
  const produce = journal.produce;
  if (!produce) return undefined;
  if (produce[species]) return produce[species];
  const want = normalizeJournalKey(species);
  for (const [key, entry] of Object.entries(produce)) {
    if (normalizeJournalKey(key) === want) return entry;
  }
  return undefined;
}

export function loggedVariantKeys(log: SpeciesProduceLog | undefined): Map<string, number> {
  const keys = new Map<string, number>();
  for (const entry of log?.variantsLogged ?? []) {
    keys.set(resolveVariantKey(entry.variant), entry.createdAt || 0);
  }
  return keys;
}

/** Variants of `species` the journal has not logged; null until the mutation catalog is captured. */
export function getUnloggedProduceVariants(journal: Journal, species: string): ProduceVariant[] | null {
  const variants = getProduceVariants();
  if (!variants) return null;
  const logged = loggedVariantKeys(findProduceLog(journal, species));
  return variants.filter((v) => !logged.has(resolveVariantKey(v.displayName)));
}

/** Tooltip badges for the unlogged variants, in journal order; [] until the mutation catalog is captured. */
export function unloggedBadges(journal: Journal, species: string): VariantBadge[] {
  const unlogged = getUnloggedProduceVariants(journal, species);
  if (!unlogged) return [];
  const keys = new Set(unlogged.map((v) => resolveVariantKey(v.displayName)));
  return getVariantBadges()
    .filter((badge) => badge.matches.some((name) => keys.has(resolveVariantKey(name))))
    .map((badge) => ({ ...badge }));
}
