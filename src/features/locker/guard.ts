// src/features/locker/guard.ts
// Native sendMessage hook + preflight function for the Locker.

import { pageWindow } from '../../core/pageContext';
import { notify } from '../../core/notifications';
import { getInventoryItems, getFavoritedItemIds, type InventoryItem } from '../../store/inventory';
import { getGardenSnapshot } from '../garden/bridge';
import { getSellAllPetsSettings } from '../sellAllPets';
import { getPetMetadata } from '../../data/petMetadata';
import { calculateMaxStrength } from '../../store/xpTracker';
import { getCropMaxScaleSafe } from '../../utils/catalogHelpers';
import { getLockerConfig } from './state';
import { evaluateAction, type InventorySnapshot, type TileContext } from './rules';
import { isRecord } from '../../utils/typeGuards';
import type { GuardResult } from './types';
import { criticalInterval } from '../../utils/timerManager';

// ── Types ──────────────────────────────────────────────────────────────────

interface RoomConnectionLike {
  sendMessage: (payload: unknown) => unknown;
}

interface PageWindowWithRoomConnection extends Window {
  MagicCircle_RoomConnection?: RoomConnectionLike;
}

// ── Notification throttle ──────────────────────────────────────────────────

const NOTIFY_COOLDOWN_MS = 3000;
const lastNotifyAt = new Map<string, number>();

function throttledNotify(rule: string, reason: string): void {
  const now = Date.now();
  const prev = lastNotifyAt.get(rule) ?? 0;
  if (now - prev < NOTIFY_COOLDOWN_MS) return;
  lastNotifyAt.set(rule, now);
  notify({ feature: 'Locker', level: 'warn', message: reason });
}

// ── Inventory snapshot ─────────────────────────────────────────────────────

const GAME_INVENTORY_CAP = 100;

/** Maps V16 PurchaseShopItem itemType → the ID field on the ShopItemTarget. */
const ITEM_TYPE_ID_FIELD: Record<string, string> = {
  Seed:  'species',
  Egg:   'eggId',
  Tool:  'toolId',
  Decor: 'decorId',
};

/**
 * Check whether a purchase will stack into an existing inventory slot rather
 * than consuming a new one.  Seeds/eggs/tools/decor stack when the player
 * already owns items of the same type, so the inventory reserve check should
 * not block them.
 */
function checkPurchaseWillStack(
  items: InventoryItem[],
  actionType: string,
  payload: Record<string, unknown>,
): boolean {
  if (actionType !== 'PurchaseShopItem') return false;

  const itemTarget = payload.item as Record<string, unknown> | undefined;
  if (!itemTarget || typeof itemTarget.itemType !== 'string') return false;

  const field = ITEM_TYPE_ID_FIELD[itemTarget.itemType];
  if (!field) return false;

  const value = itemTarget[field];
  if (typeof value !== 'string' || value.length === 0) return false;

  return items.some((item) => {
    if (!item.raw || typeof item.raw !== 'object') return false;
    return (item.raw as Record<string, unknown>)[field] === value;
  });
}

function getInventorySnapshot(
  actionType?: string,
  payload?: Record<string, unknown>,
): InventorySnapshot {
  const items = getInventoryItems();
  const snapshot: InventorySnapshot = { itemCount: items.length, capacity: GAME_INVENTORY_CAP };
  if (actionType === 'PurchaseShopItem' && payload) {
    snapshot.purchaseWillStack = checkPurchaseWillStack(items, actionType, payload);
  }
  return snapshot;
}

// ── Tile context resolution ────────────────────────────────────────────────

/**
 * Extract mutations from a single grow slot record.
 * Handles both string[] and Record<string, unknown> formats.
 */
function extractSlotMutations(slotRecord: Record<string, unknown>): string[] | undefined {
  const raw = slotRecord.mutations;
  if (!raw) return undefined;

  const collected: string[] = [];
  if (Array.isArray(raw)) {
    for (const m of raw) {
      if (typeof m === 'string' && m.length > 0) collected.push(m);
    }
  } else if (isRecord(raw)) {
    for (const k of Object.keys(raw)) {
      if (k.length > 0) collected.push(k);
    }
  }
  return collected.length > 0 ? collected : undefined;
}

/**
 * Resolve a slot number from a native WS message to tile context.
 *
 * Garden data layout:
 *   tileObjects:          Record<slot, { objectType, eggId?, slots?[{ species, mutations, slotId }] }>
 *   boardwalkTileObjects: Record<slot, { objectType, eggId?, slots?[{ species, mutations, slotId }] }>
 *
 * For HarvestCrop, `slotsIndex` identifies the specific grow slot being
 * harvested (matches GrowSlot.slotId). Mutations are read from that slot
 * so that per-mutation rules apply to the targeted fruit, not slot 0.
 */
function resolveTileContext(slot: unknown, slotsIndex?: unknown): TileContext | undefined {
  if (typeof slot !== 'number' || !Number.isFinite(slot)) return undefined;

  const garden = getGardenSnapshot();
  if (!garden) return undefined;

  const key = String(slot);
  const tile =
    (garden.tileObjects as Record<string, unknown> | undefined)?.[key]
    ?? (garden.boardwalkTileObjects as Record<string, unknown> | undefined)?.[key];

  if (!isRecord(tile)) return undefined;

  const objectType = typeof tile.objectType === 'string' ? tile.objectType : undefined;
  const eggId = typeof tile.eggId === 'string' ? tile.eggId : undefined;

  let species: string | undefined;
  let mutations: string[] | undefined;
  let decorId: string | undefined;

  if (Array.isArray(tile.slots) && tile.slots.length > 0) {
    // Species is the same across all slots on a plant — read from first.
    const firstSlot = tile.slots[0];
    if (isRecord(firstSlot)) {
      const raw = firstSlot.species;
      if (typeof raw === 'string' && raw.length > 0) species = raw;
    }

    // Mutations are per-slot. When slotsIndex is provided (HarvestCrop),
    // resolve from the targeted slot so the guard evaluates the correct fruit.
    let targetSlot: Record<string, unknown> | undefined;
    if (typeof slotsIndex === 'number' && Number.isFinite(slotsIndex)) {
      for (const s of tile.slots) {
        if (isRecord(s) && s.slotId === slotsIndex) {
          targetSlot = s;
          break;
        }
      }
    }
    // Fall back to first slot when no specific slot was requested or found.
    if (!targetSlot && isRecord(firstSlot)) {
      targetSlot = firstSlot;
    }
    if (targetSlot) {
      mutations = extractSlotMutations(targetSlot);
    }
  }

  // Size percent: convert targetScale → 50–100% using species maxScale
  let sizePercent: number | undefined;
  if (species && Array.isArray(tile.slots)) {
    let targetSlotForSize: Record<string, unknown> | undefined;
    if (typeof slotsIndex === 'number' && Number.isFinite(slotsIndex)) {
      for (const s of tile.slots) {
        if (isRecord(s) && s.slotId === slotsIndex) { targetSlotForSize = s; break; }
      }
    }
    if (!targetSlotForSize && tile.slots.length > 0 && isRecord(tile.slots[0])) {
      targetSlotForSize = tile.slots[0] as Record<string, unknown>;
    }
    if (targetSlotForSize) {
      const scale = typeof targetSlotForSize.targetScale === 'number' ? targetSlotForSize.targetScale : null;
      if (scale !== null && Number.isFinite(scale)) {
        const maxScale = getCropMaxScaleSafe(species);
        if (maxScale !== null && maxScale > 1) {
          const clamped = Math.max(1, Math.min(maxScale, scale));
          sizePercent = Math.max(50, Math.min(100, Math.round(50 + ((clamped - 1) / (maxScale - 1)) * 50)));
        }
      }
    }
  }

  // For decor tiles, the objectType itself is the decor ID
  if (objectType && objectType !== 'plant' && objectType !== 'egg') {
    decorId = objectType;
  }

  // Build result without undefined values (exactOptionalPropertyTypes)
  const ctx: TileContext = {};
  if (objectType !== undefined) ctx.objectType = objectType;
  if (species !== undefined) ctx.species = species;
  if (eggId !== undefined) ctx.eggId = eggId;
  if (decorId !== undefined) ctx.decorId = decorId;
  if (mutations !== undefined) ctx.mutations = mutations;
  if (sizePercent !== undefined) ctx.sizePercent = sizePercent;
  return ctx;
}

// ── Pet sell guard ────────────────────────────────────────────────────────

function readPetMutations(raw: unknown): string[] {
  if (!isRecord(raw)) return [];
  const candidates = [raw.mutations, isRecord(raw.pet) ? raw.pet.mutations : undefined];
  const out: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const v of candidate) {
      if (typeof v === 'string' && v.length > 0) out.push(v);
    }
  }
  return out;
}

function readPetTargetScale(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const candidates = [
    raw.targetScale,
    isRecord(raw.pet) ? raw.pet.targetScale : undefined,
    isRecord(raw.pet) ? raw.pet.scale : undefined,
    raw.scale,
  ];
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function readPetStrength(item: InventoryItem): number | null {
  const candidates = [
    item.strength,
    isRecord(item.raw) ? (item.raw as Record<string, unknown>).strength : undefined,
    isRecord(item.raw) && isRecord((item.raw as Record<string, unknown>).pet)
      ? ((item.raw as Record<string, unknown>).pet as Record<string, unknown>).strength
      : undefined,
  ];
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

const PASS: GuardResult = { blocked: false };

function evaluatePetSell(itemId: string): GuardResult {
  const config = getLockerConfig();
  if (!config.petSellGuard) return PASS;

  const protections = getSellAllPetsSettings().protections;
  if (!protections.enabled) return PASS;

  // Safety net: always block selling favorited items
  const favorites = getFavoritedItemIds();
  if (favorites.has(itemId)) {
    return { blocked: true, reason: 'Pet is favorited', rule: 'pet_sell_favorite' };
  }

  const items = getInventoryItems();
  const item = items.find(i => i.id === itemId);
  if (!item) return PASS; // unknown item — allow

  const mutations = readPetMutations(item.raw);
  const mutationsLower = mutations.map(m => m.toLowerCase());

  if (protections.protectGold && mutationsLower.some(m => m.includes('gold'))) {
    return { blocked: true, reason: 'Protected: Gold mutation', rule: 'pet_sell_gold' };
  }
  if (protections.protectRainbow && mutationsLower.some(m => m.includes('rainbow'))) {
    return { blocked: true, reason: 'Protected: Rainbow mutation', rule: 'pet_sell_rainbow' };
  }

  const species = (typeof item.species === 'string' ? item.species : null)
    ?? (isRecord(item.raw) ? (item.raw as Record<string, unknown>).petSpecies : null);
  const speciesStr = typeof species === 'string' ? species : null;

  if (speciesStr) {
    const meta = getPetMetadata(speciesStr);
    if (meta?.rarity) {
      const protectedRarities = new Set(protections.protectedRarities.map(r => r.toLowerCase()));
      if (protectedRarities.has(meta.rarity.toLowerCase())) {
        return { blocked: true, reason: `Protected rarity: ${meta.rarity}`, rule: 'pet_sell_rarity' };
      }
    }
  }

  if (protections.protectMaxStr) {
    const targetScale = readPetTargetScale(item.raw);
    const computedMax = speciesStr ? calculateMaxStrength(targetScale, speciesStr) : null;
    const strength = readPetStrength(item);
    const maxStrength = computedMax ?? strength;
    if (typeof maxStrength === 'number') {
      const threshold = Math.max(0, Math.min(100, Math.round(protections.maxStrThreshold)));
      if (Math.round(maxStrength) >= threshold) {
        return { blocked: true, reason: `Protected: Max STR ${Math.round(maxStrength)}%`, rule: 'pet_sell_max_str' };
      }
    }
  }

  return PASS;
}

// ── Core evaluate helper ───────────────────────────────────────────────────

function evaluate(
  actionType: string,
  payload: Record<string, unknown>,
): GuardResult {
  const config = getLockerConfig();
  if (!config.enabled) return PASS;

  const tile = resolveTileContext(payload.slot, payload.slotsIndex);
  const result = evaluateAction(actionType, payload, config, getInventorySnapshot(actionType, payload), tile);
  if (result.blocked) return result;

  // Pet sell protection: evaluated at the guard layer because it needs store access
  if (actionType === 'SellPet' && typeof payload.itemId === 'string') {
    return evaluatePetSell(payload.itemId);
  }

  return result;
}

// ── Preflight (for sendRoomAction) ─────────────────────────────────────────

export function lockerPreflight(
  type: string,
  payload: Record<string, unknown>,
): { ok: boolean; reason?: string } {
  const result = evaluate(type, payload);
  if (!result.blocked) return { ok: true };

  if (result.rule && result.reason) {
    throttledNotify(result.rule, result.reason);
  }
  return result.reason != null ? { ok: false, reason: result.reason } : { ok: false };
}

// ── Native sendMessage hook ────────────────────────────────────────────────

const RECONNECT_POLL_MS = 2000;
let patchedConnection: RoomConnectionLike | null = null;
let originalSendMessage: ((payload: unknown) => unknown) | null = null;
let stopReconnectTimer: (() => void) | null = null;

function restoreNativePatch(): void {
  if (!patchedConnection || !originalSendMessage) return;
  try {
    patchedConnection.sendMessage = originalSendMessage;
  } catch { /* noop */ }
  patchedConnection = null;
  originalSendMessage = null;
}

function ensureNativeHookPatched(): void {
  const room = (pageWindow as PageWindowWithRoomConnection).MagicCircle_RoomConnection;
  if (!room || typeof room.sendMessage !== 'function') return;
  if (patchedConnection === room) return;

  restoreNativePatch();

  const original = room.sendMessage.bind(room);
  const wrapped = (payload: unknown): unknown => {
    if (payload && typeof payload === 'object') {
      const rec = payload as Record<string, unknown>;
      const actionType = typeof rec.type === 'string' ? rec.type : null;
      if (actionType) {
        const result = evaluate(actionType, rec);
        if (result.blocked) {
          if (result.rule && result.reason) {
            throttledNotify(result.rule, result.reason);
          }
          return undefined;
        }
      }
    }
    return original(payload);
  };

  try {
    room.sendMessage = wrapped;
    patchedConnection = room;
    originalSendMessage = original;
  } catch {
    patchedConnection = null;
    originalSendMessage = null;
  }
}

// ── Public lifecycle ───────────────────────────────────────────────────────

export function startNativeHook(): void {
  ensureNativeHookPatched();
  if (stopReconnectTimer) return;
  stopReconnectTimer = criticalInterval('locker-reconnect', ensureNativeHookPatched, RECONNECT_POLL_MS);
}

export function stopNativeHook(): void {
  if (stopReconnectTimer) {
    stopReconnectTimer();
    stopReconnectTimer = null;
  }
  restoreNativePatch();
  lastNotifyAt.clear();
}
