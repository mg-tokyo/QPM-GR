// src/ui/hubWindow/cards/iconRenderer.ts — Renders CardIcon with sprite + mutation support

import type { CardIcon, BunchedSpriteEntry } from './types';
import {
  getAnySpriteDataUrl,
  getPetSpriteDataUrlWithMutations,
  getCropSpriteDataUrlWithMutations,
  onSpritesReady,
} from '../../../sprite-v2/compat';

/**
 * Resolves a sprite key + optional mutations to a data URL.
 * Returns empty string if sprites aren't loaded yet.
 */
function resolveSpriteUrl(spriteKey: string, mutations?: readonly string[]): string {
  if (mutations?.length) {
    const muts = mutations as string[];
    const petMatch = spriteKey.match(/^(?:sprite\/)?pet\/(.+)$/);
    if (petMatch?.[1]) return getPetSpriteDataUrlWithMutations(petMatch[1], muts);
    const plantMatch = spriteKey.match(/^(?:sprite\/)?plant\/(.+)$/);
    if (plantMatch?.[1]) return getCropSpriteDataUrlWithMutations(plantMatch[1], muts);
  }
  return getAnySpriteDataUrl(spriteKey);
}

/**
 * Resolves a CardIcon to a data URL, handling mutations if specified.
 */
function resolveIconUrl(icon: CardIcon): string {
  if (!icon.spriteKey) return '';
  return resolveSpriteUrl(icon.spriteKey, icon.spriteMutations);
}

/**
 * Builds a bunched (overlapping cluster) sprite container.
 * Each sprite is offset slightly to create a layered hand-of-cards effect.
 */
function buildBunchedContainer(entries: ReadonlyArray<BunchedSpriteEntry>, size: number): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    'position:relative',
    'flex-shrink:0',
  ].join(';');

  const spriteSize = Math.round(size * 0.7);
  const rotations = [-6, 0, 5, -3]; // slight rotations for organic feel

  const tryRender = (): boolean => {
    let allResolved = true;
    container.innerHTML = '';
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const url = resolveSpriteUrl(entry.spriteKey, entry.mutations);
      if (!url) { allResolved = false; continue; }

      const img = document.createElement('img');
      img.src = url;
      const scale = entry.scale ?? 1;
      const ox = entry.offsetX ?? (i - (entries.length - 1) / 2) * 8;
      const oy = entry.offsetY ?? 0;
      const rot = rotations[i % rotations.length]!;
      img.style.cssText = [
        'position:absolute',
        'image-rendering:pixelated',
        'object-fit:contain',
        `width:${Math.round(spriteSize * scale)}px`,
        `height:${Math.round(spriteSize * scale)}px`,
        `top:50%`,
        `left:50%`,
        `transform:translate(-50%,-50%) translate(${ox}px,${oy}px) rotate(${rot}deg)`,
        `z-index:${i + 1}`,
      ].join(';');
      container.appendChild(img);
    }
    return allResolved;
  };

  if (!tryRender()) {
    onSpritesReady(() => { tryRender(); });
  }

  return container;
}

/**
 * Builds a 28×28 icon box with gradient background.
 * Loads sprites with optional mutations; falls back to emoji.
 */
export function buildIconBox(icon: CardIcon): HTMLElement {
  // Bunched sprites: render overlapping cluster
  if (icon.bunched?.length) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      'width:42px',
      'height:42px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'border-radius:8px',
      'background:linear-gradient(135deg, rgba(143,130,255,0.2), rgba(143,130,255,0.1))',
      'flex-shrink:0',
      'overflow:visible',
    ].join(';');
    wrapper.appendChild(buildBunchedContainer(icon.bunched, 42));
    return wrapper;
  }

  const box = document.createElement('div');
  box.style.cssText = [
    'width:42px',
    'height:42px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'border-radius:8px',
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
        img.style.cssText = 'width:32px;height:32px;image-rendering:pixelated;object-fit:contain;';
        box.appendChild(img);
        return true;
      }
      return false;
    };

    if (!trySetSprite()) {
      box.style.fontSize = '18px';
      box.textContent = fallback;
      onSpritesReady(() => { trySetSprite(); });
    }
  } else {
    box.style.fontSize = '18px';
    box.textContent = icon.value;
  }

  return box;
}

/**
 * Builds a sidebar icon (fills parent 36×36 button).
 */
export function buildSidebarIcon(icon: CardIcon): HTMLElement {
  // Bunched sprites for sidebar
  if (icon.bunched?.length) {
    const wrapper = document.createElement('span');
    wrapper.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;overflow:visible;';
    wrapper.appendChild(buildBunchedContainer(icon.bunched, 36));
    return wrapper;
  }

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
        img.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;object-fit:contain;';
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
