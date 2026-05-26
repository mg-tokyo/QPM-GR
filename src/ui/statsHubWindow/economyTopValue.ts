// src/ui/statsHubWindow/economyTopValue.ts
// Top-value dropdown overlay for economy tab balance chips.

import { t } from '../../i18n';
import { formatCoinsAbbreviated } from '../../features/valueCalculator';
import {
  getProduceSpriteDataUrlWithMutations,
  getPetSpriteDataUrl,
  getAnySpriteDataUrl,
  getCropSpriteDataUrl,
} from '../../sprite-v2/compat';
import type { TopValueItem } from '../../features/topValueItems';

// ---------------------------------------------------------------------------
// Top-value item row
// ---------------------------------------------------------------------------

/** Single row in the top-10 dropdown */
export function topValueRow(item: TopValueItem): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:5px;height:20px;padding:0 4px;';

  // Sprite
  const img = document.createElement('img');
  img.width = 18;
  img.height = 18;
  img.style.cssText = 'image-rendering:pixelated;flex-shrink:0;';
  img.draggable = false;

  if (item.isPet) {
    const url = getPetSpriteDataUrl(item.species) || getAnySpriteDataUrl(`sprite/pet/${item.species}`) || '';
    img.src = url;
  } else if (item.isSeed) {
    const url = getCropSpriteDataUrl(item.species) || '';
    img.src = url;
  } else if (item.isDecor) {
    const url = getAnySpriteDataUrl(`sprite/decor/${item.species}`) || getAnySpriteDataUrl(item.species) || '';
    img.src = url;
  } else if (item.isEgg) {
    const url = getCropSpriteDataUrl(item.species) || getAnySpriteDataUrl(`sprite/pet/${item.species}`) || getAnySpriteDataUrl(item.species) || '';
    img.src = url;
  } else {
    const url = getProduceSpriteDataUrlWithMutations(item.species, item.mutations) || getCropSpriteDataUrl(item.species) || '';
    img.src = url;
  }
  if (img.src) {
    row.appendChild(img);
  }

  // Species name
  const name = document.createElement('span');
  name.style.cssText = 'flex:1;font-size:10px;color:rgba(224,224,255,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  let itemLabel = item.species;
  if (item.isSeed) itemLabel += ` ${t('feature.statsHub.economy.seedsSuffix')}`;
  if (item.quantity && item.quantity > 1) itemLabel += ` x${item.quantity}`;
  name.textContent = itemLabel;
  row.appendChild(name);

  // Value
  const val = document.createElement('span');
  val.style.cssText = 'font-size:10px;font-weight:700;color:var(--qpm-gold);white-space:nowrap;';
  val.textContent = formatCoinsAbbreviated(item.value);
  row.appendChild(val);

  return row;
}

// ---------------------------------------------------------------------------
// Embed top-10 overlay dropdown into a balance chip
// ---------------------------------------------------------------------------

/** Embed a top-10 overlay dropdown button into a balance chip */
export function embedTopDropdown(chip: HTMLElement): { update: (items: TopValueItem[]) => void; destroy: () => void } {
  let overlayEl: HTMLElement | null = null;
  let outsideHandler: ((ev: MouseEvent) => void) | null = null;
  let cachedItems: TopValueItem[] = [];

  // Toggle arrow button — insert before the pop-out button
  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.title = t('feature.statsHub.economy.topItems');
  arrow.style.cssText = 'background:none;border:none;color:rgba(224,224,255,0.35);font-size:10px;cursor:pointer;padding:0 2px;flex-shrink:0;transition:color 0.12s,transform 0.15s;line-height:1;';
  arrow.textContent = '\u25BE';
  const popBtn = chip.querySelector('button[title^="Pop out"]');
  if (popBtn) chip.insertBefore(arrow, popBtn);
  else chip.appendChild(arrow);

  function closeOverlay(): void {
    overlayEl?.remove();
    overlayEl = null;
    if (outsideHandler) {
      document.removeEventListener('click', outsideHandler, true);
      outsideHandler = null;
    }
    arrow.style.transform = '';
    arrow.style.color = 'rgba(224,224,255,0.35)';
  }

  function openOverlay(): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'z-index:99998',
      'background:rgba(14,16,22,0.98)',
      'border:1px solid rgba(143,130,255,0.35)',
      'border-radius:8px', 'padding:6px 8px',
      'min-width:180px', 'max-width:240px',
      'max-height:260px', 'overflow-y:auto',
      'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
      'display:flex', 'flex-direction:column', 'gap:2px',
    ].join(';');

    if (cachedItems.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:10px;color:rgba(224,224,255,0.3);padding:2px 0;';
      empty.textContent = t('feature.statsHub.economy.noItems');
      overlay.appendChild(empty);
    } else {
      for (const item of cachedItems) overlay.appendChild(topValueRow(item));
    }

    document.body.appendChild(overlay);
    overlayEl = overlay;

    const r = chip.getBoundingClientRect();
    overlay.style.top = `${r.bottom + 4}px`;
    overlay.style.left = `${r.left}px`;

    arrow.style.transform = 'rotate(180deg)';
    arrow.style.color = 'rgba(224,224,255,0.6)';

    outsideHandler = (ev: MouseEvent) => {
      if (!overlay.contains(ev.target as Node) && ev.target !== arrow) {
        closeOverlay();
      }
    };
    setTimeout(() => document.addEventListener('click', outsideHandler!, true), 0);
  }

  arrow.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (overlayEl) closeOverlay();
    else openOverlay();
  });

  function update(items: TopValueItem[]): void {
    cachedItems = items;
    if (overlayEl) {
      overlayEl.innerHTML = '';
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:10px;color:rgba(224,224,255,0.3);padding:2px 0;';
        empty.textContent = t('feature.statsHub.economy.noItems');
        overlayEl.appendChild(empty);
      } else {
        for (const item of items) overlayEl.appendChild(topValueRow(item));
      }
    }
  }

  function destroy(): void {
    closeOverlay();
    arrow.remove();
  }

  return { update, destroy };
}
