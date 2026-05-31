// src/features/locker/types.ts
// Config model and guard result types for the Locker.

export interface InventoryReserveConfig {
  enabled: boolean;
  minFreeSlots: number; // 0–50, default 5
}

// ── Harvest Filter types ──────────────────────────────────────────────────

export type ScaleLockMode = 'RANGE' | 'MINIMUM' | 'MAXIMUM' | 'NONE';
export type FilterMode = 'LOCK' | 'ALLOW';
export type WeatherFilterMode = 'ANY' | 'ALL' | 'RECIPES';

export interface HarvestFilterSettings {
  filterMode: FilterMode;         // LOCK = block matching, ALLOW = only allow matching
  scaleLockMode: ScaleLockMode;
  minScalePct: number;            // 50–100
  maxScalePct: number;            // 51–100
  colorGold: boolean;             // match Gold mutation
  colorRainbow: boolean;          // match Rainbow mutation
  colorNormal: boolean;           // match Normal (no Gold/Rainbow)
  weatherMode: WeatherFilterMode; // ANY = any tag, ALL = all tags, RECIPES = combo groups
  weatherTags: string[];          // for ANY/ALL modes
  weatherRecipes: string[][];     // for RECIPES: each sub-array is AND, arrays are OR'd
}

export interface CropOverride {
  enabled: boolean;
  settings: HarvestFilterSettings;
}

// ── Main config ───────────────────────────────────────────────────────────

export interface LockerConfig {
  enabled: boolean;              // master switch (off by default)
  inventoryReserve: InventoryReserveConfig;
  hatchLock: boolean;            // blanket: block ALL egg hatching
  eggLocks: Record<string, boolean>;      // per-type egg locks
  plantLocks: Record<string, boolean>;    // per-species plant harvest locks
  mutationLocks: Record<string, boolean>; // per-mutation harvest locks (global)
  harvestLock: boolean;          // blanket: block ALL harvesting
  decorPickupLock: boolean;      // blanket: block ALL decor pickup
  decorLocks: Record<string, boolean>;    // per-decor pickup locks
  sellAllCropsLock: boolean;
  cropSellLocks: Record<string, boolean>; // per-crop sell protection (blocks SellAllCrops)
  petSellGuard: boolean;         // block selling protected pets during hold-Space
  // ── Harvest filters (Aries-style) ──
  harvestFilter: HarvestFilterSettings;               // global harvest filter
  cropOverrides: Record<string, CropOverride>;        // per-species filter overrides
}

export interface GuardResult {
  blocked: boolean;
  reason?: string; // human-readable, shown in notification
  rule?: string;   // machine-readable ID for throttling
}
