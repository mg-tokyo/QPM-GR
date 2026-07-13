import { getAnySpriteDataUrl } from '../../../sprite-v2/compat';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const fullFmt = new Intl.NumberFormat('en-US');

let dustUrlCache: string | null | undefined;
function getDustSpriteUrl(): string | null {
  if (dustUrlCache !== undefined) return dustUrlCache;
  dustUrlCache =
    getAnySpriteDataUrl('sprite/item/MagicDust') ||
    getAnySpriteDataUrl('item/MagicDust') ||
    null;
  return dustUrlCache;
}

export function makeDustIcon(size: number): HTMLElement {
  const url = getDustSpriteUrl();
  if (url) {
    const img = el('img', `width:${size}px;height:${size}px;image-rendering:pixelated;flex-shrink:0;vertical-align:middle;`) as HTMLImageElement;
    img.src = url;
    img.alt = 'magic dust';
    return img;
  }
  return el('span', `font-size:${size}px;`, '✨');
}

let coinUrlCache: string | null = null;
function getCoinSpriteUrl(): string {
  if (coinUrlCache) return coinUrlCache;
  const url = getAnySpriteDataUrl('sprite/ui/Coin');
  if (url) coinUrlCache = url;
  return coinUrlCache ?? '';
}

export function makeCoinIcon(size: number): HTMLElement {
  const url = getCoinSpriteUrl();
  if (url) {
    const img = el('img', `width:${size}px;height:${size}px;image-rendering:pixelated;flex-shrink:0;vertical-align:middle;`) as HTMLImageElement;
    img.src = url;
    img.alt = 'coins';
    return img;
  }
  return el('span', `font-size:${size}px;`, '🪙');
}
