// src/websocket/validation.ts
// Payload type declarations + primitive validators used by api.ts's
// validatePayload / getThrottleKey. Extracted verbatim from api.ts (2026-08-28)
// to keep it under the file-size limit; the switch bodies stay in api.ts
// because the QPM FULL PRIVATE overlay anchors on them.

export type PlacePetPayload = {
  itemId: string;
  position: { x: number; y: number };
  tileType: string;
  localTileIndex: number;
};

export type PlayerPositionPayload = {
  position: { x: number; y: number };
};

export type RetrievePayload = { itemId: string; storageId: string; toInventoryIndex?: number; quantity?: number };
export type PutInStoragePayload = { itemId: string; storageId: string; toStorageIndex?: number; quantity?: number };
export type PickupPetPayload = { petId: string };
export type SwapPayload = { petSlotId: string; petInventoryId: string };
export type SwapFromStoragePayload = { petSlotId: string; storagePetId: string; storageId: string };
export type PetTeamEmblemPayload =
  | { type: 'number'; number: number }
  | { type: 'pet'; petSpecies: string }
  | { type: 'icon'; icon: string };
export type SavePetTeamPayload = { teamId: string | null; name: string; petIds: string[] };
export type MovePetTeamPayload = { movePetTeamId: string; toPetTeamIndex: number };
export type SetPetTeamEmblemPayload = { teamId: string; emblem: PetTeamEmblemPayload };

export const PET_TEAM_ICON_IDS = new Set([
  'rainbow', 'gold', 'thunder', 'dawn', 'amber', 'wet', 'chilled', 'frozen', 'coin', 'egg',
]);

/** V16 unified shop purchase payload. itemType values: 'Seed'|'Egg'|'Tool'|'Decor'. */
export type PurchaseShopItemPayload = {
  shop: string;
  item: { itemType: string } & Record<string, unknown>;
};

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
