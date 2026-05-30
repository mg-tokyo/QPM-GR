// src/ui/shopRestockAlerts/alertState.ts
// Shared mutable state for the Shop Restock Alerts system.
// Maps/Sets that are only ever mutated in place (not reassigned) are exported
// directly. Primitives and Maps that need full reassignment live in alertState.

import type { ActiveAlert, PendingOwnershipConfirmation } from './types';

// ---------------------------------------------------------------------------
// In-place mutable collections (safe to export directly)
// ---------------------------------------------------------------------------

export const activeAlerts = new Map<string, ActiveAlert>();
export const dismissedInStockKeys = new Set<string>();
export const dismissedCyclesByKey = new Map<string, string>();
export const ownershipListeners = new Set<() => void>();
export const pendingOwnershipConfirmations = new Map<string, PendingOwnershipConfirmation>();
export const alertSpriteUrlCache = new Map<string, string | null>();
export const fallbackCycleByKey = new Map<string, number>();
export const lastSeenStockQtyByKey = new Map<string, number>();
export const debugLastStockStateByKey = new Map<string, string>();

// ---------------------------------------------------------------------------
// Reassignable state (use alertState.prop = ... from any importer)
// ---------------------------------------------------------------------------

export const alertState = {
  started: false,
  stopStockListener:            null as (() => void) | null,
  stopInventoryListener:        null as (() => void) | null,
  stopMyDataListener:           null as (() => void) | null,
  stopToolInventoryListener:    null as (() => void) | null,
  stopSpritesReadyListener:     null as (() => void) | null,
  trackedChangedHandler:   null as ((event: Event) => void) | null,
  socketPollTimer:              null as number | null,

  inventoryKeyCounts:          new Map<string, number>(),
  inventoryKeyItemQuantities:  new Map<string, Map<string, number>>(),
  seedSiloKeyCounts:           new Map<string, number>(),
  decorShedKeyCounts:          new Map<string, number>(),
  toolInventoryKeyCounts:      new Map<string, number>(),

  hasInventoryBaseline:     false,
  hasSeedSiloBaseline:      false,
  hasDecorShedBaseline:     false,
  hasToolInventoryBaseline: false,
  currentCoinsCount: 0,
  hasCoinsBaseline: false,
  /** Incremented every time a socket close or socket replacement is detected. */
  socketCloseGeneration: 0,
};
