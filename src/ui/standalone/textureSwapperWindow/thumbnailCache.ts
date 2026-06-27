import { renderSpriteToCanvas, parseAtlasKey } from '../../../features/standalone/textureSwapper';
import { stripRenderState } from '../../../features/standalone/textureSwapper/matcher/state';
import { getCosmeticCdnUrl } from '../../../features/bloblingCustomiser/cosmeticApi';
import type { SpriteService } from '../../../sprite-v2/types';

const cache = new Map<string, HTMLCanvasElement>();
const imgCache = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<HTMLImageElement | null>>();

export function getCachedThumbnail(spriteKey: string, svc: SpriteService, size: number): HTMLCanvasElement | null {
  const cacheKey = `${spriteKey}@${size}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const { category, id } = parseAtlasKey(spriteKey);
  const raw = renderSpriteToCanvas(svc, category, id);
  if (!raw) return null;
  const thumb = scaleCanvas(raw, size);
  cache.set(cacheKey, thumb);
  return thumb;
}

export function getCachedThumbnailWithMutations(
  spriteKey: string,
  mutations: string[],
  svc: SpriteService,
  size: number,
): HTMLCanvasElement | null {
  const cacheKey = `${spriteKey}+${mutations.slice().sort().join(',')}@${size}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const { category, id } = parseAtlasKey(spriteKey);
  const raw = renderSpriteToCanvas(svc, category, id, mutations);
  if (!raw) return null;
  const thumb = scaleCanvas(raw, size);
  cache.set(cacheKey, thumb);
  return thumb;
}

export function clearThumbnailCache(): void {
  cache.clear();
  imgCache.clear();
  loadingPromises.clear();
}

export function invalidateByFamilyRoot(familyRoot: string): void {
  for (const k of [...cache.keys()]) {
    const at = k.lastIndexOf('@');
    const plus = k.indexOf('+');
    const spriteKey = plus >= 0 ? k.slice(0, plus) : (at >= 0 ? k.slice(0, at) : k);
    if (stripRenderState(spriteKey) === familyRoot) cache.delete(k);
  }
}

export function loadCosmeticImage(filename: string): Promise<HTMLImageElement | null> {
  if (imgCache.has(filename)) return Promise.resolve(imgCache.get(filename)!);
  if (loadingPromises.has(filename)) return loadingPromises.get(filename)!;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgCache.set(filename, img);
      loadingPromises.delete(filename);
      resolve(img);
    };
    img.onerror = () => {
      loadingPromises.delete(filename);
      resolve(null);
    };
    img.src = getCosmeticCdnUrl(filename);
  });
  loadingPromises.set(filename, promise);
  return promise;
}

export function getCachedCosmeticThumbnail(filename: string, size: number): HTMLCanvasElement | null {
  const cacheKey = `cosmetic:${filename}@${size}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const img = imgCache.get(filename);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx2d = c.getContext('2d')!;
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.imageSmoothingQuality = 'high';
  const scale = Math.min(size / Math.max(1, img.naturalWidth), size / Math.max(1, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  ctx2d.drawImage(img, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  cache.set(cacheKey, c);
  return c;
}

function scaleCanvas(source: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const scale = Math.min(size / Math.max(1, source.width), size / Math.max(1, source.height));
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  ctx.drawImage(source, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  return c;
}

export function buildShimmerPlaceholder(size: number): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:8px;background:linear-gradient(110deg,var(--qpm-accent-tint) 30%,var(--qpm-accent-subtle) 50%,var(--qpm-accent-tint) 70%);background-size:200% 100%;animation:qpm-shimmer 1.5s ease-in-out infinite;`;
  return el;
}
