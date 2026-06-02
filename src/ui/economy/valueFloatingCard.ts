// src/ui/valueFloatingCard.ts
// Detached, draggable floating cards for economy values (balances + asset values).

import { storage } from '../../utils/storage';
import { log } from '../../utils/logger';
import { pctToPixels, pixelsToPct, clampPct } from '../../utils/windowPosition';
import { onGardenSnapshot, getGardenSnapshot } from '../../features/garden/bridge';
import { onInventoryChange } from '../../store/inventory';
import { onActivePetInfos } from '../../store/pets';
import { computeGardenValueFromCatalog, formatCoinsAbbreviated } from '../../features/economy/valueCalculator';
import { computeInventoryValue, computeAllStoragesValue, computeActivePetsValue, computePlacedDecorAndEggValue, computeGrowingCropsValue, getCachedStorages, onStorageDataChange } from '../../features/economy/storageValue';
import { getAnySpriteDataUrl, getCropSpriteDataUrl, getProduceSpriteDataUrl, getProduceSpriteDataUrlWithMutations, getPetSpriteDataUrl } from '../../sprite-v2/compat';
import { getTopGardenItems, getTopInventoryItems, getTopNetWorthItems, type TopValueItem } from '../../features/economy/topValueItems';
import { getInventoryItems } from '../../store/inventory';
import { getActivePetInfos } from '../../store/pets';
import { debounceCancelable } from '../../utils/scheduling/debounce';
import { subscribeEconomy, getEconomySnapshot, type EconomySnapshot } from '../../store/economyTracker';
import { getFriendBonusMultiplier, onFriendBonusChange } from '../../store/friendBonus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'qpm.valueFloatingCards.v1';

export type ValueCardType = 'coins' | 'credits' | 'dust' | 'garden' | 'inventory' | 'netWorth';
const VALID_TYPES = new Set<string>(['coins', 'credits', 'dust', 'garden', 'inventory', 'netWorth']);

const CARD_LABELS: Record<ValueCardType, string> = {
  coins: 'Coins',
  credits: 'Credits',
  dust: 'Magic Dust',
  garden: 'Garden Value',
  inventory: 'Inventory Value',
  netWorth: 'Net Worth',
};

const CARD_COLORS: Record<ValueCardType, string> = {
  coins: '#ffd600',
  credits: '#42a5f5',
  dust: '#ab47bc',
  garden: '#ffd600',
  inventory: '#ffd600',
  netWorth: '#8f82ff',
};

// ---------------------------------------------------------------------------
// Styles (matching petFloatingCard.ts theme)
// ---------------------------------------------------------------------------

const STYLES = `
.qpm-value-card {
  position: fixed;
  background: rgba(18,20,26,0.96);
  border: 1px solid rgba(143,130,255,0.45);
  border-radius: 9px;
  width: 172px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.55);
  z-index: 999990;
  font-family: inherit;
  user-select: none;
  overflow: hidden;
}
.qpm-value-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: grab;
  background: rgba(143,130,255,0.08);
  border-bottom: 1px solid rgba(143,130,255,0.18);
}
.qpm-value-card__header:active { cursor: grabbing; }
.qpm-value-card__label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qpm-value-card__close {
  width: 18px;
  height: 18px;
  background: none;
  border: none;
  color: rgba(224,224,224,0.45);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
  transition: color 0.12s, background 0.12s;
}
.qpm-value-card__close:hover { color: #e0e0e0; background: rgba(255,255,255,0.1); }
.qpm-value-card__body {
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.qpm-value-card__icon {
  width: 28px;
  height: 28px;
  image-rendering: pixelated;
  object-fit: contain;
  flex-shrink: 0;
}
.qpm-value-card__amount {
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}
.qpm-value-card__rate {
  font-size: 10px;
  font-weight: 600;
  margin-top: 2px;
}
`;

// ---------------------------------------------------------------------------
// Persistence types
// ---------------------------------------------------------------------------

interface PersistedCard {
  type: ValueCardType;
  xPct: number;
  yPct: number;
}

interface PersistedState {
  cards: PersistedCard[];
}

// Approximate card dimensions for ratio math (CSS-defined width, height varies)
const CARD_W = 172;
const CARD_H_APPROX = 80;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

interface FloatingCardEntry {
  type: ValueCardType;
  el: HTMLElement;
  xPct: number;
  yPct: number;
  destroy: () => void;
}

const registry = new Map<ValueCardType, FloatingCardEntry>();
let stylesInjected = false;
let initialized = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureStyles(): void {
  if (stylesInjected) return;
  const el = document.createElement('style');
  el.id = 'qpm-value-card-styles';
  el.textContent = STYLES;
  document.head.appendChild(el);
  stylesInjected = true;
}

function clampPosition(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - 200);
  const maxY = Math.max(0, window.innerHeight - 100);
  return {
    x: Math.max(0, Math.min(maxX, Math.round(x))),
    y: Math.max(0, Math.min(maxY, Math.round(y))),
  };
}

const TYPE_INDEX: Record<ValueCardType, number> = {
  coins: 0, credits: 1, dust: 2, garden: 3, inventory: 4, netWorth: 5,
};

function getDefaultPct(type: ValueCardType): { xPct: number; yPct: number } {
  const offset = TYPE_INDEX[type] * 0.03;
  return { xPct: clampPct(0.9 - offset), yPct: clampPct(0.85 - offset) };
}

function applyPosition(el: HTMLElement, x: number, y: number): void {
  const clamped = clampPosition(x, y);
  el.style.left = `${clamped.x}px`;
  el.style.top = `${clamped.y}px`;
  el.style.right = '';
  el.style.bottom = '';
}

function loadPersistedState(): PersistedState {
  const stored = storage.get<Record<string, unknown>>(STORAGE_KEY, { cards: [] });
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.cards)) {
    return { cards: [] };
  }
  const cards: PersistedCard[] = [];
  for (const raw of stored.cards) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (!VALID_TYPES.has(c.type as string)) continue;
    const type = c.type as ValueCardType;
    // New ratio format
    if (typeof c.xPct === 'number' && typeof c.yPct === 'number') {
      cards.push({ type, xPct: clampPct(c.xPct), yPct: clampPct(c.yPct) });
    // Old pixel format — auto-migrate
    } else if (typeof c.x === 'number' && typeof c.y === 'number') {
      const pct = pixelsToPct(c.x, c.y, CARD_W, CARD_H_APPROX);
      cards.push({ type, xPct: pct.xPct, yPct: pct.yPct });
    }
  }
  return { cards };
}

function persistRegistryState(): void {
  const cards: PersistedCard[] = [];
  for (const entry of registry.values()) {
    cards.push({ type: entry.type, xPct: entry.xPct, yPct: entry.yPct });
  }
  storage.set(STORAGE_KEY, { cards } satisfies PersistedState);
}

function handleViewportResize(): void {
  for (const entry of registry.values()) {
    const w = entry.el.offsetWidth || CARD_W;
    const h = entry.el.offsetHeight || CARD_H_APPROX;
    const pos = pctToPixels(entry.xPct, entry.yPct, w, h);
    entry.el.style.left = `${pos.x}px`;
    entry.el.style.top = `${pos.y}px`;
  }
}

/** Resolve an egg sprite URL, trying multiple key patterns. */
function resolveEggSpriteUrl(): string {
  const prefixes = ['sprite/egg/', 'egg/', 'sprite/pet/', 'pet/'];
  const ids = ['CommonEgg', 'UncommonEgg'];
  for (const id of ids) {
    for (const prefix of prefixes) {
      const url = getAnySpriteDataUrl(`${prefix}${id}`);
      if (url) return url;
    }
  }
  return '';
}

/** Build overlapping circular sprites (avatar-group style). */
function overlappingIcons(urls: string[], size: number): HTMLElement {
  const valid = urls.filter(Boolean);
  if (valid.length <= 1) {
    if (valid.length === 1) {
      const img = document.createElement('img');
      img.src = valid[0]!;
      img.alt = '';
      img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;image-rendering:pixelated;display:block;flex-shrink:0;`;
      return img;
    }
    const span = document.createElement('span');
    span.style.cssText = `font-size:${Math.round(size * 0.6)}px;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
    span.textContent = '📦';
    return span;
  }

  const count = valid.length;
  const itemSize = Math.round(size * 0.72);
  const overlap = Math.round(itemSize * 0.35);
  const totalWidth = itemSize + (count - 1) * (itemSize - overlap);

  const wrap = document.createElement('div');
  wrap.style.cssText = `position:relative;width:${totalWidth}px;height:${size}px;flex-shrink:0;`;

  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.src = valid[i]!;
    img.alt = '';
    const left = i * (itemSize - overlap);
    img.style.cssText = [
      `position:absolute`,
      `left:${left}px`,
      `top:${Math.round((size - itemSize) / 2)}px`,
      `width:${itemSize}px`,
      `height:${itemSize}px`,
      `object-fit:contain`,
      `image-rendering:pixelated`,
      `border-radius:50%`,
      `border:1.5px solid rgba(18,20,26,0.9)`,
      `z-index:${count - i}`,
    ].join(';');
    wrap.appendChild(img);
  }

  return wrap;
}

/** Single row in floating card top-10 list */
function floatingTopRow(item: TopValueItem): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:5px;height:20px;';

  const img = document.createElement('img');
  img.width = 18;
  img.height = 18;
  img.style.cssText = 'image-rendering:pixelated;flex-shrink:0;';
  img.draggable = false;

  if (item.isPet) {
    img.src = getPetSpriteDataUrl(item.species) || getAnySpriteDataUrl(`sprite/pet/${item.species}`) || '';
  } else if (item.isSeed) {
    img.src = getCropSpriteDataUrl(item.species) || '';
  } else if (item.isDecor) {
    img.src = getAnySpriteDataUrl(`decor/${item.species}`) || getAnySpriteDataUrl(item.species) || '';
  } else if (item.isEgg) {
    img.src = getCropSpriteDataUrl(item.species) || getAnySpriteDataUrl(`egg/${item.species}`) || getAnySpriteDataUrl(item.species) || '';
  } else {
    img.src = getProduceSpriteDataUrlWithMutations(item.species, item.mutations) || getCropSpriteDataUrl(item.species) || '';
  }
  if (img.src) row.appendChild(img);

  const name = document.createElement('span');
  name.style.cssText = 'flex:1;font-size:10px;color:rgba(224,224,255,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  let label = item.species;
  if (item.isSeed) label += ' Seeds';
  if (item.quantity && item.quantity > 1) label += ` x${item.quantity}`;
  name.textContent = label;
  row.appendChild(name);

  const val = document.createElement('span');
  val.style.cssText = 'font-size:10px;font-weight:700;color:#ffd600;white-space:nowrap;';
  val.textContent = formatCoinsAbbreviated(item.value);
  row.appendChild(val);

  return row;
}

/** Build a sprite icon element for the floating card body. */
function buildCardIcon(type: ValueCardType, size: number): HTMLElement {
  if (type === 'garden') {
    const url = getCropSpriteDataUrl('Carrot') || getProduceSpriteDataUrl('Carrot');
    if (url) {
      const img = document.createElement('img');
      img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;image-rendering:pixelated;display:block;flex-shrink:0;`;
      img.src = url;
      img.alt = 'garden';
      return img;
    }
  }

  if (type === 'inventory') {
    const coinUrl = getAnySpriteDataUrl('sprite/ui/Coin') || getAnySpriteDataUrl('ui/Coin') || '';
    const cropUrl = getProduceSpriteDataUrl('Carrot') || getCropSpriteDataUrl('Carrot') || '';
    const eggUrl = resolveEggSpriteUrl();
    const urls = [coinUrl, cropUrl, eggUrl].filter(Boolean);
    if (urls.length > 1) return overlappingIcons(urls, size);
    if (urls.length === 1) {
      const img = document.createElement('img');
      img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;image-rendering:pixelated;display:block;flex-shrink:0;`;
      img.src = urls[0]!;
      img.alt = 'inventory';
      return img;
    }
  }

  if (type === 'netWorth') {
    // Same as coins icon — gold coin represents total value
    const coinUrl = getAnySpriteDataUrl('sprite/ui/Coin') || getAnySpriteDataUrl('ui/Coin');
    if (coinUrl) {
      const img = document.createElement('img');
      img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;image-rendering:pixelated;display:block;flex-shrink:0;`;
      img.src = coinUrl;
      img.alt = 'net worth';
      return img;
    }
  }

  // Currency types (coins/credits/dust) — single sprite
  const urlMap: Record<string, () => string | null> = {
    coins: () => getAnySpriteDataUrl('sprite/ui/Coin') || getAnySpriteDataUrl('ui/Coin') || null,
    credits: () => getAnySpriteDataUrl('sprite/ui/Donut') || getAnySpriteDataUrl('ui/Donut') || null,
    dust: () => getAnySpriteDataUrl('sprite/item/MagicDust') || getAnySpriteDataUrl('item/MagicDust') || null,
  };
  const url = urlMap[type]?.() ?? null;
  if (url) {
    const img = document.createElement('img');
    img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;image-rendering:pixelated;display:block;flex-shrink:0;`;
    img.src = url;
    img.alt = type;
    return img;
  }

  // Fallback emoji
  const fallbacks: Record<string, string> = { coins: '🪙', credits: '💎', dust: '✨', garden: '🌿', inventory: '📦', netWorth: '🪙' };
  const span = document.createElement('span');
  span.style.cssText = `font-size:${Math.round(size * 0.6)}px;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
  span.textContent = fallbacks[type] ?? '📦';
  return span;
}

// ---------------------------------------------------------------------------
// Card factory
// ---------------------------------------------------------------------------

function createValueCard(type: ValueCardType, initialPct: { xPct: number; yPct: number }): FloatingCardEntry {
  ensureStyles();

  const cleanups: Array<() => void> = [];
  const card = document.createElement('div');
  card.className = 'qpm-value-card';

  const resolvedPos = pctToPixels(initialPct.xPct, initialPct.yPct, CARD_W, CARD_H_APPROX);
  applyPosition(card, resolvedPos.x, resolvedPos.y);

  // Header
  const header = document.createElement('div');
  header.className = 'qpm-value-card__header';

  const labelEl = document.createElement('div');
  labelEl.className = 'qpm-value-card__label';
  labelEl.textContent = CARD_LABELS[type];
  header.appendChild(labelEl);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'qpm-value-card__close';
  closeBtn.textContent = 'x';
  closeBtn.title = `Close ${CARD_LABELS[type]} card`;
  header.appendChild(closeBtn);

  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'qpm-value-card__body';

  body.appendChild(buildCardIcon(type, 28));

  const textCol = document.createElement('div');
  textCol.style.cssText = 'display:flex;flex-direction:column;';

  const amountEl = document.createElement('div');
  amountEl.className = 'qpm-value-card__amount';
  amountEl.style.color = CARD_COLORS[type];
  amountEl.textContent = '\u2014';
  textCol.appendChild(amountEl);

  const rateEl = document.createElement('div');
  rateEl.className = 'qpm-value-card__rate';
  rateEl.style.display = 'none';
  textCol.appendChild(rateEl);

  body.appendChild(textCol);
  card.appendChild(body);

  // Top-10 overlay dropdown for garden, inventory, and netWorth cards
  let topOverlay: { el: HTMLElement | null; cached: TopValueItem[]; outsideHandler: ((ev: MouseEvent) => void) | null } | null = null;
  if (type === 'garden' || type === 'inventory' || type === 'netWorth') {
    topOverlay = { el: null, cached: [], outsideHandler: null };

    // Add toggle arrow to header (before close button)
    const topArrow = document.createElement('button');
    topArrow.type = 'button';
    topArrow.title = 'Top items';
    topArrow.style.cssText = 'background:none;border:none;color:rgba(224,224,255,0.35);font-size:10px;cursor:pointer;padding:0 2px;flex-shrink:0;transition:color 0.12s,transform 0.15s;line-height:1;';
    topArrow.textContent = '\u25BE';
    header.insertBefore(topArrow, closeBtn);

    function closeTopOverlay(): void {
      if (!topOverlay) return;
      topOverlay.el?.remove();
      topOverlay.el = null;
      if (topOverlay.outsideHandler) {
        document.removeEventListener('click', topOverlay.outsideHandler, true);
        topOverlay.outsideHandler = null;
      }
      topArrow.style.transform = '';
      topArrow.style.color = 'rgba(224,224,255,0.35)';
    }

    function openTopOverlay(): void {
      if (!topOverlay) return;
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed', 'z-index:999991',
        'background:rgba(14,16,22,0.98)',
        'border:1px solid rgba(143,130,255,0.35)',
        'border-radius:8px', 'padding:6px 8px',
        'min-width:180px', 'max-width:220px',
        'max-height:260px', 'overflow-y:auto',
        'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
        'display:flex', 'flex-direction:column', 'gap:2px',
      ].join(';');

      if (topOverlay.cached.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:10px;color:rgba(224,224,255,0.3);padding:2px 0;';
        empty.textContent = 'No items';
        overlay.appendChild(empty);
      } else {
        for (const item of topOverlay.cached) overlay.appendChild(floatingTopRow(item));
      }

      document.body.appendChild(overlay);
      topOverlay.el = overlay;

      const r = card.getBoundingClientRect();
      overlay.style.top = `${r.bottom + 4}px`;
      overlay.style.left = `${r.left}px`;

      topArrow.style.transform = 'rotate(180deg)';
      topArrow.style.color = 'rgba(224,224,255,0.6)';

      const handler = (ev: MouseEvent) => {
        if (!overlay.contains(ev.target as Node) && ev.target !== topArrow) {
          closeTopOverlay();
        }
      };
      topOverlay.outsideHandler = handler;
      setTimeout(() => document.addEventListener('click', handler, true), 0);
    }

    topArrow.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (topOverlay?.el) closeTopOverlay();
      else openTopOverlay();
    });

    cleanups.push(() => closeTopOverlay());
  }

  document.body.appendChild(card);

  let destroyed = false;

  function updateAmount(value: number): void {
    amountEl.textContent = formatCoinsAbbreviated(value);
  }

  function updateTopItems(items: TopValueItem[]): void {
    if (!topOverlay) return;
    topOverlay.cached = items;
    // If overlay is open, rebuild its content
    if (topOverlay.el) {
      topOverlay.el.innerHTML = '';
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:10px;color:rgba(224,224,255,0.3);padding:2px 0;';
        empty.textContent = 'No items';
        topOverlay.el.appendChild(empty);
      } else {
        for (const item of items) topOverlay.el.appendChild(floatingTopRow(item));
      }
    }
  }

  function updateRate(rate: number | null): void {
    if (rate == null || Math.abs(rate) < 1) {
      rateEl.style.display = 'none';
      return;
    }
    rateEl.style.display = '';
    const sign = rate >= 0 ? '+' : '';
    const color = rate >= 0 ? '#4caf50' : '#ef5350';
    rateEl.style.color = color;
    rateEl.textContent = `${sign}${formatCoinsAbbreviated(Math.round(rate))}/hr`;
  }

  // Subscribe to appropriate reactive source
  if (type === 'coins' || type === 'credits' || type === 'dust') {
    function applyEconomy(snap: EconomySnapshot): void {
      if (destroyed) return;
      const cur = snap[type as 'coins' | 'credits' | 'dust'];
      if (!cur.connected) {
        amountEl.textContent = '\u2014';
        amountEl.style.color = 'rgba(224,224,224,0.4)';
        updateRate(null);
        return;
      }
      amountEl.style.color = CARD_COLORS[type];
      updateAmount(cur.balance);
      updateRate('rate' in cur ? cur.rate : null);
    }
    const unsub = subscribeEconomy(applyEconomy);
    cleanups.push(unsub);
  } else if (type === 'garden') {
    const debouncedUpdate = debounceCancelable(() => {
      if (destroyed) return;
      const fb = getFriendBonusMultiplier();
      updateAmount(computeGardenValueFromCatalog(getGardenSnapshot(), fb));
      updateTopItems(getTopGardenItems(getGardenSnapshot(), fb));
    }, 200);
    cleanups.push(debouncedUpdate.cancel);

    cleanups.push(onGardenSnapshot(() => debouncedUpdate(), false));
    cleanups.push(onFriendBonusChange(() => debouncedUpdate()));
    const fbInit = getFriendBonusMultiplier();
    updateAmount(computeGardenValueFromCatalog(getGardenSnapshot(), fbInit));
    updateTopItems(getTopGardenItems(getGardenSnapshot(), fbInit));
  } else if (type === 'netWorth') {
    function computeNetWorth(): number {
      const fb = getFriendBonusMultiplier();
      const snap = getGardenSnapshot();
      return (getEconomySnapshot().coins.balance || 0)
        + (computeGardenValueFromCatalog(snap, fb) || 0)
        + (computeGrowingCropsValue(snap) || 0)
        + (computeInventoryValue(fb) || 0)
        + (computeAllStoragesValue(fb) || 0)
        + (computeActivePetsValue(fb) || 0)
        + (computePlacedDecorAndEggValue(snap) || 0);
    }
    const debouncedUpdate = debounceCancelable(() => {
      if (destroyed) return;
      updateAmount(computeNetWorth());
      const fb = getFriendBonusMultiplier();
      updateTopItems(getTopNetWorthItems(
        getGardenSnapshot(), getInventoryItems(), getCachedStorages(), getActivePetInfos(), fb,
      ));
    }, 200);
    cleanups.push(debouncedUpdate.cancel);

    // React to coins, garden, inventory, pet, storage, and friend bonus changes
    cleanups.push(subscribeEconomy(() => debouncedUpdate()));
    cleanups.push(onGardenSnapshot(() => debouncedUpdate(), false));
    cleanups.push(onInventoryChange(() => debouncedUpdate()));
    cleanups.push(onActivePetInfos(() => debouncedUpdate()));
    cleanups.push(onFriendBonusChange(() => debouncedUpdate()));
    cleanups.push(onStorageDataChange(() => debouncedUpdate()));
    updateAmount(computeNetWorth());
    {
      const fb = getFriendBonusMultiplier();
      updateTopItems(getTopNetWorthItems(
        getGardenSnapshot(), getInventoryItems(), getCachedStorages(), getActivePetInfos(), fb,
      ));
    }
  } else {
    // inventory card
    const debouncedUpdate = debounceCancelable(() => {
      if (destroyed) return;
      const fb = getFriendBonusMultiplier();
      updateAmount(computeInventoryValue(fb));
      updateTopItems(getTopInventoryItems(getInventoryItems(), fb));
    }, 200);
    cleanups.push(debouncedUpdate.cancel);

    cleanups.push(onInventoryChange(() => debouncedUpdate()));
    cleanups.push(onFriendBonusChange(() => debouncedUpdate()));
    const fbInit = getFriendBonusMultiplier();
    updateAmount(computeInventoryValue(fbInit));
    updateTopItems(getTopInventoryItems(getInventoryItems(), fbInit));
  }

  // Drag
  let dragStartX = 0;
  let dragStartY = 0;
  let cardStartLeft = 0;
  let cardStartTop = 0;
  let isDragging = false;

  const onMouseDown = (event: MouseEvent): void => {
    if ((event.target as Element).closest('.qpm-value-card__close')) return;

    const rect = card.getBoundingClientRect();
    applyPosition(card, rect.left, rect.top);

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
    applyPosition(card, cardStartLeft + dx, cardStartTop + dy);
  };

  const onMouseUp = (): void => {
    if (!isDragging) return;
    isDragging = false;
    // Update ratios from final pixel position
    const entry = registry.get(type);
    if (entry) {
      const rect = card.getBoundingClientRect();
      const pct = pixelsToPct(rect.left, rect.top, rect.width || CARD_W, rect.height || CARD_H_APPROX);
      entry.xPct = pct.xPct;
      entry.yPct = pct.yPct;
    }
    persistRegistryState();
  };

  header.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  cleanups.push(() => {
    header.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });

  // Destroy
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    cleanups.forEach((fn) => fn());
    card.remove();
    registry.delete(type);
    persistRegistryState();
  };

  closeBtn.addEventListener('click', destroy);

  return { type, el: card, xPct: initialPct.xPct, yPct: initialPct.yPct, destroy };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function openCardInternal(type: ValueCardType, initialPct?: { xPct: number; yPct: number }): void {
  if (registry.has(type)) {
    const existing = registry.get(type)!;
    existing.el.style.border = '1px solid rgba(143,130,255,0.9)';
    window.setTimeout(() => {
      if (existing.el.isConnected) {
        existing.el.style.border = '1px solid rgba(143,130,255,0.45)';
      }
    }, 450);
    return;
  }

  const entry = createValueCard(type, initialPct ?? getDefaultPct(type));
  registry.set(type, entry);
  persistRegistryState();
  log(`[ValueFloatingCard] Opened ${type} card`);
}

function restorePersistedCards(): void {
  const persisted = loadPersistedState();
  for (const card of persisted.cards) {
    openCardInternal(card.type, { xPct: card.xPct, yPct: card.yPct });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initValueFloatingCards(): void {
  if (initialized) return;
  initialized = true;
  restorePersistedCards();
  window.addEventListener('resize', handleViewportResize);
}

export function toggleValueCard(type: ValueCardType): void {
  initValueFloatingCards();
  if (registry.has(type)) {
    registry.get(type)!.destroy();
  } else {
    openCardInternal(type);
  }
}

export function closeValueCard(type: ValueCardType): void {
  registry.get(type)?.destroy();
}

export function isValueCardOpen(type: ValueCardType): boolean {
  return registry.has(type);
}

export function closeAllValueCards(): void {
  for (const entry of Array.from(registry.values())) {
    entry.destroy();
  }
}
