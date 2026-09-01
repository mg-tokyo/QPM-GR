import { getPetSpecies } from '../../../catalogs/gameCatalogs';
import {
  COMMON_SPECIES, UNCOMMON_SPECIES, RARE_SPECIES, LEGENDARY_SPECIES, MYTHICAL_SPECIES,
} from '../optimizer/constants';

export type PetRarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythical' | 'divine';
const RARITY_ORDER: PetRarity[] = ['common', 'uncommon', 'rare', 'legendary', 'mythical', 'divine'];

function fromCatalog(species: string): PetRarity | null {
  const raw = getPetSpecies(species)?.rarity;
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return (RARITY_ORDER as string[]).includes(key) ? (key as PetRarity) : null;
}

// Legacy sets remain only as a pre-catalog fallback; the catalog is authoritative.
function fromLegacySets(species: string): PetRarity | null {
  if (MYTHICAL_SPECIES.has(species)) return 'mythical';
  if (LEGENDARY_SPECIES.has(species)) return 'legendary';
  if (RARE_SPECIES.has(species)) return 'rare';
  if (UNCOMMON_SPECIES.has(species)) return 'uncommon';
  if (COMMON_SPECIES.has(species)) return 'common';
  return null;
}

export function getPetRarity(species: string | null | undefined): PetRarity | null {
  if (!species) return null;
  return fromCatalog(species) ?? fromLegacySets(species);
}

export function getPetRarityRank(species: string | null | undefined): number {
  const rarity = getPetRarity(species);
  return rarity ? RARITY_ORDER.indexOf(rarity) + 1 : 0;
}

export function isRarePlusSpecies(species: string | null | undefined): boolean {
  return getPetRarityRank(species) >= 3;
}
