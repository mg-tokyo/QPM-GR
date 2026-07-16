// Shared mutable state for the catalog capture system.
// NOTE: Keep this module lightweight and early-init safe.

import { pageWindow, readSharedGlobal, shareGlobal } from '../../core/pageContext';
import { writeShimConsole } from '../../diagnostics/logger';
import type { GameCatalogs } from '../types';

// Variadic shim — used by hooks/lifecycle/scan/enrichment/ownership/readyState;
// avoids importing catalogLoader/diagnostics.ts (which imports this file).
export function catalogLog(...args: unknown[]): void {
  const isVerbose = readSharedGlobal('__QPM_VERBOSE_LOGS') === true;
  const isCatalogDebug = readSharedGlobal('__QPM_DEBUG_CATALOGS') === true;
  const isAbilityColorDebug = readSharedGlobal('__QPM_DEBUG_ABILITY_COLORS') === true;
  const isWeatherCatalogDebug = readSharedGlobal('__QPM_DEBUG_WEATHER_CATALOG') === true;
  if (isVerbose || isCatalogDebug || isAbilityColorDebug || isWeatherCatalogDebug) {
    writeShimConsole('QPM Catalog', args);
  }
}

/**
 * Storage for captured catalogs
 * Exposed globally as window.__QPM_CATALOGS for debugging
 */
export const capturedCatalogs: GameCatalogs = {
  itemCatalog: null,
  decorCatalog: null,
  mutationCatalog: null,
  eggCatalog: null,
  petCatalog: null,
  petAbilities: null,
  plantCatalog: null,
  weatherCatalog: null,
  cosmeticCatalog: null,
};

// Ready state tracking (live holder — mutated by readyState.ts)
export const readiness = { catalogsReady: false };
export const readyCallbacks: Array<(catalogs: GameCatalogs) => void> = [];
export const errorCallbacks: Array<(error: Error) => void> = [];

// Use the page window's Object constructor so hooks intercept game-context calls,
// not just sandbox-context calls (Tampermonkey isolates the userscript when @grant is used).
export const NativeObject = (pageWindow as unknown as { Object: typeof Object }).Object;
export const originalKeys = NativeObject.keys;
export const originalValues = NativeObject.values;
export const originalEntries = NativeObject.entries;

// Cosmetic ownership (live holder — populated by ownership.ts, read by publishCatalogs)
export const cosmeticOwnership: { set: Set<string> | null } = { set: null };

export function publishCatalogs(): void {
  try {
    shareGlobal('__QPM_CATALOGS', capturedCatalogs);
    if (cosmeticOwnership.set) {
      shareGlobal('__QPM_COSMETIC_OWNERSHIP', [...cosmeticOwnership.set]);
    }
  } catch (err) {
    catalogLog('Failed to expose __QPM_CATALOGS to window:', err);
  }
}
