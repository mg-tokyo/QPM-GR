// Shared state-tree projections.
// Contract: return undefined when the path cannot be answered, null when the
// game value is null. Never throw on shape drift.
import type {
  QuinoaInventory, QuinoaInventoryItem, QuinoaStateSnapshot, QuinoaStorageEntry, QuinoaUserSlot, QuinoaUserSlotData,
} from '../../../types/gameAtoms';
import type { IdentityContext, Selected } from '../types';

export type StorageId = 'PetHutch' | 'DecorShed' | 'SeedSilo' | 'FeedingTrough' | 'ToolShack';

export function selectMySlot(state: QuinoaStateSnapshot, id: IdentityContext): Selected<QuinoaUserSlot> {
  if (id.myIdx === null) return undefined;
  const slots = state.child?.data?.userSlots;
  if (!Array.isArray(slots)) return undefined;
  const slot = slots[id.myIdx];
  if (!slot || typeof slot !== 'object') return undefined;
  return slot;
}

export function selectMyData(state: QuinoaStateSnapshot, id: IdentityContext): Selected<QuinoaUserSlotData> {
  const slot = selectMySlot(state, id);
  if (!slot) return undefined;
  const data = slot.data;
  if (!data || typeof data !== 'object') return undefined;
  return data;
}

export function selectInventory(state: QuinoaStateSnapshot, id: IdentityContext): Selected<QuinoaInventory> {
  const data = selectMyData(state, id);
  if (!data) return undefined;
  const inv = data.inventory;
  if (!inv || typeof inv !== 'object') return undefined;
  return inv;
}

export function selectItems(state: QuinoaStateSnapshot, id: IdentityContext): Selected<QuinoaInventoryItem[]> {
  const inv = selectInventory(state, id);
  if (!inv) return undefined;
  return Array.isArray(inv.items) ? inv.items : undefined;
}

export function selectItemsOfType(type: string) {
  return (state: QuinoaStateSnapshot, id: IdentityContext): Selected<QuinoaInventoryItem[]> => {
    const items = selectItems(state, id);
    if (!items) return undefined;
    return items.filter((i) => !!i && typeof i === 'object' && i.itemType === type);
  };
}

export function selectStorage(storageId: StorageId) {
  return (state: QuinoaStateSnapshot, id: IdentityContext): Selected<QuinoaStorageEntry | null> => {
    const inv = selectInventory(state, id);
    if (!inv) return undefined;
    const storages = inv.storages;
    if (!Array.isArray(storages)) return undefined;
    // storageId / id are accepted for older bundles (matches store/hutch.ts:109-111).
    const entry = storages.find((s) => !!s && (s.decorId === storageId || s.storageId === storageId || s.id === storageId));
    return entry ?? null;
  };
}

/** Items of a storage, optionally filtered by itemType. Null storage => []. */
export function selectStorageItems(storageId: StorageId, itemType?: string) {
  const pick = selectStorage(storageId);
  return (state: QuinoaStateSnapshot, id: IdentityContext): Selected<QuinoaInventoryItem[]> => {
    const entry = pick(state, id);
    if (entry === undefined) return undefined;
    const items = entry && Array.isArray(entry.items) ? entry.items : [];
    return itemType === undefined
      ? items.filter((i) => !!i && typeof i === 'object')
      : items.filter((i) => !!i && typeof i === 'object' && i.itemType === itemType);
  };
}

/** capacitySlots (or legacy capacityLevel); null when the storage is absent. */
export function selectStorageCapacity(storageId: StorageId) {
  const pick = selectStorage(storageId);
  return (state: QuinoaStateSnapshot, id: IdentityContext): Selected<number | null> => {
    const entry = pick(state, id);
    if (entry === undefined) return undefined;
    if (entry === null) return null;
    const raw = entry.capacitySlots ?? entry.capacityLevel;
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
  };
}
