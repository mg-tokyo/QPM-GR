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
// Reactive signals (shopPurchases delta / cycle rollover / envelope reject /
// inventory delta) settle the pending in the common case; these two are the
// defensive last-resort covering scenarios where every reactive source is
// silent (backgrounded tab, offline atom, etc.).
export const OWNERSHIP_STALE_NOTICE_MS  = 5_000;
export const OWNERSHIP_MAX_CONFIRMATION_MS = 15_000;
export const SOCKET_BIND_POLL_MS           = 500;
export const MY_DATA_ATOM_LABEL             = 'myDataAtom';
export const MY_TOOL_INVENTORY_ATOM_LABEL   = 'myToolInventoryAtom';
export const SEED_SILO_STORAGE_ID     = 'seedsilo';
export const DECOR_SHED_STORAGE_ID    = 'decorshed';
export const TOOL_SHACK_STORAGE_ID    = 'toolshack';
export const SEED_SILO_WS_STORAGE_ID  = 'SeedSilo';
export const DECOR_SHED_WS_STORAGE_ID = 'DecorShed';
export const TOOL_SHACK_WS_STORAGE_ID = 'ToolShack';
/** Fallback tool caps, used only while the item catalog (`maxInventoryQuantity`) is unavailable. */
export const TOOL_STACK_LIMIT   = 99;
export const TOOL_LIMITED_IDS   = new Set(['cropcleanser', 'wateringcan', 'replenishpotion', 'xppotion']);
export const ALERT_DEBUG_ENABLED = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Standard singular types, the 'weather' event pseudo-type, or any weather-gated shop id (dawn, snow, thunder, runtime-discovered). */
export type RestockShopType = 'seed' | 'egg' | 'decor' | 'tool' | 'weather' | (string & {});

export interface AlertModel {
  key: string;
  shopType: RestockShopType;
  itemId: string;
  stockCycleId: string | null;
  label: string;
  quantity: number;
  priceCoins: number | null;
  weatherBound?: boolean;
  /** Game ItemType hint for PurchaseShopItem ('Seed'|'Egg'|'Tool'|'Decor'|future). */
  itemType?: string;
  /** Wire id field for PurchaseShopItem (`species`, `eggId`, …) when known from the shop entry. */
  idField?: string;
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
  /** Envelope-transport only. One entry per sent request; empty under legacy. */
  awaitResults?: Array<() => Promise<import('../../../websocket/envelope').QuinoaCommandResultMessage>>;
}

export interface OwnershipBaseline {
  count: number;
  includeInventory: boolean;
  includeSeedSilo: boolean;
  includeDecorShed: boolean;
  includeToolShack: boolean;
  inventoryKeyItemQuantities: Map<string, number>;
}

export interface PurchaseOutcome {
  sent: number;
  confirmed: number;
  storedIn: string | null;
  error: string | null;
  timedOut: boolean;
}

export interface PendingCompletionInfo {
  confirmed: number;
  storedNote: string;
  completionSuffix: string;
  lockDismissForCycle: boolean;
  stockCycleId: string | null;
}

/** Alert-card UI hooks for a pending purchase. Null when the pending is headless (purchaseAndConfirm). */
export interface PendingPresenter {
  showStaleNotice(sent: number): void;
  showProgress(confirmed: number, sent: number): void;
  showCompletion(info: PendingCompletionInfo): void;
  showFailure(reason: string): void;
}

/** Fields whose change signals a cycle rollover (server-side stock reset). */
export interface CycleFingerprint {
  nextRestockAt: number | null;
  initialStock: number | null;
  canSpawn: boolean;
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
  /** Signal A baseline — server-acked purchases counter at arm time. Null when discovery couldn't locate shopPurchases. */
  shopPurchasesBaseline: number | null;
  /** Signal B baseline — cycle fingerprint at arm time. Null when the item wasn't in the shop snapshot at arm. */
  cycleArmFp: CycleFingerprint | null;
  /** Reactive subscription teardowns installed at arm time; called in clearPendingOwnershipConfirmation. */
  cleanups: Array<() => void>;
  /** Null for headless purchases; alert card writer for Buy-button flow. */
  presenter: PendingPresenter | null;
  /** Called exactly once on completion, failure, or timeout. */
  settle?: (outcome: PurchaseOutcome) => void;
}
