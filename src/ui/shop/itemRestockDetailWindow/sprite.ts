import { getPetSpriteCanvas, getCropSpriteCanvas, getAnySpriteDataUrl } from '../../../sprite-v2/compat';
import { canvasToDataUrl } from '../../../utils/dom/canvasHelpers';
import { getItemIdVariants } from '../../../utils/restock/dataService';
import { storage } from '../../../utils/storage';
import { getWeatherDef } from '../../../catalogs/gameCatalogs';
import { ARIEDAM_KEY } from './constants';

export function getItemSpriteUrl(shopType: string, itemId: string): string | null {
  // Weather events use the weather catalog spriteId
  if (shopType === 'weather') {
    const def = getWeatherDef(itemId);
    const spriteId = def && typeof def.spriteId === 'string' ? def.spriteId : null;
    if (spriteId) return getAnySpriteDataUrl(spriteId) || null;
    return null;
  }

  const tryResolve = (candidateId: string): string | null => {
    let url: string | null = null;
    try { url = canvasToDataUrl(getPetSpriteCanvas(candidateId)) || null; } catch { /* try crop sprite next */ }
    if (!url) {
      try { url = canvasToDataUrl(getCropSpriteCanvas(candidateId)) || null; } catch { /* falls through to variant iteration */ }
    }
    return url;
  };

  // Dawn shop items are seeds/eggs — resolve using seed/egg sprite lookups
  const resolveShopType = shopType === 'dawn' ? 'seed' : shopType;

  const directUrl = tryResolve(itemId);
  if (directUrl) return directUrl;

  for (const variantId of getItemIdVariants(resolveShopType, itemId)) {
    if (!variantId || variantId === itemId) continue;
    const variantUrl = tryResolve(variantId);
    if (variantUrl) return variantUrl;
  }

  if (shopType === 'tool') {
    const candidates = new Set<string>([itemId, ...getItemIdVariants(shopType, itemId)]);
    if (itemId.endsWith('s') && itemId.length > 1) candidates.add(itemId.slice(0, -1));
    if (!itemId.endsWith('s')) candidates.add(`${itemId}s`);

    const cached = storage.get<{ data?: unknown } | null>(ARIEDAM_KEY, null);
    const data = cached?.data;
    const items = data && typeof data === 'object'
      ? ((data as Record<string, unknown>).items as Record<string, unknown> | undefined)
      : undefined;
    if (items && typeof items === 'object') {
      for (const candidateId of candidates) {
        const row = items[candidateId];
        if (!row || typeof row !== 'object') continue;
        const sprite = (row as Record<string, unknown>).sprite;
        if (typeof sprite === 'string' && sprite.trim()) return sprite;
      }
    }

    const normalizedId = itemId.endsWith('s') && itemId.length > 1 ? itemId.slice(0, -1) : itemId;
    return `https://mg-api.ariedam.fr/assets/sprites/items/${encodeURIComponent(normalizedId)}.png`;
  }

  return null;
}
