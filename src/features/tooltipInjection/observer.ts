// src/features/tooltipInjection/observer.ts
// Single shared tooltip observer replacing two independent MutationObservers.
// Fixes bug #2 (nameplate injection) and bug #3 (cascading re-injection).

import { onAdded, onRemoved, watch } from '../../utils/dom';
import { log } from '../../utils/logger';
import { TOOLTIP_SELECTOR, TOOLTIP_STYLE_ID, TOOLTIP_ROW_ATTR, JOURNAL_BADGE_ATTR } from './types';
import type { InjectorFn } from './types';

// ---------------------------------------------------------------------------
// Injector registry
// ---------------------------------------------------------------------------

const injectors = new Map<string, InjectorFn>();

export function registerInjector(id: string, fn: InjectorFn): void {
  injectors.set(id, fn);
}

export function unregisterInjector(id: string): void {
  injectors.delete(id);
}

// ---------------------------------------------------------------------------
// Container resolution (bug #2 fix)
// ---------------------------------------------------------------------------

/**
 * Returns true if the element was injected by QPM (has any data-qpm-* attribute).
 */
function isQpmElement(el: Element): boolean {
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-qpm-')) return true;
  }
  return false;
}

/**
 * Find the detail card's name `<p>` — not the nameplate `<p>`.
 *
 * The detail card section has multiple native (non-QPM) children:
 * the name <p>, mutation display, weight text, etc.
 * The nameplate has just a single <p>.
 *
 * This distinguishes celestial plants (Dawnbinder/Moonbinder) where
 * `querySelector('p.chakra-text')` would match the nameplate first.
 */
function findDetailCardName(tooltipEl: Element): HTMLElement | null {
  const paragraphs = tooltipEl.querySelectorAll('p');
  for (const p of paragraphs) {
    const parent = p.parentElement;
    if (!parent) continue;
    const nativeChildren = [...parent.children].filter(c => !isQpmElement(c));
    if (nativeChildren.length >= 2) return p as HTMLElement;
  }
  return null;
}

/**
 * Resolve the injection container from a tooltip element.
 * Returns [container, cropNameElement] or null if resolution fails.
 */
function resolveContainer(tooltip: Element): [HTMLElement, HTMLElement] | null {
  const cropNameEl = findDetailCardName(tooltip);
  if (!cropNameEl) return null;

  const container = (
    (cropNameEl.closest('.chakra-stack') as HTMLElement | null) ??
    (cropNameEl.parentElement as HTMLElement | null) ??
    tooltip
  ) as HTMLElement;

  return [container, cropNameEl];
}

// ---------------------------------------------------------------------------
// Styles (shared across all injectors)
// ---------------------------------------------------------------------------

function ensureStyles(): void {
  if (document.getElementById(TOOLTIP_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TOOLTIP_STYLE_ID;
  style.textContent = `
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
  `.trim();

  document.head.appendChild(style);
}

export function removeStyles(): void {
  document.getElementById(TOOLTIP_STYLE_ID)?.remove();
}

export { ensureStyles };

// ---------------------------------------------------------------------------
// Tooltip watching
// ---------------------------------------------------------------------------

const tooltipWatchers = new Map<Element, { disconnect: () => void }>();
let domObserverHandle: { disconnect: () => void } | null = null;

function runInjectors(tooltip: Element): void {
  if (injectors.size === 0) return;
  if (tooltip.classList.contains('qpm-window') || tooltip.closest('.qpm-window')) return;

  const resolved = resolveContainer(tooltip);
  if (!resolved) return;
  const [container, cropNameEl] = resolved;

  for (const fn of injectors.values()) {
    try {
      const result = fn(container, cropNameEl);
      // Handle async injectors (e.g., journal badges)
      if (result instanceof Promise) {
        result.catch(() => {});
      }
    } catch {
      // Don't let one injector break others
    }
  }
}

function attachTooltipWatcher(tooltip: Element): void {
  if (tooltipWatchers.has(tooltip)) return;

  let rafId: number | null = null;

  const runAll = () => {
    rafId = null;
    runInjectors(tooltip);
  };

  const scheduleRun = () => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(runAll);
  };

  // Initial run
  runAll();

  const observerHandle = watch(tooltip, scheduleRun);

  tooltipWatchers.set(tooltip, {
    disconnect: () => {
      observerHandle.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  });
}

function detachTooltipWatcher(tooltip: Element): void {
  const handle = tooltipWatchers.get(tooltip);
  if (handle) {
    handle.disconnect();
    tooltipWatchers.delete(tooltip);
  }
}

/** Re-inject all currently tracked tooltips (called on atom change). */
export function reinjectAll(): void {
  for (const tooltip of tooltipWatchers.keys()) {
    runInjectors(tooltip);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startObserver(): void {
  if (domObserverHandle) return;

  ensureStyles();
  log('[TooltipObserver] Watching for crop tooltips');

  const addedHandle = onAdded(TOOLTIP_SELECTOR, attachTooltipWatcher);
  const removedHandle = onRemoved(TOOLTIP_SELECTOR, detachTooltipWatcher);

  domObserverHandle = {
    disconnect: () => {
      addedHandle.disconnect();
      removedHandle.disconnect();
      tooltipWatchers.forEach(handle => handle.disconnect());
      tooltipWatchers.clear();
    },
  };
}

export function stopObserver(): void {
  if (domObserverHandle) {
    domObserverHandle.disconnect();
    domObserverHandle = null;
  }
  removeStyles();
}
