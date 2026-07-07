// src/ui/shopRestockAlerts/index.ts
// Public lifecycle entry — startShopRestockAlerts / stopShopRestockAlerts.

import { log } from '../../../utils/logger';
import { storage } from '../../../utils/storage';
import { onSpritesReady } from '../../../sprite-v2/compat';
import { getShopStockState, onShopStock, startShopStockStore } from '../../../store/shopStock';
import { startShopRegistry } from '../../../store/shopRegistry';
import { onInventoryChange, startInventoryStore } from '../../../store/inventory';
import { subscribeAtomValue } from '../../../core/atomRegistry';
import { pageWindow } from '../../../core/pageContext';
import {
  DISMISSED_CYCLES_KEY,
  ALERT_STYLE_ID,
  TRACKED_UPDATED_EVENT,
  SOCKET_BIND_POLL_MS,
} from './types';
import {
  alertState,
  activeAlerts,
  alertSpriteUrlCache,
  pendingOwnershipConfirmations,
  dismissedCyclesByKey,
  dismissedInStockKeys,
  debugLastStockStateByKey,
  fallbackCycleByKey,
  lastSeenStockQtyByKey,
  ownershipListeners,
} from './alertState';
import {
  clearPendingOwnershipConfirmation,
  failAllPendingConfirmations,
  debugLog,
  handleInventorySnapshot,
  handleMyDataSnapshot,
  handleToolInventorySnapshot,
} from './ownershipTracker';
import { processShopStock, loadDismissedCycles } from './stockProcessor';
import { applyAlertSprite, removeAlert } from './alertDom';
import { stopAllLoops } from './soundEngine';
import { startWeatherAlertProcessor, stopWeatherAlertProcessor } from './weatherAlertProcessor';

// ---------------------------------------------------------------------------
// Socket close detection
// ---------------------------------------------------------------------------

interface PageWithRoomConnection extends Window {
  MagicCircle_RoomConnection?: { ws?: WebSocket; socket?: WebSocket; currentWebSocket?: WebSocket };
}

let boundSocket: WebSocket | null = null;

function getAlertRoomSocket(): WebSocket | null {
  const connection = (pageWindow as PageWithRoomConnection).MagicCircle_RoomConnection;
  if (!connection) return null;
  return connection.ws ?? connection.socket ?? connection.currentWebSocket ?? null;
}

function handleAlertSocketClose(): void {
  alertState.socketCloseGeneration++;
  if (pendingOwnershipConfirmations.size === 0) {
    debugLog('Socket close detected (no pending confirmations)', { generation: alertState.socketCloseGeneration });
    return;
  }
  debugLog('Socket close detected — failing all pending confirmations', { generation: alertState.socketCloseGeneration });
  failAllPendingConfirmations('Connection lost \u2014 retry purchase');
}

function bindAlertSocketIfNeeded(): void {
  const socket = getAlertRoomSocket();
  if (!socket || socket === boundSocket) return;
  const hadPreviousSocket = boundSocket !== null;
  detachAlertSocketListener();
  boundSocket = socket;
  boundSocket.addEventListener('close', handleAlertSocketClose);
  if (hadPreviousSocket) {
    // Socket was replaced — the old connection is gone.  Increment generation
    // so any in-flight buy flow detects the disconnect, and fail any pending
    // confirmations that the close-event handler may have missed (the old
    // socket's 'close' event can fire after we've already detached).
    alertState.socketCloseGeneration++;
    debugLog('Socket replaced — failing pending confirmations', { generation: alertState.socketCloseGeneration });
    if (pendingOwnershipConfirmations.size > 0) {
      failAllPendingConfirmations('Connection lost \u2014 retry purchase');
    }
  }
  debugLog('Bound alert socket close listener');
}

function detachAlertSocketListener(): void {
  if (!boundSocket) return;
  boundSocket.removeEventListener('close', handleAlertSocketClose);
  boundSocket = null;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startShopRestockAlerts(): void {
  if (alertState.started) return;
  try {
    alertState.started = true;
    debugLog('Starting shop restock alerts');
    dismissedInStockKeys.clear();
    debugLastStockStateByKey.clear();
    fallbackCycleByKey.clear();
    lastSeenStockQtyByKey.clear();
    alertSpriteUrlCache.clear();
    storage.remove(DISMISSED_CYCLES_KEY);
    loadDismissedCycles();
    ownershipListeners.clear();
    for (const key of Array.from(pendingOwnershipConfirmations.keys())) {
      clearPendingOwnershipConfirmation(key);
    }
    alertState.inventoryKeyCounts        = new Map<string, number>();
    alertState.inventoryKeyItemQuantities = new Map<string, Map<string, number>>();
    alertState.seedSiloKeyCounts         = new Map<string, number>();
    alertState.decorShedKeyCounts        = new Map<string, number>();
    alertState.toolInventoryKeyCounts    = new Map<string, number>();
    alertState.hasInventoryBaseline      = false;
    alertState.hasSeedSiloBaseline       = false;
    alertState.hasDecorShedBaseline      = false;
    alertState.hasToolInventoryBaseline  = false;

    void startShopRegistry().catch((error) => {
      log('[ShopRestockAlerts] Failed to start shop registry', error);
    });

    void startShopStockStore().then(() => {
      if (!alertState.started) return;
      alertState.stopStockListener = onShopStock((state) => {
        processShopStock(state);
      }, true);
    }).catch((error) => {
      log('[ShopRestockAlerts] Failed to start shop stock store', error);
    });

    void startInventoryStore().then(() => {
      if (!alertState.started) return;
      alertState.stopInventoryListener = onInventoryChange((data) => {
        handleInventorySnapshot(data);
      }, true);
    }).catch((error) => {
      log('[ShopRestockAlerts] Failed to start inventory store', error);
    });

    void subscribeAtomValue('myData', (value) => {
      handleMyDataSnapshot(value);
    }).then((unsubscribe) => {
      if (!unsubscribe) return;
      if (!alertState.started) {
        unsubscribe();
        return;
      }
      alertState.stopMyDataListener = unsubscribe;
    }).catch((error) => {
      log('[ShopRestockAlerts] Failed to subscribe to myData', error);
    });

    void subscribeAtomValue('toolInventory', (value) => {
      handleToolInventorySnapshot(value);
    }).then((unsubscribe) => {
      if (!unsubscribe) return;
      if (!alertState.started) {
        unsubscribe();
        return;
      }
      alertState.stopToolInventoryListener = unsubscribe;
    }).catch((error) => {
      log('[ShopRestockAlerts] Failed to subscribe to toolInventory', error);
    });

    alertState.stopSpritesReadyListener = onSpritesReady(() => {
      alertSpriteUrlCache.clear();
      for (const active of activeAlerts.values()) {
        applyAlertSprite(active, active.model);
      }
    });

    alertState.trackedChangedHandler = () => {
      processShopStock(getShopStockState());
    };
    window.addEventListener(TRACKED_UPDATED_EVENT, alertState.trackedChangedHandler as EventListener);

    bindAlertSocketIfNeeded();
    alertState.socketPollTimer = window.setInterval(bindAlertSocketIfNeeded, SOCKET_BIND_POLL_MS);

    startWeatherAlertProcessor();
  } catch (error) {
    alertState.started = false;
    log('[ShopRestockAlerts] start failed', error);
  }
}

export function stopShopRestockAlerts(): void {
  if (!alertState.started) return;
  alertState.started = false;
  debugLog('Stopping shop restock alerts');

  alertState.stopStockListener?.();
  alertState.stopStockListener = null;
  alertState.stopInventoryListener?.();
  alertState.stopInventoryListener = null;
  alertState.stopMyDataListener?.();
  alertState.stopMyDataListener = null;
  alertState.stopToolInventoryListener?.();
  alertState.stopToolInventoryListener = null;
  alertState.stopSpritesReadyListener?.();
  alertState.stopSpritesReadyListener = null;
  if (alertState.trackedChangedHandler) {
    window.removeEventListener(TRACKED_UPDATED_EVENT, alertState.trackedChangedHandler as EventListener);
    alertState.trackedChangedHandler = null;
  }
  if (alertState.socketPollTimer != null) {
    clearInterval(alertState.socketPollTimer);
    alertState.socketPollTimer = null;
  }
  detachAlertSocketListener();
  stopAllLoops();
  stopWeatherAlertProcessor();

  dismissedInStockKeys.clear();
  dismissedCyclesByKey.clear();
  debugLastStockStateByKey.clear();
  fallbackCycleByKey.clear();
  lastSeenStockQtyByKey.clear();
  alertSpriteUrlCache.clear();
  ownershipListeners.clear();
  for (const key of Array.from(pendingOwnershipConfirmations.keys())) {
    clearPendingOwnershipConfirmation(key);
  }
  alertState.inventoryKeyCounts         = new Map<string, number>();
  alertState.inventoryKeyItemQuantities = new Map<string, Map<string, number>>();
  alertState.seedSiloKeyCounts          = new Map<string, number>();
  alertState.decorShedKeyCounts         = new Map<string, number>();
  alertState.toolInventoryKeyCounts     = new Map<string, number>();
  alertState.hasInventoryBaseline       = false;
  alertState.hasSeedSiloBaseline        = false;
  alertState.hasDecorShedBaseline       = false;
  alertState.hasToolInventoryBaseline   = false;
  alertState.currentCoinsCount     = 0;
  alertState.hasCoinsBaseline      = false;
  for (const key of Array.from(activeAlerts.keys())) {
    removeAlert(key);
  }
  document.getElementById(ALERT_STYLE_ID)?.remove();
}
