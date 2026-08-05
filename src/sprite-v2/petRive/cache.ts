const canvasCache = new Map<string, HTMLCanvasElement>();
const dataUrlCache = new Map<string, string>();

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

export function clearPetRiveCache(): void {
  canvasCache.clear();
  dataUrlCache.clear();
}

export function cachedSpeciesCount(): number {
  return canvasCache.size;
}
