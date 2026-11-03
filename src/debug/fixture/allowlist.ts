import { getEggCatalog, getPlantCatalog } from '../../catalogs/gameCatalogs';
import type { FixtureAllowlist, FixtureSnapshot } from './types';

export type AllowedKind = 'seed' | 'egg' | 'crop';
export type Allowed = { kind: AllowedKind; id: string; coinPrice: number | null };

function shopFacingEntry(kind: AllowedKind, id: string): Record<string, unknown> | null {
  if (kind === 'egg') {
    const egg = getEggCatalog()?.[id];
    return egg ? (egg as Record<string, unknown>) : null;
  }
  // Crops are allowlisted by their species' rarity, which flora blueprints keep on `.seed`.
  const seed = getPlantCatalog()?.[id]?.seed;
  return seed ? (seed as Record<string, unknown>) : null;
}

/** Exact-id, kind-specific lookup: a loose or cross-catalog match must never widen the allowlist. */
export function resolveAllowed(kind: AllowedKind, id: string, rarity: string): Allowed | null {
  if (!id) return null;
  const entry = shopFacingEntry(kind, id);
  if (!entry || entry.rarity !== rarity) return null;
  const price = entry.coinPrice;
  const coinPrice = kind !== 'crop' && typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null;
  return { kind, id, coinPrice };
}

export function allowlistFor(snap: FixtureSnapshot, rarity: string): FixtureAllowlist {
  const pick = (kind: AllowedKind, ids: string[]): string[] =>
    [...new Set(ids)].filter((id) => resolveAllowed(kind, id, rarity)).sort();
  return {
    seed: pick('seed', snap.stacks.filter((s) => s.kind === 'seed').map((s) => s.id)),
    egg: pick('egg', snap.stacks.filter((s) => s.kind === 'egg').map((s) => s.id)),
    crop: pick('crop', snap.crops.map((c) => c.species)),
  };
}
