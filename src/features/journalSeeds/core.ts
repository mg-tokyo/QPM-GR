import type { RarePatchPair } from '../../catalogs/logic/rarePatchPairsCatalog';
import type { Journal } from '../journal/checker';
import { getUnloggedProduceVariants, resolveVariantKey } from '../journal/unlogged';

export interface WatchedSeed {
  /** The seed to buy. */
  seedSpecies: string;
  /** The journal species it is needed for: itself, or the rare crop it can grow into (D3). */
  forSpecies: string;
  /** Unlogged variant ids for `forSpecies`, journal order. */
  missing: string[];
  /** The current weather's mutation when `forSpecies` still needs it (D5). */
  weatherMatch: string | null;
}

export interface WatchedSeedsInput {
  journal: Journal;
  /** Plant catalog species ids, catalog order. */
  species: readonly string[];
  owned: ReadonlyMap<string, number>;
  /** Null until the bundle table is parsed: then rare crops get no base-seed entry. */
  pairs: readonly RarePatchPair[] | null;
  weatherMutation: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function addSeeds(out: Map<string, number>, items: unknown): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isRecord(item) || item.itemType !== 'Seed' || typeof item.species !== 'string') continue;
    const qty = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
    out.set(item.species, (out.get(item.species) ?? 0) + qty);
  }
}

function addPlants(out: Map<string, number>, tiles: unknown): void {
  if (!isRecord(tiles)) return;
  for (const tile of Object.values(tiles)) {
    if (!isRecord(tile) || tile.objectType !== 'plant' || typeof tile.species !== 'string') continue;
    out.set(tile.species, (out.get(tile.species) ?? 0) + 1);
  }
}

/** Seeds owned per species: bag + Seed Silo + planted plants (D1; beta utils/getNumItemOwned.ts:66-90). */
export function countOwnedSeeds(myData: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!isRecord(myData)) return out;
  const inventory = isRecord(myData.inventory) ? myData.inventory : null;
  addSeeds(out, inventory?.items);
  if (Array.isArray(inventory?.storages)) {
    const silo = inventory.storages.find((s) => isRecord(s) && s.decorId === 'SeedSilo');
    if (isRecord(silo)) addSeeds(out, silo.items);
  }
  const garden = isRecord(myData.garden) ? myData.garden : null;
  addPlants(out, garden?.tileObjects);
  addPlants(out, garden?.boardwalkTileObjects);
  return out;
}

/** Journal species still missing a variant whose seed the player owns none of; weather matches first. */
export function computeWatchedSeeds(input: WatchedSeedsInput): WatchedSeed[] {
  const baseOf = new Map((input.pairs ?? []).map((p) => [p.rare, p.patch]));
  const weatherKey = input.weatherMutation ? resolveVariantKey(input.weatherMutation) : null;
  const out: WatchedSeed[] = [];
  for (const species of input.species) {
    const unlogged = getUnloggedProduceVariants(input.journal, species);
    if (!unlogged || unlogged.length === 0) continue;
    const seedSpecies = baseOf.get(species) ?? species;
    if ((input.owned.get(seedSpecies) ?? 0) > 0) continue;
    const match = weatherKey ? unlogged.find((v) => resolveVariantKey(v.displayName) === weatherKey) : undefined;
    out.push({ seedSpecies, forSpecies: species, missing: unlogged.map((v) => v.id), weatherMatch: match ? match.id : null });
  }
  return out.sort((a, b) => Number(b.weatherMatch !== null) - Number(a.weatherMatch !== null));
}
