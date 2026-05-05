// src/ui/hubWindow/cards/iconRenderer.ts — Renders CardIcon with sprite + mutation support

import type { CardIcon } from './types';
import {
  getAnySpriteDataUrl,
  getPetSpriteDataUrlWithMutations,
  getCropSpriteDataUrlWithMutations,
  onSpritesReady,
} from '../../../sprite-v2/compat';

/**
 * Resolves a CardIcon to a data URL, handling mutations if specified.
 * spriteKey format: 'sprite/pet/Turtle', 'sprite/plant/Sunflower', 'sprite/ui/Coin', etc.
 * Returns empty string if sprites aren't loaded yet.
 */
function resolveIconUrl(icon: CardIcon): string {
  if (!icon.spriteKey) return '';

  const key = icon.spriteKey;

  // If mutations specified, use mutation-aware renderers (need species name only)
  if (icon.spriteMutations?.length) {
    const mutations = icon.spriteMutations as string[];
    // sprite/pet/Turtle → species 'Turtle'
    const petMatch = key.match(/^(?:sprite\/)?pet\/(.+)$/);
    if (petMatch) {
      return getPetSpriteDataUrlWithMutations(petMatch[1], mutations);
    }
    // sprite/plant/Sunflower → species 'Sunflower'
    const plantMatch = key.match(/^(?:sprite\/)?plant\/(.+)$/);
    if (plantMatch) {
      return getCropSpriteDataUrlWithMutations(plantMatch[1], mutations);
    }
  }

  // Standard sprite lookup (full key with sprite/ prefix)
  return getAnySpriteDataUrl(key);
}

/**
 * Builds a 28×28 icon box with gradient background.
 * Loads sprites with optional mutations; falls back to emoji.
 */
export function buildIconBox(icon: CardIcon): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText = [
    'width:28px',
    'height:28px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'border-radius:6px',
    'background:linear-gradient(135deg, rgba(143,130,255,0.2), rgba(143,130,255,0.1))',
    'flex-shrink:0',
    'overflow:hidden',
  ].join(';');

  if (icon.kind === 'sprite' && icon.spriteKey) {
    const fallback = icon.fallback ?? icon.value;

    const trySetSprite = (): boolean => {
      const url = resolveIconUrl(icon);
      if (url) {
        box.innerHTML = '';
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'width:22px;height:22px;image-rendering:pixelated;object-fit:contain;';
        box.appendChild(img);
        return true;
      }
      return false;
    };

    if (!trySetSprite()) {
      box.style.fontSize = '14px';
      box.textContent = fallback;
      onSpritesReady(() => { trySetSprite(); });
    }
  } else {
    box.style.fontSize = '14px';
    box.textContent = icon.value;
  }

  return box;
}

/**
 * Builds a sidebar icon (fills parent 36×36 button).
 */
export function buildSidebarIcon(icon: CardIcon): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;';

  if (icon.kind === 'sprite' && icon.spriteKey) {
    const fallback = icon.fallback ?? icon.value;

    const trySet = (): boolean => {
      const url = resolveIconUrl(icon);
      if (url) {
        el.innerHTML = '';
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'width:22px;height:22px;image-rendering:pixelated;object-fit:contain;';
        el.appendChild(img);
        return true;
      }
      return false;
    };

    if (!trySet()) {
      el.style.fontSize = '16px';
      el.textContent = fallback;
      onSpritesReady(() => { trySet(); });
    }
  } else {
    el.style.fontSize = '16px';
    el.textContent = icon.value;
  }

  return el;
}
