// src/ui/statsHubWindow/spriteHelpers.ts
// Sprite rendering and caching utilities for Stats Hub.

import {
  getProduceSpriteDataUrlWithMutations,
  getMultiHarvestSpriteDataUrlWithMutations,
  getPetSpriteDataUrl,
  getAnySpriteDataUrl,
  getCropSpriteDataUrl,
  getProduceSpriteDataUrl,
} from '../../../sprite-v2/compat';
import type { ValueCardType } from '../../economy/valueFloatingCard';

// ---------------------------------------------------------------------------
// Sprite URL caches — resolved lazily, kept for session lifetime
// ---------------------------------------------------------------------------

let coinSpriteUrlCache: string | null | undefined;
export function getCoinSpriteUrl(): string | null {
  if (coinSpriteUrlCache !== undefined) return coinSpriteUrlCache;
  coinSpriteUrlCache = getAnySpriteDataUrl('sprite/ui/Coin') || getAnySpriteDataUrl('ui/Coin') || null;
  return coinSpriteUrlCache;
}

let dustSpriteUrlCache: string | null | undefined;
function getDustSpriteUrl(): string | null {
  if (dustSpriteUrlCache !== undefined) return dustSpriteUrlCache;
  // Game uses SpriteFrame.Item.MagicDust → "sprite/item/MagicDust"
  dustSpriteUrlCache =
    getAnySpriteDataUrl('sprite/item/MagicDust') ||
    getAnySpriteDataUrl('item/MagicDust') ||
    null;
  return dustSpriteUrlCache;
}

let creditSpriteUrlCache: string | null | undefined;
function getCreditSpriteUrl(): string | null {
  if (creditSpriteUrlCache !== undefined) return creditSpriteUrlCache;
  // Game uses SpriteFrame.Ui.Donut for credits
  creditSpriteUrlCache =
    getAnySpriteDataUrl('sprite/ui/Donut') ||
    getAnySpriteDataUrl('ui/Donut') ||
    null;
  return creditSpriteUrlCache;
}

/** Create a currency icon element — game sprite if available, else emoji fallback */
export function currencyIcon(type: 'coins' | 'credits' | 'dust', size: number): HTMLElement {
  const urlFn = type === 'coins' ? getCoinSpriteUrl : type === 'dust' ? getDustSpriteUrl : getCreditSpriteUrl;
  const url = urlFn();
  if (url) return makeSprite(url, size);
  const fallbacks = { coins: '🪙', credits: '💎', dust: '✨' };
  const span = document.createElement('span');
  span.style.cssText = `font-size:${Math.round(size * 0.7)}px;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
  span.textContent = fallbacks[type];
  return span;
}

/** Resolve an egg sprite URL, trying multiple key patterns. */
export function resolveEggSpriteUrl(): string {
  const prefixes = ['sprite/egg/', 'egg/', 'sprite/pet/', 'pet/'];
  const ids = ['CommonEgg', 'UncommonEgg'];
  for (const id of ids) {
    for (const prefix of prefixes) {
      const url = getAnySpriteDataUrl(`${prefix}${id}`);
      if (url) return url;
    }
  }
  return '';
}

/**
 * Build overlapping circular sprite stack (like avatar groups).
 * Each sprite is rendered as a clipped circle, overlapping left-to-right.
 */
export function overlappingIcons(urls: string[], size: number): HTMLElement {
  const valid = urls.filter(Boolean);
  if (valid.length === 0) {
    const span = document.createElement('span');
    span.style.cssText = `font-size:${Math.round(size * 0.6)}px;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
    span.textContent = '📦';
    return span;
  }
  if (valid.length === 1) return makeSprite(valid[0]!, size);

  const count = valid.length;
  const itemSize = Math.round(size * 0.72);
  const overlap = Math.round(itemSize * 0.35);
  const totalWidth = itemSize + (count - 1) * (itemSize - overlap);

  const wrap = document.createElement('div');
  wrap.style.cssText = `position:relative;width:${totalWidth}px;height:${size}px;flex-shrink:0;`;

  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.src = valid[i]!;
    img.alt = '';
    const left = i * (itemSize - overlap);
    img.style.cssText = [
      `position:absolute`,
      `left:${left}px`,
      `top:${Math.round((size - itemSize) / 2)}px`,
      `width:${itemSize}px`,
      `height:${itemSize}px`,
      `object-fit:contain`,
      `image-rendering:pixelated`,
      `border-radius:50%`,
      `border:1.5px solid rgba(18,20,26,0.9)`,
      `z-index:${count - i}`,
    ].join(';');
    wrap.appendChild(img);
  }

  return wrap;
}

/** Pick the right icon element for a balance/value chip based on card type. */
export function chipIcon(cardType: ValueCardType, size: number): HTMLElement {
  if (cardType === 'garden') {
    const url = getCropSpriteDataUrl('Carrot') || getProduceSpriteDataUrl('Carrot');
    if (url) return makeSprite(url, size);
    return currencyIcon('coins', size);
  }
  if (cardType === 'inventory') {
    const coinUrl = getCoinSpriteUrl() || '';
    const cropUrl = getProduceSpriteDataUrl('Carrot') || getCropSpriteDataUrl('Carrot') || '';
    const eggUrl = resolveEggSpriteUrl();
    const urls = [coinUrl, cropUrl, eggUrl].filter(Boolean);
    if (urls.length > 1) return overlappingIcons(urls, size);
    if (urls.length === 1) return makeSprite(urls[0]!, size);
    return currencyIcon('coins', size);
  }
  // Currency types
  const typeMap: Record<string, 'coins' | 'credits' | 'dust'> = {
    coins: 'coins', credits: 'credits', dust: 'dust',
  };
  return currencyIcon(typeMap[cardType] ?? 'coins', size);
}

// ---------------------------------------------------------------------------
// Core sprite rendering
// ---------------------------------------------------------------------------

/** Render a data-URL sprite as an <img> with proper aspect ratio. */
export function makeSprite(dataUrl: string, size: number): HTMLImageElement {
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = '';
  img.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    'object-fit:contain',
    'image-rendering:pixelated',
    'display:block',
    'flex-shrink:0',
  ].join(';');
  return img;
}

/**
 * Render a plant sprite.
 * isMultiHarvest=false → plant-first lookup (shows bush/tree sprite).
 * isMultiHarvest=true  → crop-first lookup (shows fruit sprite; used in slot detail popover).
 */
export function plantSprite(species: string, mutations: string[], size: number, isMultiHarvest = false): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
  try {
    // Multi-harvest card tiles show the plant/bush (plant-first); individual slot popovers show the fruit (crop-first).
    const url = isMultiHarvest
      ? getMultiHarvestSpriteDataUrlWithMutations(species, mutations)
      : getProduceSpriteDataUrlWithMutations(species, mutations);
    if (url) {
      wrap.appendChild(makeSprite(url, size));
      return wrap;
    }
  } catch { /* fall through */ }
  wrap.textContent = '🌱';
  (wrap as HTMLElement).style.fontSize = `${Math.round(size * 0.55)}px`;
  return wrap;
}

export function petSprite(species: string, size: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
  try {
    const url = getPetSpriteDataUrl(species);
    if (url) {
      wrap.appendChild(makeSprite(url, size));
      return wrap;
    }
  } catch { /* fall through */ }
  wrap.textContent = '🥚';
  (wrap as HTMLElement).style.fontSize = `${Math.round(size * 0.55)}px`;
  return wrap;
}
