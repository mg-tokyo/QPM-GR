import { canonicalItemId, getItemIdVariants } from '../../../utils/restock/dataService';
import { getAnySpriteDataUrl, getCropSpriteCanvas, getPetSpriteCanvas } from '../../../sprite-v2/compat';
import { canvasToDataUrl } from '../../../utils/dom/canvasHelpers';
import { getItemCatalogRarity, getItemCatalogSpriteKey } from '../../../catalogs/shopEligibility';
import { rarityColorVar } from '../../components/rarityBadge';
import type { RestockShopType } from './types';
import { alertSpriteUrlCache } from './alertState';

function toCompactId(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

function toSingularToolId(value: string): string {
  if (value.endsWith('s') && value.length > 1) return value.slice(0, -1);
  return value;
}

function tryResolveSpriteFromCanvas(candidateId: string): string | null {
  try {
    const petUrl = canvasToDataUrl(getPetSpriteCanvas(candidateId));
    if (petUrl) return petUrl;
  } catch { /* continue */ }
  try {
    const cropUrl = canvasToDataUrl(getCropSpriteCanvas(candidateId));
    if (cropUrl) return cropUrl;
  } catch { /* continue */ }
  return null;
}

function getAlertSpriteCandidates(shopType: RestockShopType, itemId: string, label: string): string[] {
  const ordered = new Set<string>();
  const add = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    ordered.add(trimmed);
    const compact = toCompactId(trimmed);
    if (compact && compact !== trimmed) ordered.add(compact);
  };

  add(itemId);
  add(label);
  for (const variant of getItemIdVariants(shopType, itemId)) add(variant);

  if (shopType === 'tool') {
    const toolCandidates = Array.from(ordered.values());
    for (const candidate of toolCandidates) {
      const singular = toSingularToolId(candidate);
      add(singular);
      if (singular === candidate) add(`${singular}s`);
    }
  }
  return Array.from(ordered.values());
}

export function getAlertSpriteUrl(shopType: RestockShopType, itemId: string, label: string): string | null {
  const cacheKey = `${shopType}:${canonicalItemId(shopType, itemId).trim().toLowerCase()}`;
  if (alertSpriteUrlCache.has(cacheKey)) return alertSpriteUrlCache.get(cacheKey) ?? null;

  const candidates = getAlertSpriteCandidates(shopType, itemId, label);
  const SEED_PREFIXES  = ['sprite/seed/', 'seed/', 'sprite/crop/', 'crop/', 'sprite/plant/', 'plant/'];
  const EGG_PREFIXES   = ['sprite/egg/', 'egg/', 'sprite/pet/', 'pet/'];
  const DECOR_PREFIXES = ['sprite/decor/', 'decor/', 'sprite/item/', 'item/'];
  const TOOL_PREFIXES  = ['sprite/item/', 'item/', 'sprite/tool/', 'tool/'];
  // Weather shops mix item types — try every family.
  const keyPrefixes =
    shopType === 'seed'  ? SEED_PREFIXES :
    shopType === 'egg'   ? EGG_PREFIXES :
    shopType === 'decor' ? DECOR_PREFIXES :
    shopType === 'tool'  ? TOOL_PREFIXES :
                           [...SEED_PREFIXES, ...EGG_PREFIXES, ...DECOR_PREFIXES, ...TOOL_PREFIXES];

  for (const candidate of candidates) {
    const canvasUrl = tryResolveSpriteFromCanvas(candidate);
    if (canvasUrl) { alertSpriteUrlCache.set(cacheKey, canvasUrl); return canvasUrl; }

    // Blueprint atlas key beats prefix guessing (e.g. HungerShard → sprite/item/HungerCrystalShard).
    const catalogUrl = getAnySpriteDataUrl(getItemCatalogSpriteKey(candidate));
    if (catalogUrl) { alertSpriteUrlCache.set(cacheKey, catalogUrl); return catalogUrl; }

    for (const prefix of keyPrefixes) {
      const directUrl = getAnySpriteDataUrl(`${prefix}${candidate}`);
      if (directUrl) { alertSpriteUrlCache.set(cacheKey, directUrl); return directUrl; }
    }
  }

  alertSpriteUrlCache.set(cacheKey, null);
  return null;
}

export function getItemRarityLook(shopType: RestockShopType, itemId: string, label: string): { rarity: string; color: string } | null {
  for (const candidate of getAlertSpriteCandidates(shopType, itemId, label)) {
    const rarity = getItemCatalogRarity(candidate);
    const color = rarity ? rarityColorVar(rarity) : null;
    if (rarity && color) return { rarity, color };
  }
  return null;
}

export interface PinLook {
  iconUrl: string | null;
  accent: string | null;
}

/** Restock pins (`shop:itemId`): icon from the first pin with a sprite, accent from the first with a catalog rarity. */
export function getPinLook(pinKeys: Iterable<string>): PinLook {
  let iconUrl: string | null = null;
  let accent: string | null = null;
  for (const key of pinKeys) {
    const sep = key.indexOf(':');
    if (sep <= 0 || sep === key.length - 1) continue;
    const shopType = key.slice(0, sep);
    const itemId = key.slice(sep + 1);
    iconUrl ??= getAlertSpriteUrl(shopType, itemId, itemId);
    if (shopType !== 'weather') accent ??= getItemRarityLook(shopType, itemId, itemId)?.color ?? null;
    if (iconUrl && accent) break;
  }
  return { iconUrl, accent };
}
