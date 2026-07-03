// src/features/shopEnhancer/index.ts
// Entry point for the shop enhancer feature.
// Sorts in-stock items first and injects a Buy All button into expansion panels.

import { createLogger } from '../../../utils/logger';

const log = createLogger('ShopEnhancer');
import { visibleInterval, timerManager } from '../../../utils/scheduling/timerManager';
import { startDetection, stopDetection } from './detection';
import { findShopContentContainer, getContentChildCount, resetScannerDiagnostics } from './scanner';
import { applySorting, getScannedRows } from './sorting';
import { extractCtorsFromRows, injectPanelBuyAll, removeBuyAllButtons, resetCtorCache } from './buyAllButton';
import { removeInjected } from '../../../core/pixiScene';
import type { ShopCategory } from '../../../types/shops';
import { storage, SHOP_ENHANCER_MODE_KEY, type ShopEnhancerMode } from '../../../utils/storage';
import { isAriesInstalled } from '../../../integrations/ariesDetection';
import { notifyOncePerSession } from '../../../core/notifications';
import { t } from '../../../i18n';

const POLL_TIMER_ID = 'shop-enhancer-poll';
const POLL_INTERVAL_MS = 300;

let started = false;
let activeCategory: ShopCategory | null = null;
let lastChildCount = -1;

function applyEnhancements(category: ShopCategory): void {
  log(`[ShopEnhancer] Applying enhancements for ${category}`);

  // Sort in-stock first
  applySorting(category);

  // Extract constructors from rows (needed for panel button injection)
  const rows = getScannedRows(category);
  extractCtorsFromRows(rows);

  // If an expansion panel is open, inject Buy All there
  tryInjectPanelButton(category);
}

/** Check for an expansion panel and inject Buy All if found. */
function tryInjectPanelButton(category: ShopCategory): void {
  const content = findShopContentContainer();
  if (!content) return;
  const rows = getScannedRows(category);
  injectPanelBuyAll(content as Record<string, unknown>, rows, category);
}

function pollEnhancements(): void {
  if (!activeCategory) return;

  // Detect content changes (expand/collapse panel, restock, refresh).
  // The game resets y-positions when inserting/removing the expansion panel,
  // so we must re-sort to restore enhancements.
  const currentCount = getContentChildCount();
  if (currentCount !== lastChildCount) {
    log(`[ShopEnhancer] Content child count changed: ${lastChildCount} → ${currentCount}`);
    lastChildCount = currentCount;
    applyEnhancements(activeCategory);
    return;
  }

  // Even without child count change, check for uninjected panel.
  // Handles panel swaps (click different row: 41→41) where count stays the same.
  tryInjectPanelButton(activeCategory);
}

function handleShopOpen(_modalId: string, category: ShopCategory): void {
  activeCategory = category;
  lastChildCount = -1;
  log(`[ShopEnhancer] Shop opened: ${category} (modalId=${_modalId})`);

  // Small delay to let the game finish rendering the modal content
  setTimeout(() => {
    if (!activeCategory) return; // closed before timeout
    applyEnhancements(category);
    lastChildCount = getContentChildCount();
  }, 300);

  // Start polling for re-application
  visibleInterval(POLL_TIMER_ID, pollEnhancements, POLL_INTERVAL_MS);
}

function handleShopClose(): void {
  log('[ShopEnhancer] Shop closed');
  timerManager.unregister(POLL_TIMER_ID);

  // Clean up injected PIXI nodes
  const content = findShopContentContainer();
  if (content) {
    removeBuyAllButtons(content);
    // Also clean any direct injections on item rows
    if (Array.isArray((content as Record<string, unknown>).children)) {
      for (const child of (content as { children: Record<string, unknown>[] }).children) {
        if (child && typeof child === 'object') {
          removeInjected(child);
        }
      }
    }
  }

  resetScannerDiagnostics();
  activeCategory = null;
  lastChildCount = -1;
}

export function startShopEnhancer(): void {
  if (started) return;

  // Compat gate: when Aries Mod is running, its Buy-All + reorder features
  // (upstream: src/utils/shopUtility.ts@main lines 720 & 867) duplicate ours
  // and cause double DOM/PIXI mutation. Default 'auto' skips startup when
  // Aries is detected; the user can override via Settings → Shop enhancer.
  // Detection is kicked off in main.ts before this phase; here we read the
  // cached sync result.
  const mode = (storage.get(SHOP_ENHANCER_MODE_KEY) as ShopEnhancerMode | null) ?? 'auto';
  const ariesDetected = isAriesInstalled();
  const shouldRun =
    mode === 'force-on'  ? true  :
    mode === 'force-off' ? false :
                           !ariesDetected;

  if (!shouldRun) {
    log(`[ShopEnhancer] Skipped — mode=${mode}, aries=${ariesDetected}`);
    if (mode === 'auto' && ariesDetected) {
      notifyOncePerSession({
        key: 'shopEnhancer.disabledForAries',
        feature: 'shopEnhancer',
        level: 'info',
        message: t('feature.shopEnhancer.disabledForAries'),
      });
    }
    return;
  }

  started = true;
  startDetection(handleShopOpen, handleShopClose);
  log('[ShopEnhancer] Started');
}

export function stopShopEnhancer(): void {
  if (!started) return;
  started = false;
  timerManager.unregister(POLL_TIMER_ID);
  stopDetection();
  resetCtorCache();

  // Best-effort cleanup of any lingering injected nodes
  const content = findShopContentContainer();
  if (content) {
    removeBuyAllButtons(content);
  }

  activeCategory = null;
  lastChildCount = -1;
  log('[ShopEnhancer] Stopped');
}
