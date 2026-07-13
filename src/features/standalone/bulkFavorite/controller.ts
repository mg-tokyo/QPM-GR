import { onInventoryChange } from '../../../store/inventory';
import { onSpritesReady } from '../../../sprite-v2/compat';
import { healthBus } from '../../../diagnostics/healthBus';
import {
  DEBOUNCE_MS,
  RESIZE_DEBOUNCE_MS,
  IMMEDIATE_SYNC_THROTTLE_MS,
} from './constants';
import { FEATURE_SUBSYSTEM, configRef, log, saveConfig, ui } from './state';
import { ensureStyles, hideSidebar, renderSidebar, syncSidebar } from './sidebar';

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let inventoryUnsubscribe: (() => void) | null = null;
let resizeListener: (() => void) | null = null;
let spritesReadyUnsubscribe: (() => void) | null = null;

function handleMutations(): void {
  // Mutation observer should only manage visibility/position.
  // Content refresh is driven by inventory-store updates and explicit refresh calls.
  syncSidebar(false);
}

function debouncedMutationHandler(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(handleMutations, DEBOUNCE_MS);
}

function shouldIgnoreMutations(records: MutationRecord[]): boolean {
  if (!ui.sidebar) return false;
  const sb = ui.sidebar;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    const target = record.target;
    if (!(target instanceof Node) || !sb.contains(target)) return false;

    const added = record.addedNodes;
    for (let j = 0; j < added.length; j += 1) {
      const node = added[j];
      if (!node || !sb.contains(node)) return false;
    }
    // Removed nodes may no longer be connected; the target-inside-sidebar
    // check above is the fallback that covers them (matches prior semantics).
  }
  return true;
}

function handleResize(): void {
  if (!ui.sidebar) return;

  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer);
  }

  resizeDebounceTimer = setTimeout(() => {
    resizeDebounceTimer = null;
    syncSidebar(false, true);
  }, RESIZE_DEBOUNCE_MS);
}

export function startBulkFavorite(): void {
  if (!configRef.current.enabled) {
    hideSidebar();
    return;
  }

  if (observer) {
    log.debug('Already started');
    return;
  }

  // Register the feature's bus row on first start; idempotent (healthBus
  // .register preserves an existing entry's status if it's already there).
  healthBus.register(FEATURE_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });

  ensureStyles();

  observer = new MutationObserver((records) => {
    if (shouldIgnoreMutations(records)) return;

    // When the sidebar is already visible, coalesce syncs at
    // IMMEDIATE_SYNC_THROTTLE_MS (was per-rAF, up to 60 Hz on garden churn).
    // Close-probe fallback at CLOSE_PROBE_MS still catches inventory-close.
    if (ui.sidebar) {
      if (ui.immediateSyncTimer !== null) return;
      ui.immediateSyncTimer = setTimeout(() => {
        ui.immediateSyncTimer = null;
        syncSidebar(false, true);
      }, IMMEDIATE_SYNC_THROTTLE_MS);
      return;
    }

    debouncedMutationHandler();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  inventoryUnsubscribe = onInventoryChange(() => {
    if (ui.sidebar) {
      renderSidebar();
    }
  });

  spritesReadyUnsubscribe = onSpritesReady(() => {
    ui.lockUiSpriteCache = null;
    renderSidebar(true);
  });

  resizeListener = handleResize;
  window.addEventListener('resize', resizeListener);

  syncSidebar(true);
  log.info('Started');
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message: 'Observing inventory modal',
  });
}

export function stopBulkFavorite(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = null;
  }

  if (ui.closeProbeTimer) {
    clearTimeout(ui.closeProbeTimer);
    ui.closeProbeTimer = null;
  }

  if (ui.immediateSyncTimer !== null) {
    clearTimeout(ui.immediateSyncTimer);
    ui.immediateSyncTimer = null;
  }

  if (inventoryUnsubscribe) {
    inventoryUnsubscribe();
    inventoryUnsubscribe = null;
  }

  if (resizeListener) {
    window.removeEventListener('resize', resizeListener);
    resizeListener = null;
  }

  if (spritesReadyUnsubscribe) {
    spritesReadyUnsubscribe();
    spritesReadyUnsubscribe = null;
  }

  ui.lastLayoutSignature = '';
  ui.lastRenderSignature = '';
  ui.anchorMissCount = 0;
  ui.lockUiSpriteCache = null;

  hideSidebar();
  log.info('Stopped');
}

export function refreshBulkFavorite(): void {
  syncSidebar(true);
}

export function isBulkFavoriteActive(): boolean {
  return observer !== null;
}

export function isBulkFavoriteEnabled(): boolean {
  return configRef.current.enabled;
}

export function setBulkFavoriteEnabled(enabled: boolean): void {
  const next = Boolean(enabled);
  if (configRef.current.enabled === next) return;

  configRef.current = { ...configRef.current, enabled: next };
  saveConfig();

  if (next) {
    startBulkFavorite();
  } else {
    stopBulkFavorite();
  }
}
