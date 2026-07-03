// src/types/gameAtoms.ts
// Shared type definitions for known MagicGarden jotai atoms we consume.

export type WeatherAtomValue = string | null | undefined;

export interface GridPosition {
  x: number;
  y: number;
}

export interface PlayerAtomValue {
  id?: string;
  name?: string;
  cosmetic?: unknown;
  discordUserId?: string;
  databaseUserId?: string;
  [key: string]: unknown;
}

export interface AvatarData {
  avatar: readonly string[];
  discordAvatarUrl: string | null;
  displayName: string;
  nameTagColors?: {
    textColor: string;
    backgroundColor: string;
  };
  [key: string]: unknown;
}

export interface ShopInventoryEntry {
  species?: string;
  eggId?: string;
  toolId?: string;
  decorId?: string;
  itemId?: string;
  name?: string;
  displayName?: string;
  price?: number;
  priceCoins?: number;
  priceCredits?: number;
  currency?: 'coins' | 'credits' | 'magicDust';
  stock?: number;
  initialStock?: number;
  /** @deprecated Removed in game update. Kept for backward compatibility. All items can now spawn. */
  canSpawnHere?: boolean;
  restockAt?: number;
  restockMs?: number;
  quantityPerPurchase?: number;
  [key: string]: unknown;
}

export interface ShopCategorySnapshot {
  inventory?: ShopInventoryEntry[];
  purchases?: Record<string, number>;
  nextRestockAt?: number | null;
  restockIntervalMs?: number | null;
  secondsUntilRestock?: number | null;
  [key: string]: unknown;
}

export interface ShopsAtomSnapshot {
  seed?: ShopCategorySnapshot;
  egg?: ShopCategorySnapshot;
  tool?: ShopCategorySnapshot;
  decor?: ShopCategorySnapshot;
  dawn?: ShopCategorySnapshot;
  snow?: ShopCategorySnapshot;
  thunder?: ShopCategorySnapshot;
  [key: string]: ShopCategorySnapshot | undefined;
}

export interface ShopPurchasesAtomSnapshot {
  seed?: { purchases?: Record<string, number> } | null;
  egg?: { purchases?: Record<string, number> } | null;
  tool?: { purchases?: Record<string, number> } | null;
  decor?: { purchases?: Record<string, number> } | null;
  dawn?: { purchases?: Record<string, number> } | null;
  snow?: { purchases?: Record<string, number> } | null;
  thunder?: { purchases?: Record<string, number> } | null;
  [key: string]: { purchases?: Record<string, number> } | null | undefined;
}

// ─── State-tree snapshot types ────────────────────────────────────────────
// Shape of the game's `stateAtom.value`, narrowed to what QPM reads.
// Mirrors `IState<RoomData>` / `IState<QuinoaData>` from the beta bundle's
// store/store.ts (2026-07) but only includes fields QPM depends on. If
// selectors reach into a field not typed here, add it — narrow is intentional.

export interface QuinoaStorageEntry {
  decorId?: string;
  storageId?: string;
  id?: string;
  capacitySlots?: number;
  /** @deprecated Renamed to capacitySlots in pr-2994; kept for older bundles. */
  capacityLevel?: number;
  level?: number;
  items?: QuinoaInventoryItem[];
  [key: string]: unknown;
}

export interface QuinoaInventoryItem {
  id?: string;
  itemType?: string;
  species?: string;
  eggId?: string;
  toolId?: string;
  decorId?: string;
  [key: string]: unknown;
}

export interface QuinoaInventory {
  storages?: QuinoaStorageEntry[];
  items?: QuinoaInventoryItem[];
  favoritedItemIds?: unknown[];
  [key: string]: unknown;
}

export interface QuinoaUserSlotData {
  inventory?: QuinoaInventory;
  shopPurchases?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface QuinoaUserSlot {
  playerId?: string;
  type?: string;
  data?: QuinoaUserSlotData;
  [key: string]: unknown;
}

export interface QuinoaData {
  shops?: ShopsAtomSnapshot;
  weather?: unknown;
  userSlots?: (QuinoaUserSlot | null)[];
  spectators?: string[];
  currentTime?: number;
  [key: string]: unknown;
}

export interface RoomChatSnapshot {
  latestSeq?: number;
  messages?: unknown[];
  playerCosmeticInfos?: Record<string, unknown>;
  lastReadSeqByPlayerId?: Record<string, number>;
  [key: string]: unknown;
}

export interface RoomData {
  players?: PlayerAtomValue[];
  bots?: unknown[];
  hostPlayerId?: string | null;
  chat?: RoomChatSnapshot;
  selectedGame?: string;
  [key: string]: unknown;
}

export interface QuinoaStateSnapshot {
  scope: 'Room' | string;
  data: RoomData;
  child?: {
    scope: 'Quinoa' | string;
    data: QuinoaData;
    child?: unknown;
  } | null;
  [key: string]: unknown;
}
