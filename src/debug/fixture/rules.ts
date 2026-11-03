import type { GuardVerdict } from '../../websocket/sendGuard';
import { isRecord } from '../../utils/typeGuards';
import { resolveAllowed, type AllowedKind } from './allowlist';
import type { FixtureConfig, LedgerSlot } from './types';

export type LiveView = {
  coins: number;
  stackQty(kind: AllowedKind, id: string): number;
  slotEmpty(slot: string): boolean;              // live garden
  cropSpecies(itemId: string): string | null;    // live crop inventory
  isPetItem(itemId: string): boolean;            // pet in inventory, hutch or an active slot
};

export type SessionState = {
  runId: string;
  config: FixtureConfig;
  spendCap: number;
  spent: number;
  used: { seeds: number; eggs: number };
  occupiedAtBegin: ReadonlySet<string>;
  ownedSlots: ReadonlySet<string>;
  ownedPetIds: ReadonlySet<string>;
  ownedItemIds: ReadonlySet<string>;
};

export type JudgementEffects = {
  spend?: number;
  useSeed?: true;
  useEgg?: true;
  ownSlot?: LedgerSlot;
  ownItemId?: string;
  expectHatchAt?: string;
};
export type Judgement = GuardVerdict & { effects?: JudgementEffects };

// literal-list-justified: wire protocol table. Non-mutating client types from the live bundle's
// schema union (QuinoaCanvas chunk) plus sendRoomMessage telemetry; anything ambiguous stays out.
// PickupObject/DropObject carry only `type`: the hold animation the game sends on every item select/deselect.
export const BACKGROUND_TYPES: ReadonlySet<string> = new Set([
  'PlayerPosition', 'Teleport', 'RequestPetGreet', 'SetPlayerInteraction', 'TramBoarding', 'TramArrival',
  'CheckWeatherStatus', 'SetSelectedItem', 'ClientLoadReport', 'ClientPageRecords', 'PickupObject', 'DropObject',
]);

// literal-list-justified: wire protocol table of types refused outright (destructive, irreversible,
// or outside the allowed action families); everything unlisted falls to `unknown-type`.
const FORBIDDEN_TYPES: ReadonlySet<string> = new Set([
  'SellAllCrops', 'ToggleLockItem', 'XPPotion', 'ReplenishPotion', 'MutationPotion', 'WaterPlant', 'PlantGardenPlant',
  'PotPlant', 'Preserve', 'CropCleanser', 'PlaceDecor', 'PickupDecor', 'PlaceEdgeDecor', 'PickupEdgeDecor',
  'RemoveGardenEdgeObject', 'PickupCrystal', 'PlaceCrystal', 'DisplayCrop', 'PickupDisplayedCrop', 'SetPlayerData',
  'EquipPetCosmetic', 'UpgradePetHutch', 'UpgradeSeedSilo', 'UpgradeDecorShed', 'UpgradeToolShack', 'CheckFriendBonus',
  'Wish', 'SavePetTeam', 'DeletePetTeam', 'MovePetTeam', 'ApplyPetTeam', 'SetPetTeamEmblem', 'Chat', 'Emote',
  'DawnCapture', 'AmberCapture', 'Thundercharge', 'OpenDawnCapsule', 'OpenAllDawnCapsules', 'OpenAmberCapsule',
  'OpenAllAmberCapsules',
]);

// literal-list-justified: wire protocol table; the user allowed moving pets between slots and storage.
const PET_MOVE_TYPES: ReadonlySet<string> = new Set([
  'PlacePet', 'PickupPet', 'SwapPet', 'SwapPetFromStorage', 'RidePet', 'DismountPet',
]);

// RemoveGardenObject indexes the tile array named by slotType; only dirt indexes match the ledger.
const DIRT_SLOT_TYPE = 'Dirt';

const ALLOW: Judgement = { allow: true };
const refuse = (reason: string): Judgement => ({ allow: false, reason });

/** number | numeric string → String(n); the wire sends numbers, tileObjects keys are strings. */
export function slotKey(v: unknown): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? String(n) : null;
}

function floorFor(config: FixtureConfig, kind: AllowedKind, id: string): number {
  const floor = config.reserveFloors[`${kind}:${id}`];
  return typeof floor === 'number' && Number.isFinite(floor) ? floor : 0;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function judgePurchase(payload: Record<string, unknown>, s: SessionState, live: LiveView): Judgement {
  const item = payload.item;
  if (!isRecord(item)) return refuse('bad-payload');
  const quantity = payload.quantity === undefined ? 1 : payload.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) return refuse('bad-payload');
  const kind: AllowedKind | null = item.itemType === 'Seed' ? 'seed' : item.itemType === 'Egg' ? 'egg' : null;
  const id = kind === 'seed' ? str(item.species) : kind === 'egg' ? str(item.eggId) : null;
  const allowed = kind && id ? resolveAllowed(kind, id, s.config.allowRarity) : null;
  if (!kind || !id || !allowed || allowed.coinPrice === null) return refuse('not-allowlisted');
  if (kind === 'egg') {
    if (!s.config.buyEggsAtOrBelowFloor) return refuse('egg-buying-off');
    if (live.stackQty('egg', id) > floorFor(s.config, 'egg', id)) return refuse('egg-above-floor');
  }
  const price = allowed.coinPrice * quantity;
  if (s.spent + price > s.spendCap) return refuse('spend-cap');
  if (live.coins - price < s.config.coinFloor) return refuse('coin-floor');
  return { allow: true, effects: { spend: price } };
}

function judgePlace(kind: 'seed' | 'egg', payload: Record<string, unknown>, s: SessionState, live: LiveView): Judgement {
  const slot = slotKey(payload.slot);
  const id = str(kind === 'seed' ? payload.species : payload.eggId);
  if (slot === null || id === null) return refuse('bad-payload');
  if (!resolveAllowed(kind, id, s.config.allowRarity)) return refuse('not-allowlisted');
  const used = kind === 'seed' ? s.used.seeds : s.used.eggs;
  if (used >= (kind === 'seed' ? s.config.useCaps.seeds : s.config.useCaps.eggs)) return refuse('use-cap');
  if (s.occupiedAtBegin.has(slot) || !live.slotEmpty(slot)) return refuse('slot-protected');
  if (live.stackQty(kind, id) - 1 < floorFor(s.config, kind, id)) return refuse('below-floor');
  const ownSlot: LedgerSlot = { slot, kind: kind === 'seed' ? 'plant' : 'egg', id, runId: s.runId };
  return { allow: true, effects: kind === 'seed' ? { useSeed: true, ownSlot } : { useEgg: true, ownSlot } };
}

function judgeFeed(payload: Record<string, unknown>, s: SessionState, live: LiveView): Judgement {
  const cropItemId = str(payload.cropItemId);
  if (!cropItemId || !str(payload.petItemId)) return refuse('bad-payload');
  if (s.ownedItemIds.has(cropItemId)) return ALLOW;
  const species = live.cropSpecies(cropItemId);
  if (!species || !resolveAllowed('crop', species, s.config.allowRarity)) return refuse('crop-protected');
  if (live.stackQty('crop', species) - 1 < floorFor(s.config, 'crop', species)) return refuse('crop-protected');
  return ALLOW;
}

function ownedSlotOf(payload: Record<string, unknown>, s: SessionState): string | null {
  const slot = slotKey(payload.slot);
  return slot !== null && s.ownedSlots.has(slot) ? slot : null;
}

/** Pure: never mutates `s`; the session applies `effects` after an allow. */
export function judgeSend(type: string, payload: Record<string, unknown>, s: SessionState, live: LiveView): Judgement {
  if (BACKGROUND_TYPES.has(type)) return ALLOW;
  if (FORBIDDEN_TYPES.has(type)) return refuse('forbidden');
  if (PET_MOVE_TYPES.has(type)) return ALLOW;
  switch (type) {
    case 'PurchaseShopItem':
      return judgePurchase(payload, s, live);
    case 'PlantSeed':
      return judgePlace('seed', payload, s, live);
    case 'GrowEgg':
      return judgePlace('egg', payload, s, live);
    case 'HarvestCrop': {
      if (!ownedSlotOf(payload, s)) return refuse('slot-protected');
      const cropItemId = str(payload.cropItemId);
      return cropItemId ? { allow: true, effects: { ownItemId: cropItemId } } : ALLOW;
    }
    case 'HatchEgg': {
      const slot = ownedSlotOf(payload, s);
      return slot ? { allow: true, effects: { expectHatchAt: slot } } : refuse('slot-protected');
    }
    case 'RemoveGardenObject':
      return payload.slotType === DIRT_SLOT_TYPE && ownedSlotOf(payload, s) ? ALLOW : refuse('slot-protected');
    case 'FeedPet':
      return judgeFeed(payload, s, live);
    case 'MoveItem': {
      const itemId = str(payload.itemId);
      if (!itemId) return refuse('bad-payload');
      const ok = s.ownedItemIds.has(itemId) || s.ownedPetIds.has(itemId) || live.isPetItem(itemId);
      return ok ? ALLOW : refuse('item-protected');
    }
    case 'SellPet':
      return s.ownedPetIds.has(str(payload.itemId) ?? '') ? ALLOW : refuse('pet-protected');
    case 'NamePet':
      return s.ownedPetIds.has(str(payload.petItemId) ?? '') ? ALLOW : refuse('pet-protected');
    default:
      return refuse('unknown-type');
  }
}
