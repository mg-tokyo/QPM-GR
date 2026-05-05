// src/ui/hubWindow/cards/iconRenderer.ts — Renders CardIcon with sprite support

import type { CardIcon } from './types';
import { getAnySpriteDataUrl, onSpritesReady } from '../../../sprite-v2/compat';

/**
 * Builds a 28×28 icon box. If the icon is a sprite, it attempts to load the
 * sprite data URL immediately and falls back to the emoji. When sprites become
 * ready later, it upgrades the icon automatically.
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
    const spriteKey = icon.spriteKey;
    const fallback = icon.fallback ?? icon.value;

    const trySetSprite = (): boolean => {
      const url = getAnySpriteDataUrl(spriteKey);
      if (url) {
        box.innerHTML = '';
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'width:20px;height:20px;image-rendering:pixelated;object-fit:contain;';
        box.appendChild(img);
        return true;
      }
      return false;
    };

    if (!trySetSprite()) {
      // Show fallback emoji until sprites load
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
 * Builds a larger icon (36×36) for the sidebar group buttons.
 */
export function buildSidebarIcon(icon: CardIcon): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;';

  if (icon.kind === 'sprite' && icon.spriteKey) {
    const spriteKey = icon.spriteKey;
    const fallback = icon.fallback ?? icon.value;

    const trySet = (): boolean => {
      const url = getAnySpriteDataUrl(spriteKey);
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
