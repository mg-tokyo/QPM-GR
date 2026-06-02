// src/store/petTeams/applyHelpers.ts
// Snapshot reads, polling, ID normalization, and helpers for the apply engine.

import { log } from '../../utils/logger';
import { delay } from '../../utils/scheduling';
import { getActivePetInfos } from '../pets';
import { getAtomByLabel, readAtomValue } from '../../core/jotaiBridge';
import { DEFAULT_HUTCH_CAPACITY } from '../hutch';
import type { InventorySnapshot, HutchSnapshot } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INVENTORY_ATOM_LABEL = 'myInventoryAtom';
export const HUTCH_ATOM_LABEL = 'myPetHutchPetItemsAtom';
export const PET_HUTCH_STORAGE_ID = 'PetHutch';
export const HUTCH_RETRIEVE_TIMEOUT_MS = 3500;
export const STORE_TIMEOUT_MS = 3000;
export const PLACE_TIMEOUT_MS = 3000;
export const POLL_INTERVAL_MS = 100;
export const APPLY_STEP_DELAY_MS = 120;
export const FAST_PATH_SETTLE_TIMEOUT_MS = 1200;
export const FAST_SETTLE_POLL_INTERVAL_MS = 50;
export const REPAIR_SETTLE_TIMEOUT_MS = 1200;
/** Delay between fast-path phases (retrieve → swap → store) to let the game
 *  settle each batch of state updates before the next batch arrives.
 *  Without this gap the game's frozen-state reducer can throw
 *  "Cannot assign to read only property 'updatedAt'" on rapid updates. */
export const FAST_PATH_PHASE_GAP_MS = 100;

// ---------------------------------------------------------------------------
// ID normalization
// ---------------------------------------------------------------------------

export function normalizeId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inventory item extraction
// ---------------------------------------------------------------------------

export function extractInventoryItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return record.items;
    }
  }
  return [];
}

export function extractCandidateIds(entry: Record<string, unknown>): string[] {
  const nestedPet = entry.pet && typeof entry.pet === 'object'
    ? (entry.pet as Record<string, unknown>)
    : null;
  const nestedRaw = entry.raw && typeof entry.raw === 'object'
    ? (entry.raw as Record<string, unknown>)
    : null;

  const candidates = [
    normalizeId(entry.id),
    normalizeId(entry.itemId),
    normalizeId(entry.petId),
    normalizeId(entry.slotId),
    normalizeId(nestedPet?.id),
    normalizeId(nestedPet?.itemId),
    normalizeId(nestedPet?.petId),
    normalizeId(nestedRaw?.id),
    normalizeId(nestedRaw?.itemId),
    normalizeId(nestedRaw?.petId),
  ];

  return candidates.filter((value): value is string => Boolean(value));
}

export function extractPrimaryItemId(entry: Record<string, unknown>): string | null {
  return (
    normalizeId(entry.id) ??
    normalizeId(entry.itemId) ??
    extractCandidateIds(entry)[0] ??
    null
  );
}

export function isLikelyPetInventoryEntry(entry: Record<string, unknown>): boolean {
  const itemType = String(entry.itemType ?? '').trim().toLowerCase();
  if (itemType === 'pet') {
    return true;
  }
  if (normalizeId(entry.petId)) {
    return true;
  }
  const nestedPet = entry.pet && typeof entry.pet === 'object'
    ? (entry.pet as Record<string, unknown>)
    : null;
  if (normalizeId(nestedPet?.id) || normalizeId(nestedPet?.petId)) {
    return true;
  }
  return Array.isArray(entry.abilities);
}

// ---------------------------------------------------------------------------
// Active slot reads
// ---------------------------------------------------------------------------

export function getActiveSlotIds(): string[] {
  return getActivePetInfos()
    .map((pet) => normalizeId(pet.slotId))
    .filter((id): id is string => Boolean(id));
}

// ---------------------------------------------------------------------------
// Snapshot reads
// ---------------------------------------------------------------------------

export async function readInventorySnapshot(): Promise<InventorySnapshot> {
  const ids = new Set<string>();
  const petIds: string[] = [];
  const atom = getAtomByLabel(INVENTORY_ATOM_LABEL);
  if (!atom) {
    return { ids, petIds, freeIndex: null, totalCount: 0 };
  }

  try {
    const raw = await readAtomValue(atom);
    const items = extractInventoryItems(raw);
    let firstFreeIndex: number | null = null;
    let totalCount = 0;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!item) {
        if (firstFreeIndex == null) {
          firstFreeIndex = idx;
        }
        continue;
      }
      totalCount++;
      if (typeof item !== 'object') {
        continue;
      }

      const record = item as Record<string, unknown>;
      extractCandidateIds(record).forEach((id) => ids.add(id));

      if (isLikelyPetInventoryEntry(record)) {
        const petItemId = extractPrimaryItemId(record);
        if (petItemId) {
          petIds.push(petItemId);
        }
      }
    }

    const freeIndex = firstFreeIndex ?? items.length;
    return { ids, petIds, freeIndex, totalCount };
  } catch (error) {
    log('[petTeams] inventory snapshot read failed', error);
    return { ids, petIds, freeIndex: null, totalCount: 0 };
  }
}

export async function readHutchSnapshot(resolvedCapacity?: number | null): Promise<HutchSnapshot> {
  const ids = new Set<string>();
  const atom = getAtomByLabel(HUTCH_ATOM_LABEL);
  if (!atom) {
    return { ids, count: 0, hutchMax: resolvedCapacity ?? DEFAULT_HUTCH_CAPACITY, freeIndex: 0 };
  }

  try {
    const raw = await readAtomValue(atom);
    const items = Array.isArray(raw) ? raw : [];
    const usedStorageIndexes = new Set<number>();
    let hasStorageIndexes = false;
    let occupied = 0;
    let firstArrayHole: number | null = null;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!item) {
        if (firstArrayHole == null) {
          firstArrayHole = idx;
        }
        continue;
      }
      occupied++;
      if (typeof item !== 'object') {
        continue;
      }

      const record = item as Record<string, unknown>;
      const id = extractPrimaryItemId(record);
      if (id) {
        ids.add(id);
      }

      const storageIndex = Number(record.storageIndex);
      if (Number.isFinite(storageIndex) && storageIndex >= 0) {
        hasStorageIndexes = true;
        usedStorageIndexes.add(Math.floor(storageIndex));
      }
    }

    // Use resolved capacity if available, otherwise fall back to heuristic
    const effectiveMax = resolvedCapacity ?? Math.max(items.length, occupied, DEFAULT_HUTCH_CAPACITY);

    let freeIndex: number | null = null;
    if (hasStorageIndexes) {
      for (let idx = 0; idx < effectiveMax; idx++) {
        if (!usedStorageIndexes.has(idx)) {
          freeIndex = idx;
          break;
        }
      }
    } else if (firstArrayHole != null) {
      freeIndex = firstArrayHole < effectiveMax ? firstArrayHole : null;
    } else if (occupied < effectiveMax) {
      freeIndex = occupied;
    }

    return { ids, count: occupied, hutchMax: effectiveMax, freeIndex };
  } catch (error) {
    log('[petTeams] hutch snapshot read failed', error);
    return { ids, count: 0, hutchMax: resolvedCapacity ?? DEFAULT_HUTCH_CAPACITY, freeIndex: null };
  }
}

export async function readInventoryIdSet(): Promise<Set<string>> {
  const result = new Set<string>();
  const snapshot = await readInventorySnapshot();
  snapshot.ids.forEach((id) => result.add(id));
  return result;
}

// ---------------------------------------------------------------------------
// Polling waits
// ---------------------------------------------------------------------------

export async function waitForInventoryContains(itemId: string, timeoutMs: number): Promise<boolean> {
  const expected = normalizeId(itemId);
  if (!expected) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const inventoryIds = await readInventoryIdSet();
    if (inventoryIds.has(expected)) {
      return true;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

export async function waitForHutchContains(itemId: string, timeoutMs: number): Promise<boolean> {
  const expected = normalizeId(itemId);
  if (!expected) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const hutch = await readHutchSnapshot();
    if (hutch.ids.has(expected)) {
      return true;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

export async function waitForPetInActiveList(itemId: string, timeoutMs: number): Promise<boolean> {
  const expected = normalizeId(itemId);
  if (!expected) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const active = getActivePetInfos();
    const found = active.some(
      (pet) =>
        normalizeId(pet.slotId) === expected ||
        normalizeId(pet.petId) === expected,
    );
    if (found) {
      return true;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

export async function waitForPetNotActive(itemId: string, timeoutMs: number): Promise<boolean> {
  const expected = normalizeId(itemId);
  if (!expected) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const active = getActivePetInfos();
    const found = active.some(
      (pet) =>
        normalizeId(pet.slotId) === expected ||
        normalizeId(pet.petId) === expected,
    );
    if (!found) {
      return true;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

export function isActiveTeamMatch(targetIds: string[]): boolean {
  if (!targetIds.length) {
    return false;
  }
  const active = getActiveSlotIds();
  const activeSet = new Set(active);
  if (!targetIds.every((id) => activeSet.has(id))) {
    return false;
  }
  return active.length <= targetIds.length;
}

export async function waitForActiveTeamMatch(
  targetIds: string[],
  timeoutMs: number,
  pollIntervalMs = POLL_INTERVAL_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (isActiveTeamMatch(targetIds)) {
      return true;
    }
    await delay(pollIntervalMs);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pet location
// ---------------------------------------------------------------------------

/**
 * Locate a pet across all known locations.
 * Returns 'active' | 'inventory' | 'hutch' | null.
 */
export async function locatePet(petId: string): Promise<'active' | 'inventory' | 'hutch' | null> {
  const activeIds = new Set(getActiveSlotIds());
  if (activeIds.has(petId)) return 'active';

  const inventory = await readInventorySnapshot();
  if (inventory.ids.has(petId)) return 'inventory';

  const hutch = await readHutchSnapshot();
  if (hutch.ids.has(petId)) return 'hutch';

  return null;
}
