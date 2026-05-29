// src/ui/statsHubWindow/styleHelpers.ts
// Formatting, badge, and small UI helpers shared across Stats Hub tabs.

import { RAINBOW_GRADIENT } from './constants';
import { findVariantBadge, getVariantChipColors } from '../../features/mutations/data/variantBadges';
import { formatCoinsAbbreviated } from '../../features/valueCalculator';
import { getCoinSpriteUrl } from './spriteHelpers';
import { t } from '../../i18n';

// ---------------------------------------------------------------------------
// Rarity styling
// ---------------------------------------------------------------------------

export function rarityBadgeStyle(rarity: 'normal' | 'gold' | 'rainbow'): string {
  const styles: Record<string, string> = {
    normal: 'background:rgba(255,255,255,0.1);color:rgba(224,224,224,0.65)',
    gold: 'background:#ffd600;color:#111',
    rainbow: `background:${RAINBOW_GRADIENT};color:#fff`,
  };
  return [
    styles[rarity] ?? styles.normal,
    'border-radius:4px',
    'padding:1px 6px',
    'font-size:10px',
    'font-weight:700',
    'white-space:nowrap',
    'text-transform:capitalize',
  ].join(';');
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function timeAgo(ts: number): string {
  return formatAge(Date.now() - ts) + ' ago';
}

// ---------------------------------------------------------------------------
// Pill button style
// ---------------------------------------------------------------------------

export function pillBtnCss(active: boolean): string {
  return [
    'padding:5px 11px',
    'border-radius:20px',
    'font-size:12px',
    'font-weight:600',
    'cursor:pointer',
    'border:1px solid',
    'transition:background 0.12s,border-color 0.12s',
    active
      ? 'background:rgba(143,130,255,0.25);border-color:rgba(143,130,255,0.6);color:#c8c0ff'
      : 'background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.12);color:rgba(224,224,224,0.55)',
  ].join(';');
}

// ---------------------------------------------------------------------------
// Mutation badge
// ---------------------------------------------------------------------------

export function mutBadge(mutId: string, grayed = false): HTMLElement {
  const span = document.createElement('span');
  span.style.cssText = [
    'border-radius:4px',
    'padding:2px 7px',
    'font-size:12px',
    'font-weight:700',
    'display:inline-flex',
    'align-items:center',
    'white-space:nowrap',
    'flex-shrink:0',
  ].join(';');

  if (grayed) {
    span.style.cssText += ';background:rgba(255,255,255,0.06);color:rgba(224,224,224,0.28);text-decoration:line-through;';
    span.textContent = mutId;
    return span;
  }

  const badge = findVariantBadge(mutId);
  if (badge?.gradient) {
    span.style.background = badge.gradient;
    span.style.color = '#111';
  } else if (badge?.color) {
    span.style.background = badge.color + '33'; // 20% opacity bg
    span.style.color = badge.color;
    span.style.border = `1px solid ${badge.color}66`;
  } else {
    const { bg, text } = getVariantChipColors(mutId, true);
    span.style.background = bg;
    span.style.color = text;
  }

  span.textContent = mutId;
  return span;
}

// ---------------------------------------------------------------------------
// Section layout helpers
// ---------------------------------------------------------------------------

export function appendEmptyNote(parent: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.style.cssText = 'color:rgba(224,224,224,0.35);font-size:14px;padding:30px 20px;text-align:center;';
  el.textContent = text;
  parent.appendChild(el);
}

export function appendSectionHeader(parent: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.style.cssText = 'font-size:12px;font-weight:700;color:rgba(224,224,224,0.7);';
  el.textContent = text;
  parent.appendChild(el);
}

export function inlineVal(text: string, color: string): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = `color:${color};font-weight:600;font-size:12px;`;
  el.textContent = text;
  return el;
}

// ---------------------------------------------------------------------------
// Coin value elements
// ---------------------------------------------------------------------------

/** Coin value inline element (used in tile cards + value bar) */
export function makeCoinValueEl(coins: number, prefix: string, cssExtra: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.style.cssText = `display:inline-flex;align-items:center;gap:3px;${cssExtra}`;
  wrap.title = `${prefix ? prefix + ' ' : ''}${coins.toLocaleString()}`;

  const coinUrl = getCoinSpriteUrl();
  if (coinUrl) {
    const img = document.createElement('img');
    img.src = coinUrl;
    img.alt = '';
    img.style.cssText = 'width:13px;height:13px;image-rendering:pixelated;flex-shrink:0;vertical-align:middle;';
    wrap.appendChild(img);
  } else {
    const dollar = document.createElement('span');
    dollar.textContent = '$';
    wrap.appendChild(dollar);
  }

  const numEl = document.createElement('span');
  numEl.style.fontWeight = '700';
  numEl.textContent = `${prefix ? prefix + ' ' : ''}${formatCoinsAbbreviated(coins)}`;
  wrap.appendChild(numEl);
  return wrap;
}

/** "+X when complete" hint element — coin sprite + abbreviated value, tight spacing. */
export function makeWhenCompleteHint(gain: number, extraCss = ''): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = `display:inline-flex;align-items:center;gap:2px;font-size:10px;font-weight:700;color:var(--qpm-gold);${extraCss}`;
  el.title = t('feature.statsHub.whenComplete', { value: gain.toLocaleString() });
  const url = getCoinSpriteUrl();
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.cssText = 'width:11px;height:11px;image-rendering:pixelated;flex-shrink:0;';
    el.appendChild(img);
  }
  const txt = document.createElement('span');
  txt.textContent = t('feature.statsHub.whenComplete', { value: formatCoinsAbbreviated(gain) });
  el.appendChild(txt);
  return el;
}
