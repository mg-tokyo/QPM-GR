import { getAnySpriteDataUrl, onSpritesReady } from '../../sprite-v2/compat';

export interface IconOptions {
  size?: number;
  fallback?: string;
  mutations?: string[];
}

export function renderIcon(spriteKey: string, options: IconOptions = {}): HTMLElement {
  const { size = 16, fallback, mutations: _mutations } = options;

  const url = getAnySpriteDataUrl(spriteKey);

  if (url) {
    return createSpriteImg(url, size);
  }

  const wrapper = document.createElement('span');
  wrapper.style.cssText =
    `display:inline-flex;align-items:center;justify-content:center;` +
    `width:${size}px;height:${size}px;flex-shrink:0;` +
    'vertical-align:middle;';

  if (fallback) {
    wrapper.textContent = fallback;
    wrapper.style.fontSize = `${Math.round(size * 0.85)}px`;
    wrapper.style.lineHeight = '1';
  }

  const unsub = onSpritesReady(() => {
    const readyUrl = getAnySpriteDataUrl(spriteKey);
    if (readyUrl) {
      const img = createSpriteImg(readyUrl, size);
      wrapper.textContent = '';
      wrapper.appendChild(img);
    }
  });

  // Store unsub so callers can clean up if needed
  (wrapper as HTMLElement & { __iconCleanup?: () => void }).__iconCleanup = unsub;

  return wrapper;
}

function createSpriteImg(url: string, size: number): HTMLImageElement {
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText =
    `width:${size}px;height:${size}px;` +
    'object-fit:contain;image-rendering:pixelated;' +
    'vertical-align:middle;flex-shrink:0;';
  img.draggable = false;
  return img;
}
