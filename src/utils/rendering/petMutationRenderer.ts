import { getPetSpriteWithMutations } from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../dom/canvasHelpers';

export type MutationSpriteType = 'rainbow' | 'gold';

const mutationSpriteCache = new Map<string, string>();
const MAX_MUTATION_CACHE_SIZE = 200;

function addToMutationCache(key: string, value: string): void {
  if (mutationSpriteCache.size >= MAX_MUTATION_CACHE_SIZE && !mutationSpriteCache.has(key)) {
    const firstKey = mutationSpriteCache.keys().next().value;
    if (firstKey !== undefined) {
      mutationSpriteCache.delete(firstKey);
    }
  }
  mutationSpriteCache.set(key, value);
}

function normalizeSpeciesKey(value: string): string {
  return (value ?? '').toLowerCase();
}

function normalizeMutationKey(value: string): MutationSpriteType | null {
  const lower = String(value ?? '').toLowerCase();
  if (lower === 'rainbow') return 'rainbow';
  if (lower === 'gold' || lower === 'golden') return 'gold';
  return null;
}

function mapMutationForService(mutation: MutationSpriteType): string {
  return mutation === 'rainbow' ? 'Rainbow' : 'Gold';
}

export function getMutationSpriteDataUrl(species: string, mutation: MutationSpriteType): string | null {
  const normalizedSpecies = normalizeSpeciesKey(species);
  const normalizedMutation = normalizeMutationKey(mutation);

  if (!normalizedSpecies || !normalizedMutation) {
    return null;
  }

  const cacheKey = `${normalizedSpecies}:${normalizedMutation}`;
  const cached = mutationSpriteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = getPetSpriteWithMutations(normalizedSpecies, [mapMutationForService(normalizedMutation)]);
  if (!canvas) {
    return null;
  }

  const dataUrl = canvasToDataUrl(canvas);
  if (!dataUrl) {
    return null;
  }

  addToMutationCache(cacheKey, dataUrl);
  return dataUrl;
}

export function clearMutationSpriteCache(): void {
  mutationSpriteCache.clear();
}
