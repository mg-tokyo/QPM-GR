// Deep scan logic — recursive catalog pattern matching over intercepted objects.

import type { GameCatalogs } from '../types';
import {
  looksLikeCosmeticArray,
  looksLikeDecorCatalog,
  looksLikeEggCatalog,
  looksLikeItemCatalog,
  looksLikeMutationCatalog,
  looksLikePetAbilities,
  looksLikePetCatalog,
  looksLikePlantCatalog,
  looksLikeWeatherCatalog,
  normalizeWeatherCatalog,
} from './detection';
import {
  enrichPetAbilityColors,
  pollAttempts,
  stopWeatherCatalogPolling,
} from './enrichment';
import { checkAndNotifyReady } from './readyState';
import { capturedCatalogs, catalogLog, NativeObject, originalKeys, publishCatalogs } from './state';

// Track objects we've already scanned to avoid infinite loops
const seenObjects = new WeakSet<object>();

/**
 * Recursively scan an object and its children for catalog patterns
 * Limited to depth 3 to avoid performance issues
 */
function deepScan(obj: unknown, depth: number): void {
  if (!obj || typeof obj !== 'object') return;
  if (seenObjects.has(obj as object)) return;
  seenObjects.add(obj as object);

  let keys: string[] = [];
  try {
    keys = originalKeys.call(NativeObject, obj);
  } catch {
    return;
  }

  if (keys.length === 0) return;

  const record = obj as Record<string, unknown>;
  let didCapture = false;

  try {
    // Check each catalog type (only if not already captured)
    if (!capturedCatalogs.itemCatalog && looksLikeItemCatalog(record, keys)) {
      capturedCatalogs.itemCatalog = record as GameCatalogs['itemCatalog'];
      catalogLog('Captured itemCatalog');
      didCapture = true;
    }

    if (!capturedCatalogs.decorCatalog && looksLikeDecorCatalog(record, keys)) {
      capturedCatalogs.decorCatalog = record as GameCatalogs['decorCatalog'];
      catalogLog('Captured decorCatalog');
      didCapture = true;
    }

    if (!capturedCatalogs.mutationCatalog && looksLikeMutationCatalog(record, keys)) {
      capturedCatalogs.mutationCatalog = record as GameCatalogs['mutationCatalog'];
      catalogLog('Captured mutationCatalog');
      didCapture = true;
    }

    if (!capturedCatalogs.eggCatalog && looksLikeEggCatalog(record, keys)) {
      capturedCatalogs.eggCatalog = record as GameCatalogs['eggCatalog'];
      catalogLog('Captured eggCatalog');
      didCapture = true;
    }

    if (!capturedCatalogs.petCatalog && looksLikePetCatalog(record, keys)) {
      capturedCatalogs.petCatalog = record as GameCatalogs['petCatalog'];
      catalogLog(`Captured petCatalog with ${keys.length} species:`, keys.slice(0, 10).join(', '), '...');
      didCapture = true;
    }

    if (!capturedCatalogs.petAbilities && looksLikePetAbilities(record, keys)) {
      capturedCatalogs.petAbilities = record as GameCatalogs['petAbilities'];
      catalogLog('Captured petAbilities');
      didCapture = true;
      // Reset retry budget when abilities become available.
      pollAttempts.abilityColor = 0;
      void enrichPetAbilityColors();
    }

    if (!capturedCatalogs.plantCatalog && looksLikePlantCatalog(record, keys)) {
      capturedCatalogs.plantCatalog = record as GameCatalogs['plantCatalog'];
      catalogLog(`Captured plantCatalog with ${keys.length} species:`, keys.slice(0, 10).join(', '), '...');
      didCapture = true;
    }

    if (!capturedCatalogs.weatherCatalog && looksLikeWeatherCatalog(record, keys)) {
      capturedCatalogs.weatherCatalog = normalizeWeatherCatalog(record) as GameCatalogs['weatherCatalog'];
      catalogLog(`Captured weatherCatalog with ${Object.keys(capturedCatalogs.weatherCatalog ?? {}).length} entries.`);
      didCapture = true;
      stopWeatherCatalogPolling();
    }

    if (!capturedCatalogs.cosmeticCatalog) {
      for (const v of Object.values(record)) {
        if (Array.isArray(v) && looksLikeCosmeticArray(v)) {
          capturedCatalogs.cosmeticCatalog = v as GameCatalogs['cosmeticCatalog'];
          catalogLog(`Captured cosmeticCatalog with ${v.length} items`);
          didCapture = true;
          break;
        }
      }
    }

    if (didCapture) {
      publishCatalogs();
    }

    // Check if essential catalogs are ready and notify waiters
    checkAndNotifyReady();
  } catch (e) {
    // Silently ignore detection errors
  }

  // Don't recurse too deep - performance optimization
  if (depth >= 3) return;

  // Recursively scan child objects
  for (const key of keys) {
    try {
      const value = record[key];
      if (value && typeof value === 'object') {
        deepScan(value, depth + 1);
      }
    } catch {
      // Ignore access errors
    }
  }
}

export function areHookCapturableCatalogsAllCaptured(): boolean {
  return !!(
    capturedCatalogs.petCatalog &&
    capturedCatalogs.plantCatalog &&
    capturedCatalogs.eggCatalog &&
    capturedCatalogs.petAbilities &&
    capturedCatalogs.itemCatalog &&
    capturedCatalogs.decorCatalog &&
    capturedCatalogs.mutationCatalog
  );
}

/**
 * Entry point for scanning an object
 */
export function maybeCapture(obj: unknown): void {
  // Short-circuit once all hook-capturable catalogs are in — until the
  // deferred removal actually clears the hook, the intercept still costs
  // a function call per Object.keys/values/entries in the game.
  if (areHookCapturableCatalogsAllCaptured()) return;
  try {
    deepScan(obj, 0);
  } catch {
    // Silently ignore
  }
}
