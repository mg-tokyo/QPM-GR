// Pure ownership-count derivation: canonical keys, inventory key counts, and
// storage-building (Seed Silo / Decor Shed / Tool Shack) key counts. No alert state access.

import { canonicalItemId } from '../../../utils/restock/dataService';
import { getShopEntryIdentity } from '../../../store/shopStockParsers';
import type { InventoryData, InventoryItem } from '../../../store/inventory';
import {
  SEED_SILO_STORAGE_ID,
  DECOR_SHED_STORAGE_ID,
  TOOL_SHACK_STORAGE_ID,
  type RestockShopType,
} from './types';

export function toLowerTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim().toLowerCase();
  return next.length > 0 ? next : null;
}

export function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

export function toNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

export function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function addCount(map: Map<string, number>, key: string, amount: number): void {
  if (amount <= 0 || !Number.isFinite(amount)) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

export function normalizeShopType(rawType: unknown): RestockShopType | null {
  const type = toLowerTrimmed(rawType);
  if (!type) return null;
  if (type === 'seed' || type === 'seeds') return 'seed';
  if (type === 'egg' || type === 'eggs') return 'egg';
  if (type === 'decor' || type === 'decoration' || type === 'decorations') return 'decor';
  if (type === 'tool' || type === 'tools') return 'tool';
  return null;
}

export function toCanonicalKey(shopType: RestockShopType, itemId: string): string {
  const canonicalId = canonicalItemId(shopType, itemId).trim().toLowerCase();
  return `${shopType}:${canonicalId}`;
}

export function getInventoryItemKey(item: InventoryItem): string | null {
  const raw = item.raw && typeof item.raw === 'object' ? item.raw as Record<string, unknown> : null;
  const inferredType =
    normalizeShopType(item.itemType) ??
    normalizeShopType(raw?.itemType) ??
    normalizeShopType(raw?.type);

  const explicitByType = (): string | null => {
    if (inferredType === 'egg') {
      const id = firstString([raw?.eggId, item.itemId, raw?.id]);
      return id ? toCanonicalKey('egg', id) : null;
    }
    if (inferredType === 'tool') {
      // Prefer dedicated type field, then species/name — avoid UUIDs (itemId/raw.id)
      // since the game stores tool identity in species/name, not itemId.
      const id = firstString([raw?.toolId, raw?.species, item.species, raw?.name, item.name]);
      return id ? toCanonicalKey('tool', id) : null;
    }
    if (inferredType === 'decor') {
      const id = firstString([raw?.decorId, item.itemId, raw?.id]);
      return id ? toCanonicalKey('decor', id) : null;
    }
    if (inferredType === 'seed') {
      const id = firstString([item.species, raw?.species, raw?.seedName, item.itemId, raw?.id]);
      return id ? toCanonicalKey('seed', id) : null;
    }
    return null;
  };

  const explicit = explicitByType();
  if (explicit) return explicit;

  const eggId = firstString([raw?.eggId]);
  if (eggId) return toCanonicalKey('egg', eggId);
  const toolId = firstString([raw?.toolId]);
  if (toolId) return toCanonicalKey('tool', toolId);
  const decorId = firstString([raw?.decorId]);
  if (decorId) return toCanonicalKey('decor', decorId);

  const seedId = firstString([item.species, raw?.species, raw?.seedName]);
  if (seedId) return toCanonicalKey('seed', seedId);
  const generic = getShopEntryIdentity(raw);
  return generic ? toCanonicalKey(generic.itemType.toLowerCase(), generic.id) : null;
}

export function buildInventoryKeyCounts(data: InventoryData): Map<string, number> {
  const next = new Map<string, number>();
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    const key = getInventoryItemKey(item);
    if (!key) continue;
    const quantity = toNonNegativeInteger(item.quantity) ?? 1;
    addCount(next, key, Math.max(1, quantity));
  }
  return next;
}

export function buildInventoryKeyItemQuantities(data: InventoryData): Map<string, Map<string, number>> {
  const next = new Map<string, Map<string, number>>();
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    const key = getInventoryItemKey(item);
    if (!key) continue;
    const itemId = toTrimmedString(item.id);
    if (!itemId) continue;
    const quantity = toNonNegativeInteger(item.quantity) ?? 1;
    const bucket = next.get(key) ?? new Map<string, number>();
    bucket.set(itemId, Math.max(1, quantity));
    next.set(key, bucket);
  }
  return next;
}

function isStorageByToken(entry: unknown, storageToken: string): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const row = entry as Record<string, unknown>;
  const fields = [row.storageId, row.decorId, row.id, row.type, row.name];
  const token = storageToken.trim().toLowerCase();
  return fields.some((value) => {
    const normalized = toLowerTrimmed(value);
    if (!normalized) return false;
    const compact = normalized.replace(/\s+/g, '');
    return normalized === token || compact === token || compact.includes(token);
  });
}

function isSeedSiloStorage(entry: unknown): boolean {
  return isStorageByToken(entry, SEED_SILO_STORAGE_ID);
}

function isDecorShedStorage(entry: unknown): boolean {
  return isStorageByToken(entry, DECOR_SHED_STORAGE_ID);
}

function isToolShackStorage(entry: unknown): boolean {
  return isStorageByToken(entry, TOOL_SHACK_STORAGE_ID);
}

function getMyDataStorages(myDataValue: unknown): unknown[] {
  if (!myDataValue || typeof myDataValue !== 'object') return [];
  const inventory = (myDataValue as Record<string, unknown>).inventory;
  if (!inventory || typeof inventory !== 'object') return [];
  const rawStorages = (inventory as Record<string, unknown>).storages;
  return Array.isArray(rawStorages)
    ? rawStorages
    : rawStorages && typeof rawStorages === 'object'
      ? Object.values(rawStorages)
      : [];
}

function buildStorageKeyCounts(myDataValue: unknown, shopType: RestockShopType, predicate: (entry: unknown) => boolean): Map<string, number> {
  const next = new Map<string, number>();
  const store = getMyDataStorages(myDataValue).find((entry) => predicate(entry));
  if (!store || typeof store !== 'object') return next;

  const items = Array.isArray((store as Record<string, unknown>).items)
    ? ((store as Record<string, unknown>).items as unknown[])
    : [];
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const row = rawItem as Record<string, unknown>;
    const itemId =
      shopType === 'seed' ? firstString([row.species, row.seedName, row.itemId, row.id])
      : shopType === 'tool' ? firstString([row.toolId, row.itemId, row.id])
      : firstString([row.decorId, row.itemId, row.id]);
    if (!itemId) continue;
    const quantity = toNonNegativeInteger(row.quantity ?? row.qty ?? row.count ?? row.amount ?? row.stackSize) ?? 1;
    addCount(next, toCanonicalKey(shopType, itemId), Math.max(1, quantity));
  }
  return next;
}

export function buildSeedSiloKeyCounts(myDataValue: unknown): Map<string, number> {
  return buildStorageKeyCounts(myDataValue, 'seed', isSeedSiloStorage);
}

export function buildDecorShedKeyCounts(myDataValue: unknown): Map<string, number> {
  return buildStorageKeyCounts(myDataValue, 'decor', isDecorShedStorage);
}

/** Charged crystals carry no `quantity` (they have `remainingActiveSeconds`) and count as 1, like bag items. */
export function buildToolShackKeyCounts(myDataValue: unknown): Map<string, number> {
  return buildStorageKeyCounts(myDataValue, 'tool', isToolShackStorage);
}
