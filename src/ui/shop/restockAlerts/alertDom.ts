// src/ui/shopRestockAlerts/alertDom.ts
// Alert DOM component — creation, upsert, removal, and sprite resolution.

import { t } from '../../../i18n';
import { getItemIdVariants } from '../../../utils/restock/dataService';
import { getAnySpriteDataUrl, getCropSpriteCanvas, getPetSpriteCanvas } from '../../../sprite-v2/compat';
import { canvasToDataUrl } from '../../../utils/dom/canvasHelpers';
import { canonicalItemId } from '../../../utils/restock/dataService';
import {
  ALERT_ROOT_ID,
  ALERT_STYLE_ID,
  ALERT_ENTER_MS,
  ALERT_EXIT_MS,
  type RestockShopType,
  type AlertModel,
  type ActiveAlert,
} from './types';
import {
  activeAlerts,
  alertSpriteUrlCache,
  dismissedInStockKeys,
} from './alertState';
import { debugLog, toCanonicalKey, clearPendingOwnershipConfirmation } from './ownershipTracker';
import { handleBuyAll } from './purchaseActions';
import { markDismissedCycle } from './stockProcessor';
import { getSoundConfig, getCustomSounds, DEFAULT_LOOP_INTERVAL_MS } from './soundConfig';
import { playSound, playCustomSound, startLoop, stopLoop, isLooping, isBuiltinSound } from './soundEngine';

// ---------------------------------------------------------------------------
// Sprite resolution
// ---------------------------------------------------------------------------

function toCompactId(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

function toSingularToolId(value: string): string {
  if (value.endsWith('s') && value.length > 1) return value.slice(0, -1);
  return value;
}

function tryResolveSpriteFromCanvas(candidateId: string): string | null {
  try {
    const petUrl = canvasToDataUrl(getPetSpriteCanvas(candidateId));
    if (petUrl) return petUrl;
  } catch { /* continue */ }
  try {
    const cropUrl = canvasToDataUrl(getCropSpriteCanvas(candidateId));
    if (cropUrl) return cropUrl;
  } catch { /* continue */ }
  return null;
}

function getAlertSpriteCandidates(shopType: RestockShopType, itemId: string, label: string): string[] {
  const ordered = new Set<string>();
  const add = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    ordered.add(trimmed);
    const compact = toCompactId(trimmed);
    if (compact && compact !== trimmed) ordered.add(compact);
  };

  add(itemId);
  add(label);
  for (const variant of getItemIdVariants(shopType, itemId)) add(variant);

  if (shopType === 'tool') {
    const toolCandidates = Array.from(ordered.values());
    for (const candidate of toolCandidates) {
      const singular = toSingularToolId(candidate);
      add(singular);
      if (singular === candidate) add(`${singular}s`);
    }
  }
  return Array.from(ordered.values());
}

function getAlertSpriteUrl(shopType: RestockShopType, itemId: string, label: string): string | null {
  const cacheKey = `${shopType}:${canonicalItemId(shopType, itemId).trim().toLowerCase()}`;
  if (alertSpriteUrlCache.has(cacheKey)) return alertSpriteUrlCache.get(cacheKey) ?? null;

  const candidates = getAlertSpriteCandidates(shopType, itemId, label);
  const keyPrefixes =
    shopType === 'seed'  ? ['sprite/seed/', 'seed/', 'sprite/crop/', 'crop/', 'sprite/plant/', 'plant/'] :
    shopType === 'egg'   ? ['sprite/egg/', 'egg/', 'sprite/pet/', 'pet/'] :
    shopType === 'decor' ? ['sprite/decor/', 'decor/', 'sprite/item/', 'item/'] :
                           ['sprite/item/', 'item/', 'sprite/tool/', 'tool/'];

  for (const candidate of candidates) {
    const canvasUrl = tryResolveSpriteFromCanvas(candidate);
    if (canvasUrl) { alertSpriteUrlCache.set(cacheKey, canvasUrl); return canvasUrl; }

    for (const prefix of keyPrefixes) {
      const directUrl = getAnySpriteDataUrl(`${prefix}${candidate}`);
      if (directUrl) { alertSpriteUrlCache.set(cacheKey, directUrl); return directUrl; }
    }
  }

  alertSpriteUrlCache.set(cacheKey, null);
  return null;
}

export function applyAlertSprite(active: ActiveAlert, model: AlertModel): void {
  const spriteUrl  = getAlertSpriteUrl(model.shopType, model.itemId, model.label);
  const fallbackText = (model.label.trim().charAt(0) || '?').toUpperCase();
  active.itemEl.textContent = model.label;
  active.iconFallbackEl.textContent = fallbackText;
  active.iconImg.alt = `${model.label} sprite`;
  if (spriteUrl) {
    active.iconImg.src = spriteUrl;
    active.iconImg.style.display = 'block';
    active.iconFallbackEl.style.display = 'none';
    return;
  }
  active.iconImg.removeAttribute('src');
  active.iconImg.style.display = 'none';
  active.iconFallbackEl.style.display = 'inline-flex';
}

// ---------------------------------------------------------------------------
// Alert root / styles
// ---------------------------------------------------------------------------

export function ensureAlertStyles(): void {
  if (document.getElementById(ALERT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = ALERT_STYLE_ID;
  style.textContent = [
    '#qpm-restock-alert-root{position:fixed;top:18px;right:18px;z-index:2147483600;display:flex;flex-direction:column;gap:8px;max-width:min(80vw,260px);max-height:90vh;overflow:visible;pointer-events:none;}',
    '.qpm-restock-alert{pointer-events:auto;border:1px solid rgba(143,130,255,0.35);border-radius:10px;background:rgba(18,20,28,0.96);backdrop-filter:blur(2px);box-shadow:0 8px 22px rgba(0,0,0,0.35);padding:8px 10px;display:flex;flex-direction:column;gap:6px;}',
    '.qpm-restock-alert__top{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;}',
    '.qpm-restock-alert__identity{display:flex;align-items:center;gap:8px;min-width:0;flex:1;}',
    '.qpm-restock-alert__icon-shell{width:30px;height:30px;border-radius:7px;border:1px solid rgba(229,231,235,0.16);background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;}',
    '.qpm-restock-alert__icon{width:22px;height:22px;object-fit:contain;image-rendering:pixelated;display:none;}',
    '.qpm-restock-alert__icon-fallback{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;font-size:12px;font-weight:700;color:rgba(229,231,235,0.82);}',
    '.qpm-restock-alert__title-wrap{min-width:0;display:flex;flex-direction:column;gap:2px;}',
    '.qpm-restock-alert__title{font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:rgba(200,192,255,0.72);}',
    '.qpm-restock-alert__item{font-size:13px;font-weight:700;color:#e9e7ff;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.qpm-restock-alert__qty-row{display:flex;justify-content:space-between;align-items:center;gap:6px;}',
    '.qpm-restock-alert__qty{font-size:11px;color:rgba(229,231,235,0.8);}',
    '.qpm-restock-alert__status{font-size:10px;color:rgba(200,192,255,0.72);white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;}',
    '.qpm-restock-alert__actions{display:flex;gap:6px;align-items:center;}',
    '.qpm-restock-alert__btn{border:1px solid rgba(143,130,255,0.35);background:rgba(143,130,255,0.14);color:#ddd7ff;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:600;cursor:pointer;}',
    '.qpm-restock-alert__btn:hover{background:rgba(143,130,255,0.24);}',
    '.qpm-restock-alert__btn--ghost{background:rgba(255,255,255,0.04);border-color:rgba(229,231,235,0.18);color:rgba(229,231,235,0.72);}',
    '.qpm-restock-alert__close{border:none;background:none;color:rgba(229,231,235,0.7);font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}',
    '.qpm-restock-alert__close:hover{color:#ffffff;}',
    '.qpm-restock-alert__btn:disabled,.qpm-restock-alert__close:disabled{opacity:0.55;cursor:default;}',
    '.qpm-restock-alert__mute{border:none;background:none;color:rgba(229,231,235,0.6);font-size:14px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:4px;flex-shrink:0;}',
    '.qpm-restock-alert__mute:hover{color:#fff;background:rgba(255,255,255,0.08);}',
    `@keyframes qpm-alert-enter{0%{opacity:0;transform:translateY(-100%)}70%{opacity:1;transform:translateY(6px)}85%{transform:translateY(-2px)}100%{transform:translateY(0)}}`,
    `@keyframes qpm-alert-exit{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-100%)}}`,
    `.qpm-restock-alert{animation:qpm-alert-enter ${ALERT_ENTER_MS}ms cubic-bezier(0.22,1,0.36,1) both;will-change:transform,opacity;}`,
    `.qpm-restock-alert--exit{animation:qpm-alert-exit ${ALERT_EXIT_MS}ms cubic-bezier(0.55,0,1,0.45) both;pointer-events:none;}`,
  ].join('');
  document.head.appendChild(style);
}

export function getAlertRoot(): HTMLDivElement {
  let root = document.getElementById(ALERT_ROOT_ID) as HTMLDivElement | null;
  if (root) return root;
  root = document.createElement('div');
  root.id = ALERT_ROOT_ID;
  document.body.appendChild(root);
  return root;
}

export function removeAlertRootIfEmpty(): void {
  if (activeAlerts.size > 0) return;
  document.getElementById(ALERT_ROOT_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Alert lifecycle
// ---------------------------------------------------------------------------

export function removeAlert(key: string): void {
  clearPendingOwnershipConfirmation(key);
  stopLoop(key);
  const active = activeAlerts.get(key);
  if (!active) return;
  debugLog('Removing alert', {
    key,
    quantity: active.model.quantity,
    busy: active.busy,
    pendingConfirmation: active.pendingConfirmation,
    stockCycleId: active.model.stockCycleId,
  });
  setAlertPendingConfirmation(active, false);
  // Remove from map immediately so duplicate removals are no-ops
  activeAlerts.delete(key);
  // Animate out, then remove DOM
  const card = active.root;
  card.classList.add('qpm-restock-alert--exit');
  const cleanup = (): void => { card.remove(); removeAlertRootIfEmpty(); };
  card.addEventListener('animationend', cleanup, { once: true });
  // Safety fallback if animationend never fires (e.g. display:none, detached)
  window.setTimeout(cleanup, ALERT_EXIT_MS + 50);
}

export function dismissAlertForCurrentStock(key: string, stockCycleId: string | null): void {
  debugLog('User dismissed alert for current stock cycle', { key, stockCycleId });
  dismissedInStockKeys.add(key);
  markDismissedCycle(key, stockCycleId);
  removeAlert(key);
}

export function setAlertBusy(active: ActiveAlert, busy: boolean): void {
  if (active.busy !== busy) {
    debugLog('Alert busy state changed', { key: active.model.key, busy, pendingConfirmation: active.pendingConfirmation });
  }
  active.busy = busy;
  active.buyBtn.disabled = busy || active.pendingConfirmation;
  active.dismissBtn.disabled = busy;
  active.closeBtn.disabled = busy;
  // Stop looping sound when purchase starts
  if (busy) stopLoop(active.model.key);
}

export function setAlertPendingConfirmation(active: ActiveAlert, pending: boolean): void {
  if (active.pendingConfirmation !== pending) {
    debugLog('Alert pending confirmation state changed', { key: active.model.key, pending, busy: active.busy });
  }
  active.pendingConfirmation = pending;
  active.buyBtn.disabled = active.busy || pending;
}

export function updateAlertQuantity(active: ActiveAlert, quantity: number): void {
  active.model.quantity = quantity;
  active.qtyEl.textContent = t('feature.restockAlert.available', { qty: quantity });
}

// ---------------------------------------------------------------------------
// Mute button icon helper
// ---------------------------------------------------------------------------

function updateMuteButtonIcon(btn: HTMLButtonElement, itemKey: string): void {
  const looping = isLooping(itemKey);
  btn.textContent = looping ? '\uD83D\uDD0A' : '\uD83D\uDD07'; // 🔊 / 🔇
  btn.title = looping ? t('feature.restockAlert.muteSound') : t('feature.restockAlert.unmuteSound');
}

// ---------------------------------------------------------------------------
// Alert DOM creation
// ---------------------------------------------------------------------------

export function createAlert(model: AlertModel): ActiveAlert {
  debugLog('Creating alert', { key: model.key, label: model.label, quantity: model.quantity, shopType: model.shopType, itemId: model.itemId, stockCycleId: model.stockCycleId });
  ensureAlertStyles();
  const root = getAlertRoot();
  const card = document.createElement('div');
  card.className = 'qpm-restock-alert';

  const top = document.createElement('div');
  top.className = 'qpm-restock-alert__top';
  const identity = document.createElement('div');
  identity.className = 'qpm-restock-alert__identity';
  const iconShell = document.createElement('div');
  iconShell.className = 'qpm-restock-alert__icon-shell';
  const iconImg = document.createElement('img');
  iconImg.className = 'qpm-restock-alert__icon';
  iconImg.loading = 'eager';
  iconImg.decoding = 'async';
  const iconFallbackEl = document.createElement('span');
  iconFallbackEl.className = 'qpm-restock-alert__icon-fallback';
  iconFallbackEl.textContent = '?';
  iconShell.append(iconImg, iconFallbackEl);
  const titleWrap = document.createElement('div');
  titleWrap.className = 'qpm-restock-alert__title-wrap';
  const titleEl = document.createElement('div');
  titleEl.className = 'qpm-restock-alert__title';
  titleEl.textContent = model.isWeatherAlert ? t('feature.restockAlert.weatherActive') : t('feature.restockAlert.pinnedRestocked');
  const itemEl = document.createElement('div');
  itemEl.className = 'qpm-restock-alert__item';
  itemEl.textContent = model.label;
  titleWrap.append(titleEl, itemEl);
  identity.append(iconShell, titleWrap);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'qpm-restock-alert__close';
  closeBtn.textContent = 'x';
  closeBtn.title = t('feature.restockAlert.dismiss');
  top.append(identity, closeBtn);

  const qtyEl = document.createElement('span');
  qtyEl.className = 'qpm-restock-alert__qty';
  if (model.isWeatherAlert && model.weatherDurationMs) {
    const dMin = Math.round(model.weatherDurationMs / 60_000);
    qtyEl.textContent = t('feature.restockAlert.minEvent', { min: dMin });
  } else {
    qtyEl.textContent = t('feature.restockAlert.available', { qty: model.quantity });
  }

  const statusEl = document.createElement('span');
  statusEl.className = 'qpm-restock-alert__status';
  statusEl.textContent = model.isWeatherAlert ? t('feature.restockAlert.activeNow') : t('feature.restockAlert.readyToBuy');

  const qtyRow = document.createElement('div');
  qtyRow.className = 'qpm-restock-alert__qty-row';
  qtyRow.append(qtyEl, statusEl);

  const actions = document.createElement('div');
  actions.className = 'qpm-restock-alert__actions';
  const buyBtn = document.createElement('button');
  buyBtn.type = 'button';
  buyBtn.className = 'qpm-restock-alert__btn';
  buyBtn.textContent = t('feature.restockAlert.buyAll');
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'qpm-restock-alert__btn qpm-restock-alert__btn--ghost';
  dismissBtn.textContent = t('feature.restockAlert.dismiss');
  // Mute button (only shown when sound config exists)
  const soundCfg = getSoundConfig(model.key);
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'qpm-restock-alert__mute';
  muteBtn.title = t('feature.restockAlert.muteSound');
  muteBtn.style.display = soundCfg ? '' : 'none';

  if (model.isWeatherAlert) buyBtn.style.display = 'none';
  actions.append(buyBtn, muteBtn, dismissBtn);

  card.append(top, qtyRow, actions);
  card.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  card.addEventListener('click', (e) => { e.stopPropagation(); });
  root.prepend(card);

  const active: ActiveAlert = {
    model,
    root: card,
    itemEl,
    iconImg,
    iconFallbackEl,
    qtyEl,
    statusEl,
    buyBtn,
    dismissBtn,
    closeBtn,
    muteBtn,
    busy: false,
    pendingConfirmation: false,
  };
  applyAlertSprite(active, model);

  // Trigger sound on alert creation
  if (soundCfg) {
    const isCustom = !isBuiltinSound(soundCfg.soundId);
    const customDataUrl = isCustom ? getCustomSounds()[soundCfg.soundId]?.dataUrl : undefined;

    // Play immediately
    if (isCustom && customDataUrl) {
      void playCustomSound(customDataUrl, soundCfg.volume);
    } else {
      void playSound(soundCfg.soundId, soundCfg.volume);
    }

    // Start loop if configured
    if (soundCfg.mode === 'loop') {
      startLoop(model.key, soundCfg.soundId, soundCfg.volume, isCustom, customDataUrl, soundCfg.intervalMs ?? DEFAULT_LOOP_INTERVAL_MS);
    }
  }
  updateMuteButtonIcon(muteBtn, model.key);

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isLooping(model.key)) {
      stopLoop(model.key);
    } else {
      const cfg = getSoundConfig(model.key);
      if (cfg && cfg.mode === 'loop') {
        const custom = !isBuiltinSound(cfg.soundId);
        const dataUrl = custom ? getCustomSounds()[cfg.soundId]?.dataUrl : undefined;
        startLoop(model.key, cfg.soundId, cfg.volume, custom, dataUrl, cfg.intervalMs ?? DEFAULT_LOOP_INTERVAL_MS);
      }
    }
    updateMuteButtonIcon(muteBtn, model.key);
  });

  dismissBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissAlertForCurrentStock(model.key, model.stockCycleId); });
  closeBtn.addEventListener('click',   (e) => { e.stopPropagation(); dismissAlertForCurrentStock(model.key, model.stockCycleId); });
  buyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (active.busy || active.pendingConfirmation) return;
    void handleBuyAll(active);
  });

  activeAlerts.set(model.key, active);
  return active;
}

export function upsertAlert(model: AlertModel): void {
  const existing = activeAlerts.get(model.key);
  if (existing) {
    if (!existing.busy || !existing.model.itemId.trim()) existing.model.itemId = model.itemId;
    existing.model.stockCycleId = model.stockCycleId;
    existing.model.label        = model.label;
    existing.model.priceCoins   = model.priceCoins;
    applyAlertSprite(existing, existing.model);
    if (existing.model.quantity !== model.quantity) {
      debugLog('Updating alert quantity', { key: model.key, prevQuantity: existing.model.quantity, nextQuantity: model.quantity, busy: existing.busy, pendingConfirmation: existing.pendingConfirmation });
    }
    updateAlertQuantity(existing, model.quantity);
    if (!existing.busy && !existing.pendingConfirmation) {
      existing.statusEl.style.color = 'rgba(200,192,255,0.72)';
      existing.statusEl.textContent = t('feature.restockAlert.readyToBuy');
    }
    return;
  }
  createAlert(model);
}

