const canvasCache = new Map<string, HTMLCanvasElement>();
const dataUrlCache = new Map<string, string>();

const MAX_MUTATED_CACHE = 200;
const mutatedCanvasCache = new Map<string, HTMLCanvasElement>();
const mutatedDataUrlCache = new Map<string, string>();

function mutatedKey(species: string, mutations: string[]): string {
  return `${species}:${mutations.join(',')}`;
}

export function cacheCanvas(species: string, canvas: HTMLCanvasElement): void {
  canvasCache.set(species, canvas);
  dataUrlCache.delete(species);
}

export function getCachedCanvas(species: string): HTMLCanvasElement | null {
  return canvasCache.get(species) ?? null;
}

export function getCachedDataUrl(species: string): string {
  const cached = dataUrlCache.get(species);
  if (cached !== undefined) return cached;
  const canvas = canvasCache.get(species);
  if (!canvas) return '';
  try {
    const url = canvas.toDataURL('image/png');
    dataUrlCache.set(species, url);
    return url;
  } catch {
    return '';
  }
}

export function getCachedMutatedCanvas(species: string, mutations: string[]): HTMLCanvasElement | null {
  if (mutations.length === 0) return null;
  return mutatedCanvasCache.get(mutatedKey(species, mutations)) ?? null;
}

export function cacheMutatedCanvas(species: string, mutations: string[], canvas: HTMLCanvasElement): void {
  if (mutations.length === 0) return;
  const key = mutatedKey(species, mutations);
  if (mutatedCanvasCache.size >= MAX_MUTATED_CACHE && !mutatedCanvasCache.has(key)) {
    const firstKey = mutatedCanvasCache.keys().next().value;
    if (firstKey !== undefined) {
      mutatedCanvasCache.delete(firstKey);
      mutatedDataUrlCache.delete(firstKey);
    }
  }
  mutatedCanvasCache.set(key, canvas);
  mutatedDataUrlCache.delete(key);
}

export function getCachedMutatedDataUrl(species: string, mutations: string[]): string {
  if (mutations.length === 0) return '';
  const key = mutatedKey(species, mutations);
  const cached = mutatedDataUrlCache.get(key);
  if (cached !== undefined) return cached;
  const canvas = mutatedCanvasCache.get(key);
  if (!canvas) return '';
  try {
    const url = canvas.toDataURL('image/png');
    mutatedDataUrlCache.set(key, url);
    return url;
  } catch {
    return '';
  }
}

export function clearPetRiveCache(): void {
  canvasCache.clear();
  dataUrlCache.clear();
  mutatedCanvasCache.clear();
  mutatedDataUrlCache.clear();
}

export function cachedSpeciesCount(): number {
  return canvasCache.size;
}
