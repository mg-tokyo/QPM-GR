// src/features/shopEnhancer/detection.ts
// Detects shop modal open/close via activeModalAtom subscription.

import { getAtomByLabel, subscribeAtom } from '../../core/jotaiBridge';
import { createLogger } from '../../utils/logger';

const log = createLogger('ShopEnhancer');
import { visibleInterval, timerManager } from '../../utils/timerManager';
import { ENHANCEABLE_SHOP_IDS, MODAL_TO_CATEGORY } from './types';
import type { ShopCategory } from '../../types/shops';

const MODAL_RETRY_TIMER_ID = 'shop-enhancer-modal-retry';

// activeModalAtom can only be found via structural fallback when a modal is
// already open, so we must keep retrying indefinitely until successful.
const RETRY_INTERVAL_MS = 3000;

export type ShopOpenCallback = (modalId: string, category: ShopCategory) => void;
export type ShopCloseCallback = () => void;

let modalAtomUnsub: (() => void) | null = null;
let currentModalId: string | null = null;
let onOpen: ShopOpenCallback | null = null;
let onClose: ShopCloseCallback | null = null;
let retryCount = 0;

function handleModalChange(value: unknown): void {
  const modalId = typeof value === 'string' ? value : null;
  const isShop = modalId !== null && ENHANCEABLE_SHOP_IDS.has(modalId);

  log(`[ShopEnhancer] Modal change: ${String(modalId)} (isShop=${isShop}, current=${currentModalId})`);

  if (isShop && modalId !== currentModalId) {
    currentModalId = modalId;
    const category = MODAL_TO_CATEGORY[modalId]!;
    onOpen?.(modalId, category);
  } else if (!isShop && currentModalId !== null) {
    currentModalId = null;
    onClose?.();
  }
}

async function trySubscribe(): Promise<boolean> {
  if (modalAtomUnsub) return true;

  const atom = getAtomByLabel('activeModalAtom');
  if (!atom) {
    if (retryCount % 10 === 0) {
      log(`[ShopEnhancer] activeModalAtom not found (attempt ${retryCount}). This is normal — atom is only discoverable when a modal is open.`);
    }
    return false;
  }

  try {
    const unsub = await subscribeAtom<unknown>(atom, handleModalChange);
    modalAtomUnsub = unsub;
    timerManager.unregister(MODAL_RETRY_TIMER_ID);
    log('[ShopEnhancer] Subscribed to activeModalAtom');
    return true;
  } catch (err) {
    log('[ShopEnhancer] Failed to subscribe to activeModalAtom', err);
    return false;
  }
}

/**
 * Start detecting shop open/close events.
 * Calls openCb when a shop modal opens, closeCb when it closes.
 */
export function startDetection(openCb: ShopOpenCallback, closeCb: ShopCloseCallback): void {
  onOpen = openCb;
  onClose = closeCb;
  retryCount = 0;

  log('[ShopEnhancer] Starting detection — attempting initial activeModalAtom lookup');

  trySubscribe().then((ok) => {
    if (ok) return;
    // Keep retrying — activeModalAtom is only detectable when a modal is open.
    // No max retries: the atom becomes findable the instant any modal opens.
    visibleInterval(MODAL_RETRY_TIMER_ID, () => {
      retryCount++;
      trySubscribe();
    }, RETRY_INTERVAL_MS);
  });
}

export function stopDetection(): void {
  timerManager.unregister(MODAL_RETRY_TIMER_ID);
  try { modalAtomUnsub?.(); } catch { /* ignore */ }
  modalAtomUnsub = null;
  currentModalId = null;
  onOpen = null;
  onClose = null;
  retryCount = 0;
}

export function getCurrentModalId(): string | null {
  return currentModalId;
}
