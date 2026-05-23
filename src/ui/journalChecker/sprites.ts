import {
  getPetSpriteDataUrl as compatGetPetSpriteDataUrl,
  getPetSpriteDataUrlWithMutations as compatGetPetSpriteDataUrlWithMutations,
  getProduceSpriteDataUrl as compatGetProduceSpriteDataUrl,
  getProduceSpriteDataUrlWithMutations as compatGetProduceSpriteDataUrlWithMutations,
} from '../../sprite-v2/compat';
import { CROP_MUTATION_PREFIXES, normalizeSpeciesName } from './constants';

export function getCropSpriteUrl(species: string): string | null {
  for (const prefix of CROP_MUTATION_PREFIXES) {
    if (species.startsWith(prefix + ' ')) {
      const base = species.slice(prefix.length + 1);
      const url = compatGetProduceSpriteDataUrlWithMutations(base, [prefix]) || null;
      if (url) return url;
    }
  }
  return compatGetProduceSpriteDataUrl(species) || null;
}

export function getPetSpriteUrl(species: string): string | null {
  return compatGetPetSpriteDataUrl(species);
}

export function pickPetRecommendationMutation(
  missingVariants: string[] | undefined,
): 'Rainbow' | 'Gold' | null {
  if (!Array.isArray(missingVariants)) return null;
  const normalized = missingVariants.map((v) => String(v).toLowerCase());
  if (normalized.includes('rainbow')) return 'Rainbow';
  if (normalized.includes('gold')) return 'Gold';
  return null;
}

export function getRecommendationSpriteUrl(rec: {
  type: 'produce' | 'pet';
  species: string;
  missingVariants?: string[];
}): string | null {
  const normalizedSpecies = normalizeSpeciesName(rec.species);

  if (rec.type === 'produce') {
    return getCropSpriteUrl(normalizedSpecies) || getCropSpriteUrl(rec.species.toLowerCase());
  }

  const mutation = pickPetRecommendationMutation(rec.missingVariants);
  if (mutation) {
    const mutated =
      compatGetPetSpriteDataUrlWithMutations(normalizedSpecies, [mutation]) ||
      compatGetPetSpriteDataUrlWithMutations(rec.species, [mutation]) ||
      compatGetPetSpriteDataUrlWithMutations(rec.species.toLowerCase(), [mutation]);
    if (mutated) return mutated;
  }

  return (
    getPetSpriteUrl(normalizedSpecies) ||
    getPetSpriteUrl(rec.species.toLowerCase()) ||
    getPetSpriteUrl(rec.species)
  );
}
