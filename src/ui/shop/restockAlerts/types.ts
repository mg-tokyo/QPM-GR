// src/ui/shopRestockAlerts/types.ts
// Type definitions and constants for the Shop Restock Alerts system.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TRACKED_KEY            = 'qpm.restock.tracked';
export const DISMISSED_CYCLES_KEY   = 'qpm.restock.dismissedCycles.v1';
export const TRACKED_UPDATED_EVENT  = 'qpm:restock-tracked-updated';
export const ALERT_ROOT_ID          = 'qpm-restock-alert-root';
export const ALERT_STYLE_ID         = 'qpm-restock-alert-style';
export const COINS_CONFIRM_MODAL_ID = 'qpm-restock-coins-confirm';
export const ALERT_SUCCESS_HIDE_MS      = 1_300;
export const ALERT_ENTER_MS             = 300;
export const ALERT_EXIT_MS              = 180;
export const BUY_SEND_DELAY_MS          = 100;
export const BUY_ACTION_THROTTLE_MS     = 80;
export const OWNERSHIP_BASELINE_WAIT_MS = 1_500;
export const OWNERSHIP_STALE_NOTICE_MS  = 10_000;
export const OWNERSHIP_MAX_CONFIRMATION_MS = 45_000;
export const SOCKET_BIND_POLL_MS           = 500;
export const MY_DATA_ATOM_LABEL             = 'myDataAtom';
export const MY_TOOL_INVENTORY_ATOM_LABEL   = 'myToolInventoryAtom';
export const SEED_SILO_STORAGE_ID     = 'seedsilo';
export const DECOR_SHED_STORAGE_ID    = 'decorshed';
export const SEED_SILO_WS_STORAGE_ID  = 'SeedSilo';
export const DECOR_SHED_WS_STORAGE_ID = 'DecorShed';
export const TOOL_STACK_LIMIT   = 99;
export const TOOL_LIMITED_IDS   = new Set(['cropcleanser', 'wateringcan', 'replenishpotion', 'xppotion']);
export const ALERT_DEBUG_ENABLED = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RestockShopType = 'seed' | 'egg' | 'decor' | 'tool' | 'dawn' | 'snow' | 'weather';

export interface AlertModel {
  key: string;
  shopType: RestockShopType;
  itemId: string;
  stockCycleId: string | null;
  label: string;
  quantity: number;
  priceCoins: number | null;
  weatherBound?: boolean;
  /** V16 ItemType hint for PurchaseShopItem ('Seed'|'Egg'|'Tool'|'Decor'). */
  itemType?: string;
  /** When true, this is a weather event alert (no Buy All button). */
  isWeatherAlert?: boolean;
  /** Remaining duration for weather alerts (ms). */
  weatherDurationMs?: number;
}

export interface ActiveAlert {
  model: AlertModel;
  root: HTMLDivElement;
  itemEl: HTMLDivElement;
  iconImg: HTMLImageElement;
  iconFallbackEl: HTMLSpanElement;
  qtyEl: HTMLSpanElement;
  statusEl: HTMLSpanElement;
  buyBtn: HTMLButtonElement;
  dismissBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
  muteBtn?: HTMLButtonElement;
  busy: boolean;
  pendingConfirmation: boolean;
}

export interface BuyAllResult {
  sent: number;
  baseline: OwnershipBaseline | null;
  confirmationAvailable: boolean;
  error: string | null;
}

export interface OwnershipBaseline {
  count: number;
  includeInventory: boolean;
  includeSeedSilo: boolean;
  includeDecorShed: boolean;
  inventoryKeyItemQuantities: Map<string, number>;
}

export interface PendingOwnershipConfirmation {
  key: string;
  shopType: RestockShopType;
  itemId: string;
  stockCycleId: string | null;
  expectedIncrease: number;
  sent: number;
  baseline: OwnershipBaseline;
  confirmed: number;
  staleNoticeTimerId: number | null;
  staleNoticeShown: boolean;
  maxTimeoutTimerId: number | null;
  autoStoreInFlight: boolean;
  autoStoreFinalMoveRequested: boolean;
  autoStoreStorageId: string | null;
  autoStoreLabel: string | null;
  storedInTargetStorage: boolean;
}
