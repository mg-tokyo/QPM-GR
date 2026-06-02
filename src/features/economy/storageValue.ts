// src/features/storageValue.ts
// Storage Value feature — pure computation layer (no DOM)
// Computes total sell/shop value of items in Seed Silo, Pet Hutch, Decor Shed, and Inventory

import { subscribeAtomValue } from '../../core/atomRegistry';
import { getFriendBonusMultiplier } from '../../store/friendBonus';
import { getInventoryItems, onInventoryChange } from '../../store/inventory';
import { getActivePetInfos } from '../../store/pets';
import type { GardenSnapshot } from '../garden/bridge';
import {
  getSeedPrice,
  getPlantSpecies,
  getPetSpecies,
  getPetMaxScale,
  getPetHoursToMature,
  getDecor,
  getEggType,
  getItemPrice,
  areCatalogsReady,
  onCatalogsReady,
} from '../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../utils/game/cropMultipliers';
import { debounceCancelable } from '../../utils/scheduling/debounce';
import { storage } from '../../utils/storage';
import { createLogger } from '../../utils/logger';
import { criticalInterval, timerManager } from '../../utils/scheduling/timerManager';

const log = createLogger('QPM:StorageValue');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp non-finite catalog prices (Infinity for dust-only items, NaN) to 0. */
function finiteOr0(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_CONFIG_KEY = 'qpm.storageValue.v1';
const MODAL_RETRY_TIMER_ID = 'storageValue:modalAtomRetry';
const MODAL_RETRY_MAX = 30;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface StorageValueConfig {
  seedSilo: boolean;
  petHutch: boolean;
  decorShed: boolean;
  inventory: boolean;
}

const DEFAULT_CONFIG: StorageValueConfig = {
  seedSilo: true,
  petHutch: true,
  decorShed: true,
  inventory: true,
};

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type StorageValueStatus = 'ready' | 'loading' | 'hidden';

export interface StorageValueState {
  activeModal: string | null;
  value: number;
  status: StorageValueStatus;
}

// ---------------------------------------------------------------------------
// Target modals and storage mapping
// ---------------------------------------------------------------------------

const TARGET_MODALS = new Set(['seedSilo', 'petHutch', 'decorShed', 'inventory']);

const MODAL_TO_STORAGE_DECORID: Record<string, string> = {
  seedSilo: 'SeedSilo',
  petHutch: 'PetHutch',
  decorShed: 'DecorShed',
};

// ---------------------------------------------------------------------------
// Pet scale formula (exact game logic from pets.ts)
// ---------------------------------------------------------------------------

export function computeGamePetScale(
  xp: number,
  targetScale: number,
  maxScale: number,
  hoursToMature: number,
): number {
  const BASE_TARGET_STRENGTH = 80;
  const MAX_TARGET_STRENGTH = 100;
  const STRENGTH_BIRTH_TO_MATURITY = 30;
  const XP_PER_HOUR = 3600;

  let targetStrength: number;
  if (targetScale <= 1) {
    targetStrength = BASE_TARGET_STRENGTH;
  } else if (targetScale >= maxScale) {
    targetStrength = MAX_TARGET_STRENGTH;
  } else {
    const scaleProgress = (targetScale - 1) / (maxScale - 1);
    targetStrength = Math.floor(
      BASE_TARGET_STRENGTH + (MAX_TARGET_STRENGTH - BASE_TARGET_STRENGTH) * scaleProgress,
    );
  }

  const startingStrength = targetStrength - STRENGTH_BIRTH_TO_MATURITY;
  const hoursGrown = xp / XP_PER_HOUR;
  const strengthGainedPerHour = STRENGTH_BIRTH_TO_MATURITY / hoursToMature;
  const strengthGained = Math.min(strengthGainedPerHour * hoursGrown, STRENGTH_BIRTH_TO_MATURITY);
  const currentStrength = Math.floor(startingStrength + strengthGained);

  const progress = targetStrength > 0 ? currentStrength / targetStrength : 1;
  return progress * targetScale;
}

// ---------------------------------------------------------------------------
// Value computations
// ---------------------------------------------------------------------------

export function computePetSellPrice(pet: Record<string, unknown>, friendBonus = 1): number {
  const species = ((pet.petSpecies ?? pet.species) as string | undefined) ?? '';
  if (!species) return 0;

  const entry = getPetSpecies(species) as Record<string, unknown> | null;
  if (!entry) return 0;

  const maturitySellPrice = Number.isFinite(entry.maturitySellPrice) ? (entry.maturitySellPrice as number) : 0;
  if (!maturitySellPrice) return 0;

  const xp = Number.isFinite(pet.xp) ? (pet.xp as number) : 0;
  const targetScale = Number.isFinite(pet.targetScale) ? (pet.targetScale as number) : 1;
  const maxScale = getPetMaxScale(species) ?? 2;
  const hoursToMature = Math.max(getPetHoursToMature(species) ?? 12, 0.001);
  const scale = computeGamePetScale(xp, targetScale, maxScale, hoursToMature);
  const mutations = Array.isArray(pet.mutations) ? (pet.mutations as string[]) : [];
  const { totalMultiplier } = computeMutationMultiplier(mutations);

  // Two-step rounding to match game (sell.ts:21-29):
  // base price rounded first, then friend bonus applied and rounded again
  const basePrice = Math.round(maturitySellPrice * scale * totalMultiplier);
  return Math.round(basePrice * friendBonus);
}

export function computeStorageItemsValue(items: unknown[], friendBonus = 1): number {
  let total = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;

    const quantity =
      typeof raw.quantity === 'number' ? raw.quantity :
      typeof raw.qty === 'number' ? raw.qty :
      typeof raw.count === 'number' ? raw.count : 1;

    const itemType = typeof raw.itemType === 'string' ? raw.itemType.toLowerCase() : '';

    if (itemType === 'pet' || 'petSpecies' in raw) {
      total += computePetSellPrice(raw, friendBonus);
    } else if (itemType === 'produce') {
      const species = typeof raw.species === 'string' ? raw.species : '';
      if (species) {
        const plantEntry = getPlantSpecies(species) as Record<string, unknown> | null;
        const cropEntry = plantEntry?.crop as Record<string, unknown> | undefined;
        const baseSellPrice = typeof cropEntry?.baseSellPrice === 'number' ? cropEntry.baseSellPrice : 0;
        if (baseSellPrice > 0) {
          const scale =
            typeof raw.scale === 'number' ? raw.scale :
            typeof raw.targetScale === 'number' ? raw.targetScale : 1;
          const mutations = Array.isArray(raw.mutations) ? (raw.mutations as string[]) : [];
          const { totalMultiplier } = computeMutationMultiplier(mutations);
          const basePrice = Math.round(baseSellPrice * scale * totalMultiplier);
          total += Math.round(basePrice * friendBonus) * quantity;
        }
      }
    } else if (raw.decorId && typeof raw.decorId === 'string') {
      const entry = getDecor(raw.decorId);
      total += finiteOr0(entry?.coinPrice) * quantity;
    } else {
      // Seeds (silo items): try species or seedName
      const species =
        (typeof raw.species === 'string' ? raw.species : null) ??
        (typeof raw.seedName === 'string' ? raw.seedName : null) ??
        (typeof raw.crop === 'string' ? raw.crop : null);
      if (species) {
        const price = getSeedPrice(species);
        total += (price?.coins ?? 0) * quantity;
      }
    }
  }
  return total;
}

export function computeInventoryValue(friendBonus = 1): number {
  const items = getInventoryItems();
  let total = 0;

  for (const item of items) {
    const raw = item.raw as Record<string, unknown>;
    const quantity = item.quantity ?? 1;
    const itemType = (
      (item.itemType as string | null) ??
      (raw.itemType as string | undefined) ??
      ''
    ).toLowerCase();

    if (itemType === 'pet' || 'petSpecies' in raw) {
      total += computePetSellPrice(raw, friendBonus);
    } else if (itemType === 'produce') {
      const species = (
        (item.species as string | null) ??
        (raw.species as string | undefined) ??
        ''
      );
      if (species) {
        const plantEntry = getPlantSpecies(species) as Record<string, unknown> | null;
        const cropEntry = plantEntry?.crop as Record<string, unknown> | undefined;
        const baseSellPrice = typeof cropEntry?.baseSellPrice === 'number' ? cropEntry.baseSellPrice : 0;
        if (baseSellPrice > 0) {
          const scale =
            typeof raw.scale === 'number' ? raw.scale :
            typeof raw.targetScale === 'number' ? raw.targetScale : 1;
          const mutations = Array.isArray(raw.mutations) ? (raw.mutations as string[]) : [];
          const { totalMultiplier } = computeMutationMultiplier(mutations);
          const basePrice = Math.round(baseSellPrice * scale * totalMultiplier);
          total += Math.round(basePrice * friendBonus) * quantity;
        }
      }
    } else if (itemType === 'seed') {
      const species =
        (item.species as string | null) ??
        (raw.species as string | undefined) ??
        (raw.seedName as string | undefined) ??
        '';
      if (species) {
        const price = getSeedPrice(species);
        total += (price?.coins ?? 0) * quantity;
      }
    } else if (itemType === 'egg') {
      const eggId = (raw.eggId as string | undefined) ?? '';
      if (eggId) {
        const entry = getEggType(eggId);
        total += finiteOr0(entry?.coinPrice) * quantity;
      }
    } else if (itemType === 'tool') {
      const toolId = (raw.toolId as string | undefined) ?? '';
      if (toolId) {
        const price = getItemPrice(toolId);
        total += (price?.coins ?? 0) * quantity;
      }
    } else if (itemType === 'decor') {
      const decorId = (raw.decorId as string | undefined) ?? '';
      if (decorId) {
        const entry = getDecor(decorId);
        total += finiteOr0(entry?.coinPrice) * quantity;
      }
    } else if (itemType === 'plant') {
      // Growing plants: approximate as seed cost
      const species = (item.species as string | null) ?? (raw.species as string | undefined) ?? '';
      if (species) {
        const price = getSeedPrice(species);
        total += price?.coins ?? 0;
      }
    }

  }

  return total;
}

/**
 * Total value of all items across all storage buildings (Seed Silo, Pet Hutch, Decor Shed).
 * Requires `startStorageValue()` to have been called so that `cachedStorages` is populated.
 */
export function computeAllStoragesValue(friendBonus = 1): number {
  let total = 0;
  for (const s of cachedStorages) {
    if (!s || typeof s !== 'object') continue;
    const rec = s as Record<string, unknown>;

    // Value of the storage building itself (SeedSilo, PetHutch, DecorShed)
    const decorId = typeof rec.decorId === 'string' ? rec.decorId : '';
    if (decorId) {
      const entry = getDecor(decorId);
      if (entry) total += finiteOr0(entry.coinPrice);
    }

    // Value of items inside the storage
    const items = Array.isArray(rec.items) ? (rec.items as unknown[]) : [];
    total += computeStorageItemsValue(items, friendBonus);
  }
  return total;
}

/**
 * Total sell value of all active (placed) pets.
 */
export function computeActivePetsValue(friendBonus = 1): number {
  let total = 0;
  for (const pet of getActivePetInfos()) {
    if (!pet.raw || typeof pet.raw !== 'object') continue;
    total += computePetSellPrice(pet.raw as Record<string, unknown>, friendBonus);
  }
  return total;
}

/**
 * Total buy-price value of placed decor + eggs on room tiles.
 * Iterates both tileObjects and boardwalkTileObjects, skipping 'plant' tiles.
 */
export function computePlacedDecorAndEggValue(snapshot: GardenSnapshot): number {
  if (!snapshot) return 0;
  let total = 0;

  const tileSets = [snapshot.tileObjects, snapshot.boardwalkTileObjects];
  for (const tileMap of tileSets) {
    if (!tileMap) continue;
    for (const tile of Object.values(tileMap)) {
      if (!tile || typeof tile !== 'object') continue;
      const t = tile as Record<string, unknown>;
      const objType = t.objectType;

      if (objType === 'decor') {
        const decorId = (typeof t.decorId === 'string' ? t.decorId : null)
          ?? (typeof t.species === 'string' ? t.species : null);
        if (decorId) {
          const entry = getDecor(decorId);
          if (entry) total += finiteOr0(entry.coinPrice);
        }
      } else if (objType === 'egg') {
        const eggId = (typeof t.eggId === 'string' ? t.eggId : null)
          ?? (typeof t.eggType === 'string' ? t.eggType : null)
          ?? (typeof t.species === 'string' ? t.species : null);
        if (eggId) {
          const entry = getEggType(eggId);
          if (entry) total += finiteOr0(entry.coinPrice);
        }
      }
    }
  }

  return total;
}

/**
 * Total value of growing (not yet harvestable) crops on room tiles.
 * Values each growing crop at its seed purchase price.
 */
export function computeGrowingCropsValue(snapshot: GardenSnapshot): number {
  if (!snapshot) return 0;

  const now = Date.now();
  let total = 0;

  const tileSets = [snapshot.tileObjects, snapshot.boardwalkTileObjects];
  for (const tileMap of tileSets) {
    if (!tileMap) continue;
    for (const tile of Object.values(tileMap)) {
      if (!tile || typeof tile !== 'object') continue;
      const tileRec = tile as Record<string, unknown>;
      if (tileRec.objectType !== 'plant') continue;

      const slots = tileRec.slots;
      if (!Array.isArray(slots)) continue;

      for (const slot of slots) {
        if (!slot || typeof slot !== 'object') continue;
        const slotRec = slot as Record<string, unknown>;

        const species = slotRec.species;
        if (typeof species !== 'string') continue;

        const endTimeRaw = slotRec.endTime;
        const endTime = typeof endTimeRaw === 'number' ? endTimeRaw : Number(endTimeRaw);
        // Only count crops that are still growing (endTime > now)
        if (!Number.isFinite(endTime) || endTime <= now) continue;

        const price = getSeedPrice(species);
        total += price?.coins ?? 0;
      }
    }
  }

  return total;
}

/** Expose cached storages array for external consumers (e.g. top-10 value items). */
export function getCachedStorages(): unknown[] {
  return cachedStorages;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let started = false;
let currentConfig: StorageValueConfig = { ...DEFAULT_CONFIG };
let currentState: StorageValueState = { activeModal: null, value: 0, status: 'hidden' };
let currentModalId: string | null = null;
let cachedStorages: unknown[] = [];
let modalAtomRetryCount = 0;

const stateListeners = new Set<(state: StorageValueState) => void>();
const storageDataListeners = new Set<() => void>();

// Subscriptions (cleaned up on stop)
let modalAtomUnsub: (() => void) | null = null;
let dataAtomUnsub: (() => void) | null = null;
let invUnsub: (() => void) | null = null;
let catalogReadyUnsub: (() => void) | null = null;
let stopRetryTimer: (() => void) | null = null;
let debouncedRecompute: ((() => void) & { cancel: () => void }) | null = null;

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function notifyListeners(state: StorageValueState): void {
  currentState = state;
  for (const listener of stateListeners) {
    try { listener(state); } catch {}
  }
}

function getDetectedStorages(): Set<string> {
  const detected = new Set<string>();
  for (const s of cachedStorages) {
    if (!s || typeof s !== 'object') continue;
    const decorId = (s as Record<string, unknown>).decorId as string | undefined;
    if (decorId) detected.add(decorId);
  }
  return detected;
}

function isEnabledForModal(modalId: string): boolean {
  const detected = getDetectedStorages();
  if (modalId === 'inventory') return currentConfig.inventory;
  if (modalId === 'seedSilo') return currentConfig.seedSilo && detected.has('SeedSilo');
  if (modalId === 'petHutch') return currentConfig.petHutch && detected.has('PetHutch');
  if (modalId === 'decorShed') return currentConfig.decorShed && detected.has('DecorShed');
  return false;
}

function computeValueForModal(modalId: string): number {
  const fb = getFriendBonusMultiplier();
  if (modalId === 'inventory') {
    return computeInventoryValue(fb);
  }
  const storageDecorId = MODAL_TO_STORAGE_DECORID[modalId];
  if (!storageDecorId) return 0;

  const storageEntry = cachedStorages.find((s) => {
    if (!s || typeof s !== 'object') return false;
    return (s as Record<string, unknown>).decorId === storageDecorId;
  }) as Record<string, unknown> | undefined;

  if (!storageEntry) return 0;
  const items = Array.isArray(storageEntry.items) ? (storageEntry.items as unknown[]) : [];
  return computeStorageItemsValue(items, fb);
}

function recompute(): void {
  if (!currentModalId || !TARGET_MODALS.has(currentModalId)) {
    notifyListeners({ activeModal: null, value: 0, status: 'hidden' });
    return;
  }
  if (!isEnabledForModal(currentModalId)) {
    notifyListeners({ activeModal: currentModalId, value: 0, status: 'hidden' });
    return;
  }
  if (!areCatalogsReady()) {
    notifyListeners({ activeModal: currentModalId, value: 0, status: 'loading' });
    return;
  }
  const value = computeValueForModal(currentModalId);
  notifyListeners({ activeModal: currentModalId, value, status: 'ready' });
}

// ---------------------------------------------------------------------------
// Atom subscriptions (async, fire-and-forget)
// ---------------------------------------------------------------------------

async function trySubscribeModalAtom(): Promise<boolean> {
  if (modalAtomUnsub) return true;

  try {
    const unsub = await subscribeAtomValue('activeModal', (value) => {
      currentModalId = typeof value === 'string' && TARGET_MODALS.has(value) ? value : null;
      recompute();
    });
    if (!unsub) return false;
    modalAtomUnsub = unsub;
    timerManager.unregister(MODAL_RETRY_TIMER_ID);
    stopRetryTimer = null;
    log('Subscribed to activeModalAtom');
    return true;
  } catch (err) {
    log('Failed to subscribe to activeModalAtom', err);
    return false;
  }
}

async function initDataAtomSubscription(): Promise<void> {
  if (dataAtomUnsub) return;
  try {
    const unsub = await subscribeAtomValue('myData', (value) => {
      const rec = value as Record<string, unknown> | null;
      const inv = rec?.inventory as Record<string, unknown> | undefined;
      cachedStorages = Array.isArray(inv?.storages) ? (inv!.storages as unknown[]) : [];
      if (currentModalId && TARGET_MODALS.has(currentModalId)) {
        debouncedRecompute?.();
      }
      for (const cb of storageDataListeners) {
        try { cb(); } catch { /* ignore */ }
      }
    });
    if (!unsub) {
      log('myDataAtom not found — storage detection unavailable');
      return;
    }
    dataAtomUnsub = unsub;
    log('Subscribed to myDataAtom');
  } catch (err) {
    log('Failed to subscribe to myDataAtom', err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getStorageValueState(): StorageValueState {
  return { ...currentState };
}

export function onStorageValueChange(cb: (state: StorageValueState) => void): () => void {
  stateListeners.add(cb);
  return () => { stateListeners.delete(cb); };
}

/** Subscribe to raw storage data changes (fires when cachedStorages is updated from myDataAtom). */
export function onStorageDataChange(cb: () => void): () => void {
  storageDataListeners.add(cb);
  return () => { storageDataListeners.delete(cb); };
}

export function getStorageValueConfig(): StorageValueConfig {
  return { ...currentConfig };
}

export function saveStorageValueConfig(next: StorageValueConfig): void {
  currentConfig = { ...next };
  storage.set(STORAGE_CONFIG_KEY, currentConfig);
  recompute();
}

export function getDetectedStorageIds(): Set<string> {
  return getDetectedStorages();
}

export function startStorageValue(): void {
  if (started) return;
  started = true;

  currentConfig = {
    ...DEFAULT_CONFIG,
    ...storage.get<Partial<StorageValueConfig>>(STORAGE_CONFIG_KEY, {}),
  };

  debouncedRecompute = debounceCancelable(recompute, 200);

  // Try subscribing to modal atom immediately
  void trySubscribeModalAtom();

  // Retry every second until found (handles minified label-less builds)
  stopRetryTimer = criticalInterval(MODAL_RETRY_TIMER_ID, () => {
    if (modalAtomUnsub) {
      timerManager.unregister(MODAL_RETRY_TIMER_ID);
      stopRetryTimer = null;
      return;
    }
    modalAtomRetryCount++;
    if (modalAtomRetryCount >= MODAL_RETRY_MAX) {
      timerManager.unregister(MODAL_RETRY_TIMER_ID);
      stopRetryTimer = null;
      return;
    }
    void trySubscribeModalAtom();
  }, 1000);

  // Subscribe to game data atom for storage building contents
  void initDataAtomSubscription();

  // Subscribe to inventory changes (for Inventory modal)
  invUnsub = onInventoryChange(() => {
    if (currentModalId === 'inventory') {
      debouncedRecompute?.();
    }
  });

  // Re-compute when catalogs become ready (overlay may have shown 'loading')
  catalogReadyUnsub = onCatalogsReady(() => {
    debouncedRecompute?.();
  });

  log('Started');
}

export function stopStorageValue(): void {
  if (!started) return;
  started = false;

  debouncedRecompute?.cancel();
  debouncedRecompute = null;

  timerManager.unregister(MODAL_RETRY_TIMER_ID);
  stopRetryTimer = null;

  modalAtomUnsub?.();
  modalAtomUnsub = null;

  dataAtomUnsub?.();
  dataAtomUnsub = null;

  invUnsub?.();
  invUnsub = null;

  catalogReadyUnsub?.();
  catalogReadyUnsub = null;

  stateListeners.clear();
  storageDataListeners.clear();
  currentModalId = null;
  cachedStorages = [];
  modalAtomRetryCount = 0;
  currentState = { activeModal: null, value: 0, status: 'hidden' };

  log('Stopped');
}
