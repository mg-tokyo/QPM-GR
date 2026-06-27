// src/ui/components/floatingCard/shell.ts
// Generic draggable floating-card shell. Owns drag handling, viewport-resize
// reposition, registry, and viewport-ratio persistence keyed by config.key
// inside a shared storage entry at config.persistKey. Side-effect free on
// import — the resize listener is installed lazily inside openFloatingCard.

import { storage } from '../../../utils/storage';
import {
  clampPct,
  pctToPixels as _pctToPixels,
  pixelsToPct as _pixelsToPct,
  clampPixels as _clampPixels,
} from '../../../utils/windowPosition';
import type {
  FloatingCardConfig,
  FloatingCardEntry,
  FloatingCardPosition,
  PersistedFloatingCard,
  PersistedFloatingCardsState,
} from './types';

const DEFAULT_BASE_WIDTH = 172;
const HEIGHT_FALLBACK = 120;

interface InternalEntry {
  key: string;
  el: HTMLElement;
  position: FloatingCardPosition;
  persistKey: string | null;
  baseWidth: number;
  refresh: () => void;
  destroy: () => void;
}

const registry = new Map<string, InternalEntry>();
const sessionPositions = new Map<string, FloatingCardPosition>();
let resizeListenerInstalled = false;

function ensureResizeListener(): void {
  if (resizeListenerInstalled) return;
  resizeListenerInstalled = true;
  window.addEventListener('resize', () => {
    for (const entry of registry.values()) entry.refresh();
  });
}

function getCardWidth(el: HTMLElement, baseWidth: number): number {
  return Math.max(baseWidth, el.offsetWidth || baseWidth);
}

function getCardHeight(el: HTMLElement): number {
  return el.offsetHeight || HEIGHT_FALLBACK;
}

function applyPctPosition(el: HTMLElement, xPct: number, yPct: number, baseWidth: number): void {
  const { x, y } = _pctToPixels(xPct, yPct, getCardWidth(el, baseWidth), getCardHeight(el));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function applyPixelPosition(el: HTMLElement, x: number, y: number, baseWidth: number): void {
  const c = _clampPixels(x, y, getCardWidth(el, baseWidth), getCardHeight(el));
  el.style.left = `${c.x}px`;
  el.style.top = `${c.y}px`;
}

/**
 * Load all persisted cards for a given storage key. Tolerates legacy formats:
 *   - Old discriminator `slotIndex: number` (from src/ui/pets/floatingCard/card.ts) → converted to `key: String(slotIndex)`
 *   - Old position fields `x: number, y: number` (absolute pixels) → converted to `xPct`/`yPct` ratios
 */
function loadAllForKey(persistKey: string): PersistedFloatingCardsState {
  const raw = storage.get<unknown>(persistKey, undefined);
  if (!raw || typeof raw !== 'object') return { cards: [], updatedAt: 0 };
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.cards)) return { cards: [], updatedAt: 0 };

  const cards: PersistedFloatingCard[] = [];
  for (const entry of data.cards) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    let key: string | null = null;
    if (typeof e.key === 'string' && e.key.length > 0) {
      key = e.key;
    } else if (typeof e.slotIndex === 'number' && Number.isFinite(e.slotIndex)) {
      key = String(e.slotIndex);
    }
    if (!key) continue;

    let xPct: number | null = null;
    let yPct: number | null = null;
    if (typeof e.xPct === 'number' && typeof e.yPct === 'number') {
      xPct = clampPct(e.xPct);
      yPct = clampPct(e.yPct);
    } else {
      const x = Number(e.x);
      const y = Number(e.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const pct = _pixelsToPct(x, y, DEFAULT_BASE_WIDTH, HEIGHT_FALLBACK);
        xPct = pct.xPct;
        yPct = pct.yPct;
      }
    }
    if (xPct == null || yPct == null) continue;

    cards.push({ key, xPct, yPct });
  }

  return {
    cards,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

/**
 * Persist the positions of currently-open cards under `persistKey`. Closed-card
 * entries are NOT preserved — matching the prior behavior of `card.ts` where
 * destroying a card removed its on-disk entry. In-session reopen restoration is
 * handled separately by `sessionPositions`.
 */
function persistForKey(persistKey: string): void {
  const cards: PersistedFloatingCard[] = [];
  for (const entry of registry.values()) {
    if (entry.persistKey !== persistKey) continue;
    cards.push({ key: entry.key, xPct: entry.position.xPct, yPct: entry.position.yPct });
  }
  storage.set(persistKey, {
    cards,
    updatedAt: Date.now(),
  } satisfies PersistedFloatingCardsState);
}

function resolveInitialPosition(
  key: string,
  persistKey: string | null,
  defaultPosition: FloatingCardPosition | undefined,
  baseWidth: number,
): FloatingCardPosition {
  const session = sessionPositions.get(key);
  if (session) return { xPct: session.xPct, yPct: session.yPct };

  if (persistKey) {
    const persisted = loadAllForKey(persistKey);
    const found = persisted.cards.find((c) => c.key === key);
    if (found) return { xPct: found.xPct, yPct: found.yPct };
  }

  if (defaultPosition) {
    return { xPct: clampPct(defaultPosition.xPct), yPct: clampPct(defaultPosition.yPct) };
  }

  // Safe fallback: bottom-right ish.
  return _pixelsToPct(
    Math.max(16, window.innerWidth - baseWidth - 24),
    Math.max(16, window.innerHeight - HEIGHT_FALLBACK - 24),
    baseWidth,
    HEIGHT_FALLBACK,
  );
}

function matchesDragExclude(target: EventTarget | null, selectors: readonly string[]): boolean {
  if (!(target instanceof Element)) return false;
  for (const sel of selectors) {
    if (!sel) continue;
    if (target.closest(sel)) return true;
  }
  return false;
}

/**
 * Open a draggable floating card with the given config. Idempotent: if a card
 * with the same `key` is already open, returns the existing entry without
 * mounting a duplicate. The shell installs no global state on import — call
 * this function to lazily install the shared resize listener.
 */
export function openFloatingCard(config: FloatingCardConfig): FloatingCardEntry {
  const existing = registry.get(config.key);
  if (existing) {
    return {
      key: existing.key,
      el: existing.el,
      refresh: existing.refresh,
      destroy: existing.destroy,
    };
  }

  ensureResizeListener();

  const baseWidth = config.baseWidth ?? DEFAULT_BASE_WIDTH;
  const persistKey = config.persistKey ?? null;
  const dragExclude = config.dragExcludeSelectors ?? [];

  const card = document.createElement('div');
  if (config.className) card.className = config.className;
  card.style.position = 'fixed';

  card.appendChild(config.header);
  card.appendChild(config.body);
  document.body.appendChild(card);

  const initial = resolveInitialPosition(config.key, persistKey, config.defaultPosition, baseWidth);
  const position: FloatingCardPosition = { xPct: initial.xPct, yPct: initial.yPct };
  applyPctPosition(card, position.xPct, position.yPct, baseWidth);

  let dragStartX = 0;
  let dragStartY = 0;
  let cardStartLeft = 0;
  let cardStartTop = 0;
  let isDragging = false;
  let destroyed = false;

  const onMouseDown = (event: MouseEvent): void => {
    if (matchesDragExclude(event.target, dragExclude)) return;
    const rect = card.getBoundingClientRect();
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    cardStartLeft = rect.left;
    cardStartTop = rect.top;
    event.preventDefault();
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!isDragging) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    applyPixelPosition(card, cardStartLeft + dx, cardStartTop + dy, baseWidth);
  };

  const onMouseUp = (): void => {
    if (!isDragging) return;
    isDragging = false;
    const rect = card.getBoundingClientRect();
    const pct = _pixelsToPct(rect.left, rect.top, getCardWidth(card, baseWidth), getCardHeight(card));
    position.xPct = pct.xPct;
    position.yPct = pct.yPct;
    sessionPositions.set(config.key, { xPct: pct.xPct, yPct: pct.yPct });
    if (persistKey) persistForKey(persistKey);
  };

  config.header.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  const refresh = (): void => {
    applyPctPosition(card, position.xPct, position.yPct, baseWidth);
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;

    // Remember position across reopen within this session.
    sessionPositions.set(config.key, { xPct: position.xPct, yPct: position.yPct });

    config.header.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    card.remove();
    registry.delete(config.key);

    // Persist after removal so destroyed card's entry drops out of storage —
    // mirrors prior behavior in card.ts where storage tracks open cards only.
    if (persistKey) persistForKey(persistKey);

    try { config.onDestroy?.(); } catch { /* ignore */ }
  };

  const internal: InternalEntry = {
    key: config.key,
    el: card,
    position,
    persistKey,
    baseWidth,
    refresh,
    destroy,
  };
  registry.set(config.key, internal);

  if (persistKey) persistForKey(persistKey);

  // Recompute position after first paint in case the body changes the rendered
  // dimensions (clamp math depends on element size).
  requestAnimationFrame(() => {
    if (destroyed) return;
    applyPctPosition(card, position.xPct, position.yPct, baseWidth);
  });

  return { key: config.key, el: card, refresh, destroy };
}

export function closeFloatingCard(key: string): void {
  registry.get(key)?.destroy();
}

export function hasFloatingCard(key: string): boolean {
  return registry.has(key);
}

export function getOpenFloatingCards(): readonly FloatingCardEntry[] {
  return [...registry.values()].map((e) => ({
    key: e.key,
    el: e.el,
    refresh: e.refresh,
    destroy: e.destroy,
  }));
}

/**
 * Read raw persisted entries for a storage key. Consumers that need to auto-open
 * cards on init (e.g. restore previous session's layout) call this and iterate.
 */
export function getPersistedFloatingCards(persistKey: string): readonly PersistedFloatingCard[] {
  return loadAllForKey(persistKey).cards;
}
