// src/features/tooltipInjection/ariesCompat.ts
// Aries Mod row detection and icon normalization for tooltip injection.

import { TOOLTIP_ROW_ATTR } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARIES_ICON_MARKER = 'data-qpm-aries-icon';
const ARIES_ROW_ATTR = 'data-aries-value-row';
const ARIES_COIN_ATTR = 'data-aries-coin-value';

// ---------------------------------------------------------------------------
// Row detection
// ---------------------------------------------------------------------------

export function getAriesValueRow(container: Element): HTMLElement | null {
  // 1. Check for QPM-normalized icon
  const icon = container.querySelector(`[${ARIES_ICON_MARKER}]`);
  if (icon) {
    const row = icon.parentElement as HTMLElement | null;
    if (row) {
      row.setAttribute(ARIES_ROW_ATTR, 'true');
      ensureAriesRowMargins(row);
      return row;
    }
  }

  // 2. Check for tagged row
  const taggedRow = container.querySelector(`[${ARIES_ROW_ATTR}]`) as HTMLElement | null;
  if (taggedRow) {
    ensureAriesRowMargins(taggedRow);
    return taggedRow;
  }

  // 3. Check for coin value element
  const coinRow = container.querySelector(`[${ARIES_COIN_ATTR}]`)?.parentElement as HTMLElement | null;
  if (coinRow) {
    coinRow.setAttribute(ARIES_ROW_ATTR, 'true');
    ensureAriesRowMargins(coinRow);
    return coinRow;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Icon normalization
// ---------------------------------------------------------------------------

/**
 * Converts Aries mod `<img>` elements (coin icons) to `<span>` with data URL
 * backgrounds. This prevents the browser from re-requesting the image and
 * avoids layout shifts.
 */
export function normalizeAriesValueIcons(container: Element): void {
  const icons = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
  for (const icon of icons) {
    if (!icon || icon.dataset.qpmAriesNormalized === 'true') continue;

    const { width, height, pointerEvents, userSelect } = icon.style;
    if (width !== '18px' || height !== '18px') continue;
    if (pointerEvents !== 'none' || userSelect !== 'none') continue;

    const span = document.createElement('span');
    span.className = icon.className;
    span.setAttribute('aria-hidden', icon.getAttribute('aria-hidden') ?? 'true');
    span.setAttribute(ARIES_ICON_MARKER, 'true');
    span.setAttribute('style', icon.getAttribute('style') ?? '');
    span.style.backgroundSize = 'contain';
    span.style.backgroundRepeat = 'no-repeat';
    span.style.backgroundPosition = 'center';
    span.style.backgroundImage = `url("${icon.src}")`;

    const parent = icon.parentElement as HTMLElement | null;
    icon.dataset.qpmAriesNormalized = 'true';
    icon.replaceWith(span);

    if (parent) {
      parent.setAttribute(ARIES_ROW_ATTR, 'true');
      ensureAriesRowMargins(parent);
      const coinValue = parent.querySelector('span, strong');
      if (coinValue) {
        (coinValue as HTMLElement).setAttribute(ARIES_COIN_ATTR, 'true');
      }
    }

    // Reposition existing QPM rows after the Aries row
    const journalRow = container.querySelector(
      `:scope > [${TOOLTIP_ROW_ATTR}="journal"]`,
    ) as HTMLElement | null;
    if (journalRow && parent) {
      parent.insertAdjacentElement('afterend', journalRow);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureAriesRowMargins(row: HTMLElement): void {
  row.style.marginTop = '2px';
  row.style.marginBottom = '0';
  row.style.paddingTop = '0';
  const value = row.querySelector('span, strong');
  if (value) {
    const valueEl = value as HTMLElement;
    valueEl.style.display = 'inline-flex';
    valueEl.style.alignItems = 'center';
    valueEl.setAttribute(ARIES_COIN_ATTR, 'true');
  }
}
