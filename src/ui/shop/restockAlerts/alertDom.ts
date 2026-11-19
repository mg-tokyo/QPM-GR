// src/ui/shopRestockAlerts/alertDom.ts
// Alert DOM component — creation, upsert, removal; sprite and rarity lookup live in itemLook.ts.

import { t } from '../../../i18n';
// Direct module, not the barrel: the barrel's graph makes the restock tests time out under the full run.
import { createButton } from '../../components/button';
import { applyCardColor, applyCardScale, el, ensureCardShellStyles } from './cardShell';
import { getRestockCardSize } from './cardSize';
import { getAlertSpriteUrl, getItemRarityLook } from './itemLook';
import {
  ALERT_ROOT_ID,
  ALERT_EXIT_MS,
  type RestockShopType,
  type AlertModel,
  type ActiveAlert,
} from './types';
import {
  activeAlerts, hubCards,
  alertPurchaseWatchers,
  dismissedInStockKeys,
  pendingOwnershipConfirmations,
} from './alertState';
import { debugLog, toCanonicalKey, clearPendingOwnershipConfirmation } from './ownershipTracker';
import { handleBuyAll } from './purchaseActions';
import { markDismissedCycle } from './stockProcessor';
import { getShopStockItemByKey, onShopStockItemChange } from '../../../store/shopStock';
import { getSoundConfig, getCustomSounds, DEFAULT_LOOP_INTERVAL_MS } from './soundConfig';
import { playSound, playCustomSound, startLoop, stopLoop, isLooping, isBuiltinSound } from './soundEngine';
import { applyJournalLook, createJournalParts } from './journalSeedCard';
import { playAlertRowSound } from '../../../features/alertHub/raise';

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
  active.iconFallbackEl.style.display = '';
}

/** Border, icon tint and caption in the item's `--qpm-rarity-*` token; weather and unknown items keep the plain border. */
export function applyAlertRarity(active: ActiveAlert, model: AlertModel): void {
  if (model.isWeatherAlert) return;
  const look = getItemRarityLook(model.shopType, model.itemId, model.label);
  if (!look) return;
  applyCardColor(active.root, look.color, undefined);
  active.root.dataset.qpmRarity = look.rarity;
}

// The stack root and every card style live in the card shell stylesheet.
export function ensureAlertStyles(): void {
  ensureCardShellStyles();
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
  if (activeAlerts.size > 0 || hubCards.size > 0) return;
  document.getElementById(ALERT_ROOT_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Alert lifecycle
// ---------------------------------------------------------------------------

export function removeAlert(key: string): void {
  // Only a card's own pending goes with the card. A headless purchaseAndConfirm()
  // pending is not tied to any card (processShopStock removes every untracked key
  // each pass) and settles through its own signals or max timeout. A confirmed
  // pending awaiting its auto-store verdict settles via finishDeferredCompletion.
  const pending = pendingOwnershipConfirmations.get(key);
  if (pending && pending.presenter !== null && pending.deferredCompletionSuffix == null) {
    clearPendingOwnershipConfirmation(key);
  }
  stopLoop(key);
  const watcher = alertPurchaseWatchers.get(key);
  if (watcher) {
    try { watcher.unsubscribe(); } catch { /* ignore */ }
    alertPurchaseWatchers.delete(key);
  }
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
  active.journalMeta?.dispose();
  // Remove from map immediately so duplicate removals are no-ops
  activeAlerts.delete(key);
  // Animate out, then remove DOM
  const card = active.root;
  card.classList.add('qpm-alert-card--exit');
  const cleanup = (): void => { card.remove(); removeAlertRootIfEmpty(); };
  card.addEventListener('animationend', cleanup, { once: true });
  // Safety fallback if animationend never fires (e.g. display:none, detached)
  window.setTimeout(cleanup, ALERT_EXIT_MS + 50);
}

/**
 * Reactive quantity-decrement + dismiss watcher. Captures purchased at first
 * fire; derives remaining = max(0, initialDisplayed - purchasesSinceFirstFire)
 * and writes it back (weather-shop atoms don't decrement currentStock).
 * Dismisses when remaining hits 0 — unless a pending confirmation owns the
 * key: this listener runs first (Set insertion order), and dismissing here
 * would clear the pending before its own tick confirms the purchase.
 */
function armAlertPurchaseWatcher(key: string, cycleId: string | null): void {
  const existing = alertPurchaseWatchers.get(key);
  if (existing) {
    try { existing.unsubscribe(); } catch { /* ignore */ }
    alertPurchaseWatchers.delete(key);
  }
  const item0 = getShopStockItemByKey(key);
  const active0 = activeAlerts.get(key);
  const state: {
    purchasedAtFirstFire: number | null;
    initialDisplayQuantity: number | null;
    cycleId: string | null;
  } = {
    purchasedAtFirstFire: item0 ? item0.purchased : null,
    initialDisplayQuantity: active0 ? active0.model.quantity : null,
    cycleId,
  };
  const unsubscribe = onShopStockItemChange(key, (item) => {
    if (!item) return;
    if (state.purchasedAtFirstFire == null || state.initialDisplayQuantity == null) {
      const active = activeAlerts.get(key);
      state.purchasedAtFirstFire = item.purchased;
      if (state.initialDisplayQuantity == null && active) {
        state.initialDisplayQuantity = active.model.quantity;
      }
      return;
    }
    const purchasesSinceFirstFire = Math.max(0, item.purchased - state.purchasedAtFirstFire);
    if (purchasesSinceFirstFire <= 0) return;
    const derivedRemaining = Math.max(0, state.initialDisplayQuantity - purchasesSinceFirstFire);
    if (derivedRemaining <= 0 && !pendingOwnershipConfirmations.has(key)) {
      debugLog('Alert dismissed via purchased-grow watcher (derived remaining = 0)', {
        key,
        purchasedAtFirstFire: state.purchasedAtFirstFire,
        purchased: item.purchased,
        initialDisplayQuantity: state.initialDisplayQuantity,
        cycleId: state.cycleId,
      });
      dismissAlertForCurrentStock(key, state.cycleId);
      return;
    }
    const active = activeAlerts.get(key);
    if (!active) return;
    if (active.model.quantity === derivedRemaining) return;
    debugLog('Alert quantity decremented via purchased-grow watcher', {
      key,
      prevQuantity: active.model.quantity,
      derivedRemaining,
      purchasesSinceFirstFire,
    });
    updateAlertQuantity(active, derivedRemaining);
  });
  alertPurchaseWatchers.set(key, { ...state, unsubscribe });
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
  const card = el('div', 'qpm-alert-card qpm-restock-alert');
  card.dataset.qpmRestockKey = model.key;

  const top = el('div', 'qpm-alert-card__top');
  const iconBox = el('div', 'qpm-alert-card__icon');
  const iconImg = el('img', '');
  iconImg.loading = 'eager';
  iconImg.decoding = 'async';
  const iconFallbackEl = el('span', 'qpm-alert-card__icon-fallback');
  iconFallbackEl.textContent = '?';
  iconBox.append(iconImg, iconFallbackEl);
  const text = el('div', 'qpm-alert-card__text');
  const captionEl = el('div', 'qpm-alert-card__caption');
  captionEl.textContent = model.isWeatherAlert ? t('feature.restockAlert.weatherActive') : t('feature.restockAlert.pinnedRestocked');
  const itemEl = el('div', 'qpm-alert-card__title');
  itemEl.textContent = model.label;
  text.append(captionEl, itemEl);

  const closeBtn = el('button', 'qpm-alert-card__close');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.title = t('feature.restockAlert.dismiss');
  top.append(iconBox, text, closeBtn);

  const qtyEl = el('span', 'qpm-alert-card__qty');
  if (model.isWeatherAlert && model.weatherDurationMs) {
    const dMin = Math.round(model.weatherDurationMs / 60_000);
    qtyEl.textContent = t('feature.restockAlert.minEvent', { min: dMin });
  } else {
    qtyEl.textContent = t('feature.restockAlert.available', { qty: model.quantity });
  }

  const statusEl = el('span', 'qpm-alert-card__status');
  statusEl.textContent = model.isWeatherAlert ? t('feature.restockAlert.activeNow') : t('feature.restockAlert.readyToBuy');

  const lines = el('div', 'qpm-alert-card__lines');
  const { journalEl, journalMeta } = createJournalParts();
  lines.append(qtyEl, statusEl);

  const actions = el('div', 'qpm-alert-card__actions');
  const buyBtn = createButton(t('feature.restockAlert.buyAll'), { variant: 'tonal', size: 'sm' });
  buyBtn.type = 'button';
  const dismissBtn = createButton(t('feature.restockAlert.dismiss'), { variant: 'ghost', size: 'sm' });
  dismissBtn.type = 'button';
  // A journal-only card sounds its centre row once; a pin's own config (and its loop) never applies to it.
  const journalOnly = model.journal !== undefined && !model.journal.pinned;
  const soundCfg = journalOnly ? null : getSoundConfig(model.key);
  const muteBtn = el('button', 'qpm-alert-card__icon-btn');
  muteBtn.type = 'button';
  muteBtn.title = t('feature.restockAlert.muteSound');
  muteBtn.style.display = soundCfg ? '' : 'none';

  if (model.isWeatherAlert) buyBtn.style.display = 'none';
  actions.append(buyBtn, muteBtn, dismissBtn);

  card.append(top, lines, journalEl, journalMeta.row, actions);
  card.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  card.addEventListener('click', (e) => { e.stopPropagation(); });
  root.prepend(card);

  const active: ActiveAlert = {
    model,
    root: card,
    captionEl,
    journalEl,
    journalMeta,
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
  applyAlertRarity(active, model);
  applyJournalLook(active);
  applyCardScale(card, getRestockCardSize());
  if (journalOnly && model.journal) playAlertRowSound(model.journal.rowId);

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
  armAlertPurchaseWatcher(model.key, model.stockCycleId);
  return active;
}

export function upsertAlert(model: AlertModel): void {
  const existing = activeAlerts.get(model.key);
  if (existing) {
    const prevCycleId = existing.model.stockCycleId;
    if (!existing.busy || !existing.model.itemId.trim()) existing.model.itemId = model.itemId;
    existing.model.stockCycleId = model.stockCycleId;
    existing.model.label        = model.label;
    existing.model.priceCoins   = model.priceCoins;
    if (model.journal) existing.model.journal = model.journal;
    else delete existing.model.journal;
    applyAlertSprite(existing, existing.model);
    applyAlertRarity(existing, existing.model);
    applyJournalLook(existing);
    if (existing.model.quantity !== model.quantity) {
      debugLog('Updating alert quantity', { key: model.key, prevQuantity: existing.model.quantity, nextQuantity: model.quantity, busy: existing.busy, pendingConfirmation: existing.pendingConfirmation });
    }
    updateAlertQuantity(existing, model.quantity);
    if (!existing.busy && !existing.pendingConfirmation) {
      existing.statusEl.style.color = 'var(--qpm-text-muted)';
      existing.statusEl.textContent = t('feature.restockAlert.readyToBuy');
    }
    if (prevCycleId !== model.stockCycleId) {
      armAlertPurchaseWatcher(model.key, model.stockCycleId);
    }
    return;
  }
  createAlert(model);
}

