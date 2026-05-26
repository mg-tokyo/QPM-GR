import type { SpriteCategory } from '../../sprite-v2/types';
import {
  getCropSpriteCanvas,
  getCropSpriteWithMutations,
  getPetSpriteCanvas,
  getPetSpriteWithMutations,
  spriteExtractor,
} from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/canvasHelpers';
import { getAbilityColor, mutationFilters, itemTileMap, ITEM_SHEET } from './constants';
import type { SpriteFilterConfig } from './constants';
import { spriteService, spriteNameLookup, spriteUrlCache, normalizeSpriteLookupKey } from './state';

export function canvasToDataUrlSafe(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function renderSpriteByName(name: string, preferred: SpriteCategory[] = ['item', 'decor', 'seed', 'crop', 'plant', 'tallplant', 'pet']): string | null {
  if (!name || !spriteService) return null;
  const norm = normalizeSpriteLookupKey(name);
  const cached = spriteUrlCache.get(`${preferred.join(',')}:${norm}`);
  if (cached) return cached;
  const matches = spriteNameLookup.get(norm);
  if (!matches || !matches.length) return null;

  const pick = preferred
    .map((cat) => matches.find((m) => m.category === cat))
    .find((m) => !!m) || matches[0];

  if (!pick) return null;
  try {
    const canvas = spriteService.renderToCanvas({ category: pick.category as SpriteCategory, id: pick.id, mutations: [] });
    const url = canvasToDataUrlSafe(canvas);
    if (url) spriteUrlCache.set(`${preferred.join(',')}:${norm}`, url);
    return url;
  } catch {
    return null;
  }
}

export function normalizeSpeciesName(species: string): string {
  const lower = String(species).toLowerCase();
  if (lower === 'mooncelestial') return 'mooncelestialcrop';
  if (lower === 'dawncelestial') return 'dawncelestialcrop';
  if (lower.includes('tulip')) return 'tulip';
  return lower;
}

export function normalizePetSpecies(species: string): string {
  const lower = String(species).trim().toLowerCase();
  const withoutEgg = lower.replace(/egg$/i, '').trim();
  return withoutEgg || lower;
}

export function getItemSpriteUrl(name: string): string | null {
  const key = name.toLowerCase();
  const tileIndex = itemTileMap[key] ?? itemTileMap[key.replace(/\s+/g, '')];
  if (typeof tileIndex === 'number') {
    const tile = spriteExtractor.getTile(ITEM_SHEET, tileIndex);
    const url = canvasToDataUrlSafe(tile);
    if (url) return url;
  }
  const cached = spriteUrlCache.get(`item:${normalizeSpriteLookupKey(name)}`);
  if (cached) return cached;
  const url = renderSpriteByName(name, ['item', 'decor']);
  if (url) spriteUrlCache.set(`item:${normalizeSpriteLookupKey(name)}`, url);
  return url;
}

export function getEggSpriteUrl(eggId: string): string | null {
  const variants = [
    eggId,
    eggId.toLowerCase(),
    eggId.charAt(0).toUpperCase() + eggId.slice(1).toLowerCase(),
    eggId.replace(/egg$/i, '') + 'Egg',
  ];

  for (const variant of variants) {
    const canvas = getPetSpriteCanvas(variant);
    if (canvas) return canvasToDataUrlSafe(canvas);
  }
  return renderSpriteByName(eggId, ['pet', 'item']);
}

export function getMutatedCropSpriteUrl(species: string | null | undefined, mutations: unknown[], tileId?: string | number | null): string | null {
  if (!species) return null;
  const normalized = normalizeSpeciesName(species);
  const ordered = mutations.map((m) => String(m || '').toLowerCase()).filter(Boolean).slice(0, 4);
  const rendered = ordered.length ? getCropSpriteWithMutations(normalized, ordered) : getCropSpriteCanvas(normalized);
  const cacheKey = `crop:${normalized}:${ordered.join(',')}`;
  if (rendered) {
    const url = canvasToDataUrlSafe(rendered);
    if (url) {
      spriteUrlCache.set(cacheKey, url);
      return url;
    }
  }
  const cached = spriteUrlCache.get(cacheKey);
  if (cached) return cached;
  const url = renderSpriteByName(normalized, ['crop', 'plant', 'tallplant', 'seed']) || (tileId ? renderSpriteByName(String(tileId)) : null);
  if (url) spriteUrlCache.set(cacheKey, url);
  return url;
}

export function getSeedSpriteUrl(seedName: string): string | null {
  let normalized = String(seedName).toLowerCase();
  if (normalized.includes('tulip')) normalized = 'tulip';
  const cacheKey = `seed:${normalized}`;
  const cached = spriteUrlCache.get(cacheKey);
  if (cached) return cached;
  const canvas = getCropSpriteCanvas(normalized);
  if (canvas) {
    const url = canvasToDataUrlSafe(canvas);
    if (url) {
      spriteUrlCache.set(cacheKey, url);
      return url;
    }
  }
  const url = renderSpriteByName(normalized, ['seed', 'crop', 'plant', 'tallplant']);
  if (url) spriteUrlCache.set(cacheKey, url);
  return url;
}

export function drawGradient(ctx: CanvasRenderingContext2D, w: number, h: number, cfg: SpriteFilterConfig): void {
  const angle = (cfg.gradientAngle ?? 90) * Math.PI / 180;
  const half = Math.sqrt(w * w + h * h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const x0 = cx - Math.cos(angle) * half;
  const y0 = cy - Math.sin(angle) * half;
  const x1 = cx + Math.cos(angle) * half;
  const y1 = cy + Math.sin(angle) * half;
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  const colors = cfg.colors && cfg.colors.length > 0 ? cfg.colors : ['rgba(255,255,255,0.7)'];
  colors.forEach((c, idx) => grad.addColorStop(colors.length === 1 ? 0 : idx / (colors.length - 1), c));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

export function applyCanvasFilter(base: HTMLCanvasElement, filterName: string): HTMLCanvasElement | null {
  const cfg = mutationFilters[filterName.toLowerCase()];
  if (!cfg) return null;
  const w = base.width;
  const h = base.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = cfg.blendMode;
  if (cfg.alpha != null) ctx.globalAlpha = cfg.alpha;
  if (cfg.masked) {
    const mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    if (mctx) {
      drawGradient(mctx, w, h, cfg);
      mctx.globalCompositeOperation = 'destination-in';
      mctx.drawImage(base, 0, 0);
      mctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(mask, 0, 0);
    }
  } else {
    drawGradient(ctx, w, h, cfg);
  }
  ctx.restore();
  return out;
}

export function renderAbilitySquares(abilities: string[]): string {
  if (!abilities || abilities.length === 0) return '';
  const displayed = abilities.slice(0, 4);
  return displayed.map(ability => {
    const colors = getAbilityColor(ability);
    return `<div class="pr-ability-square" title="${ability}" style="background:${colors.base};border:1px solid rgba(255,255,255,0.3);box-shadow:0 0 6px ${colors.glow};"></div>`;
  }).join('');
}

