import { findLockSpriteUrl } from '../../../utils/lockSprite';
import { getLockerConfig, subscribeLockerConfig, type LockerConfig } from '../../locker';
import { isTileLocked } from '../../locker/tileLockCheck';
import { onTileChanged, resolveCurrentTile } from './atoms';
import type { CardBounds } from './pixiAnchor';
import { LOCK_BADGE_ID } from './types';

const OFFSET_LEFT_PX = 10;
// Positive = above the card, negative = below the card top edge.
// -4 sits the badge ~4px inside the top edge of the card.
const OFFSET_TOP_PX = -4;

let badgeEl: HTMLDivElement | null = null;
let imgEl: HTMLImageElement | null = null;
let currentSrc = '';
// Cache locker config to avoid the per-evaluation deep-clone in getLockerConfig()
// (state.ts:175). Invalidated by subscribeLockerConfig fire.
let cachedConfig: LockerConfig | null = null;
// Cached content state — pure push-driven. Updated only when a subscription
// fires (tile change / config change / sprites ready). rAF position updates
// read this without recomputing.
let shouldShow = false;

// Registered listener unsubscribes; released on destroy.
let tileUnsub: (() => void) | null = null;
let configUnsub: (() => void) | null = null;

export function createLockBadgeElement(): HTMLDivElement {
  if (badgeEl && document.body.contains(badgeEl)) return badgeEl;
  badgeEl = document.createElement('div');
  badgeEl.id = LOCK_BADGE_ID;
  imgEl = document.createElement('img');
  imgEl.alt = 'locked';
  imgEl.draggable = false;
  // Inline transform beats any stylesheet-level override; guarantees the
  // rotation actually paints across browser/game combinations where the
  // stylesheet-level rotation could get silently flattened.
  imgEl.style.transform = 'rotate(40deg)';
  imgEl.style.transformOrigin = '50% 50%';
  badgeEl.appendChild(imgEl);
  document.body.appendChild(badgeEl);
  return badgeEl;
}

export function destroyLockBadgeElement(): void {
  tileUnsub?.();
  tileUnsub = null;
  configUnsub?.();
  configUnsub = null;
  badgeEl?.remove();
  badgeEl = null;
  imgEl = null;
  currentSrc = '';
  cachedConfig = null;
  shouldShow = false;
}

export function hideLockBadge(): void {
  if (!badgeEl) return;
  if (badgeEl.classList.contains('qpm-visible')) badgeEl.classList.remove('qpm-visible');
}

/**
 * Re-evaluate whether the badge should show for the currently focused tile.
 * Called by:
 *  - onTileChanged (atom push: tile focus, slot cycle)
 *  - subscribeLockerConfig (config change)
 * Any time this fires, all three inputs (tile, config, sprite) are current;
 * this eliminates the race between separate subscription caches.
 */
function evaluateContent(): void {
  const img = imgEl;
  if (!img) return;

  const tile = resolveCurrentTile();
  if (!tile) { shouldShow = false; return; }

  if (!cachedConfig) cachedConfig = getLockerConfig();
  if (!isTileLocked(tile, cachedConfig)) { shouldShow = false; return; }

  const src = findLockSpriteUrl('locked');
  if (!src) { shouldShow = false; return; }
  if (src !== currentSrc) {
    img.src = src;
    currentSrc = src;
  }

  shouldShow = true;
}

/**
 * Called from observer.tick() every rAF frame with the current object-card
 * bounds. Position-only — content is push-driven via evaluateContent().
 * When the card is hidden (bounds null) or content says no-show, hides
 * the badge. Otherwise positions it and shows.
 */
export function updateLockBadge(bounds: CardBounds | null): void {
  const el = badgeEl;
  if (!el) return;

  if (!bounds || !shouldShow) {
    hideLockBadge();
    return;
  }

  const centerX = Math.round(bounds.left + bounds.width - OFFSET_LEFT_PX);
  const centerY = Math.round(bounds.top - OFFSET_TOP_PX);
  el.style.left = `${centerX}px`;
  el.style.top = `${centerY}px`;

  if (!el.classList.contains('qpm-visible')) el.classList.add('qpm-visible');
}

/**
 * Wire the badge to reactive sources: tile focus/slot cycle (onTileChanged),
 * locker config (subscribeLockerConfig). Both push into evaluateContent().
 * `onDirty` is called alongside so the stacked overlay repaints in sync.
 */
export function initLockBadge(onDirty: () => void): () => void {
  tileUnsub = onTileChanged(() => {
    evaluateContent();
    onDirty();
  });
  configUnsub = subscribeLockerConfig(() => {
    cachedConfig = null;
    evaluateContent();
    onDirty();
  });

  // Initial evaluation in case atoms already have data when we subscribe.
  evaluateContent();

  return () => {
    tileUnsub?.();
    tileUnsub = null;
    configUnsub?.();
    configUnsub = null;
  };
}
