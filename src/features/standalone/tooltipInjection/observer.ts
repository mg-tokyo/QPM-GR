// src/features/standalone/tooltipInjection/observer.ts
// Overlay lifecycle for the tile info system.
//
// MG's tile info moved from a DOM tooltip to a PIXI `GardenInfoCardSystem`.
// This file no longer observes DOM mutations — it drives a persistent QPM
// DOM overlay that tracks the PIXI card's bounds each frame (via
// pixiAnchor.getCardBounds) and hosts QPM injector output (journal letters
// + sell price) as extra rows flush against the card's bottom edge.
//
// The exported API (`registerInjector`, `unregisterInjector`, `reinjectAll`,
// `startObserver`, `stopObserver`) preserves the old surface so index.ts
// and the config wrappers don't need signature changes.

import { log } from '../../../utils/logger';
import { getCardBounds, getObjectCardBounds, resetAnchor, installAnchorDebugBridge, uninstallAnchorDebugBridge } from './pixiAnchor';
import type { CardBounds } from './pixiAnchor';
import {
  OVERLAY_ID,
  LOCK_BADGE_ID,
  TOOLTIP_STYLE_ID,
  TOOLTIP_ROW_ATTR,
  JOURNAL_BADGE_ATTR,
} from './types';
import type { InjectorFn } from './types';
import {
  createLockBadgeElement,
  destroyLockBadgeElement,
  updateLockBadge,
  hideLockBadge,
} from './lockBadge';

// ---------------------------------------------------------------------------
// Injector registry
// ---------------------------------------------------------------------------

const injectors = new Map<string, InjectorFn>();

export function registerInjector(id: string, fn: InjectorFn): void {
  injectors.set(id, fn);
  // Fresh injector — force a repaint next tick so content appears immediately.
  dirtyContent = true;
}

export function unregisterInjector(id: string): void {
  injectors.delete(id);
  // Remove that injector's rows from the overlay so stale content doesn't
  // linger — matches the previous behavior when a feature was toggled off.
  const el = overlayEl;
  if (el) el.replaceChildren();
  dirtyContent = true;
}

// ---------------------------------------------------------------------------
// Styles — QPM overlay matches MG's PixiTooltip look (bg #141414@0.9,
// border #717171, radius 4px, Greycliff CF 14/700). Values are lifted from
// PixiTooltip/config.ts in the beta source so the overlay reads as a
// continuation of the native card.
// ---------------------------------------------------------------------------

function ensureStyles(): void {
  if (document.getElementById(TOOLTIP_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TOOLTIP_STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      z-index: 99997;
      pointer-events: none;
      user-select: none;
      background: rgba(20, 20, 20, 0.9);
      border: 1px solid rgba(113, 113, 113, 1);
      border-radius: 4px;
      padding: 4px 8px;
      font-family: "Greycliff CF", var(--qpm-font, "Inter", "Segoe UI", Arial, sans-serif);
      font-size: 14px;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.87);
      line-height: 18px;
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      opacity: 0;
      transform: translate(-50%, -100%);
      transition: opacity 100ms ease-out;
      white-space: nowrap;
    }
    #${OVERLAY_ID}.qpm-visible {
      display: flex;
      opacity: 1;
    }

    [${TOOLTIP_ROW_ATTR}] {
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }

    [${TOOLTIP_ROW_ATTR}="journal"] {
      gap: 8px;
      margin-top: 0;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.01em;
      line-height: 16px;
    }

    [${TOOLTIP_ROW_ATTR}="value"] {
      gap: 5px;
      margin-top: 2px;
    }
    [${TOOLTIP_ROW_ATTR}="value"] img {
      width: 16px;
      height: 16px;
      image-rendering: pixelated;
      flex-shrink: 0;
    }
    [${TOOLTIP_ROW_ATTR}="value"] span {
      color: var(--qpm-gold, #FFD700);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-shadow: 0 1px 2px rgba(0,0,0,0.4);
    }

    [${JOURNAL_BADGE_ATTR}] {
      font-weight: 600;
      letter-spacing: 0.04em;
      display: inline-block;
      margin: 0 1px;
      min-width: 10px;
      text-align: center;
    }

    #${LOCK_BADGE_ID} {
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      user-select: none;
      width: 32px;
      height: 32px;
      transform: translate(-50%, -50%);
      display: none;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,0.65));
    }
    #${LOCK_BADGE_ID}.qpm-visible { display: block; }
    #${LOCK_BADGE_ID} img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      transform-origin: 50% 50%;
    }
  `.trim();

  document.head.appendChild(style);
}

function removeStyles(): void {
  document.getElementById(TOOLTIP_STYLE_ID)?.remove();
}

export { ensureStyles };

// ---------------------------------------------------------------------------
// Overlay DOM lifecycle
// ---------------------------------------------------------------------------

let overlayEl: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = OVERLAY_ID;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function hideOverlay(): void {
  if (!overlayEl) return;
  overlayEl.classList.remove('qpm-visible');
  // Clear children so a stale journal/value row doesn't flash on next show.
  overlayEl.replaceChildren();
}

function positionOverlay(el: HTMLDivElement, bounds: CardBounds): void {
  // Anchor overlay bottom-center to the card's top-center, 4px gap. Overlay
  // sits directly above MG's info card; CSS transform (translate -50%, -100%)
  // pulls it up by its own height so `top` marks the overlay's bottom edge.
  const centerX = Math.round(bounds.left + bounds.width / 2);
  const bottom = Math.round(bounds.top - 4);
  el.style.left = `${centerX}px`;
  el.style.top = `${bottom}px`;
}

function runInjectors(container: HTMLElement): void {
  if (injectors.size === 0) return;
  for (const fn of injectors.values()) {
    try {
      const result = fn(container);
      if (result instanceof Promise) result.catch(() => { /* per-frame rAF path; injectors own async error surfacing */ });
    } catch {
      // Isolate injector failures — never let one break the rest.
    }
  }
}

// ---------------------------------------------------------------------------
// rAF loop — cheap position tracking + on-demand content refresh
// ---------------------------------------------------------------------------

let rafHandle: number | null = null;
let cardWasVisible = false;
let dirtyContent = true;
// When no card is visible, `getCardBounds()` still walks the whole PIXI stage
// looking for GardenInfoCardSystem. Decimate that walk: run only every Nth
// frame while idle. Atoms mark `dirtyContent = true` on selection change to
// re-arm the walk immediately.
const IDLE_DISCOVERY_INTERVAL = 12;
let idleFrameCounter = 0;

function tick(): void {
  rafHandle = null;

  // Idle path — no card last frame and no atom-driven dirty flag.
  // Skip the stage walk until the counter elapses.
  if (!cardWasVisible && !dirtyContent) {
    idleFrameCounter++;
    if (idleFrameCounter < IDLE_DISCOVERY_INTERVAL) {
      rafHandle = window.requestAnimationFrame(tick);
      return;
    }
    idleFrameCounter = 0;
  } else {
    idleFrameCounter = 0;
  }

  const bounds = getCardBounds();

  if (!bounds) {
    if (cardWasVisible) {
      hideOverlay();
      hideLockBadge();
      cardWasVisible = false;
    }
    rafHandle = window.requestAnimationFrame(tick);
    return;
  }

  const el = ensureOverlay();

  // Refresh content only on transitions or when atoms have marked us dirty.
  // Position sync happens every frame regardless (cheap style writes).
  if (!cardWasVisible || dirtyContent) {
    runInjectors(el);
    dirtyContent = false;
    cardWasVisible = true;
  }

  if (el.children.length === 0) {
    // Nothing to show for this tile (e.g. non-plant object, all variants
    // logged, tile value disabled). Keep overlay hidden but stay tracking.
    if (el.classList.contains('qpm-visible')) el.classList.remove('qpm-visible');
  } else {
    positionOverlay(el, bounds);
    if (!el.classList.contains('qpm-visible')) el.classList.add('qpm-visible');
  }

  // Badge path — anchors to the inner GardenInfoObjectCard, distinct
  // from the stacked overlay's GardenInfoCardSystem anchor. The badge
  // re-evaluates every frame from cached (reactive-push-populated) state;
  // subscription cache updates promptly, so this is snappy.
  const objBounds: CardBounds | null = getObjectCardBounds();
  updateLockBadge(objBounds);

  rafHandle = window.requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Public lifecycle — names preserved for compatibility with index.ts
// ---------------------------------------------------------------------------

let resizeObserver: ResizeObserver | null = null;

/**
 * Force injectors to re-run on the next tick. Called from atom-change
 * subscriptions (garden object, selected slot, friend bonus).
 */
export function reinjectAll(): void {
  dirtyContent = true;
}

export function startObserver(): void {
  if (rafHandle !== null) return;
  ensureStyles();
  ensureOverlay();
  createLockBadgeElement();
  installAnchorDebugBridge();
  cardWasVisible = false;
  dirtyContent = true;
  log('[TooltipOverlay] Tracking PIXI GardenInfoCardSystem (debug: window.__QPM_TOOLTIP_ANCHOR_DEBUG__())');
  rafHandle = window.requestAnimationFrame(tick);

  // Invalidate the PIXI anchor on canvas resize — layout may have shifted.
  const canvas = document.querySelector('.QuinoaCanvas canvas');
  if (canvas instanceof HTMLCanvasElement) {
    resizeObserver = new ResizeObserver(() => {
      resetAnchor();
      dirtyContent = true;
    });
    resizeObserver.observe(canvas);
  }
}

export function stopObserver(): void {
  if (rafHandle !== null) {
    window.cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  destroyLockBadgeElement();
  resetAnchor();
  uninstallAnchorDebugBridge();
  removeStyles();
  cardWasVisible = false;
  dirtyContent = true;
}
