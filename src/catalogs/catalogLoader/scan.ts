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
  enrichMutationColors,
  enrichPetAbilityColors,
  pollAttempts,
  stopWeatherCatalogPolling,
} from './enrichment';
import { checkAndNotifyReady, notifyPetAbilitiesCaptured } from './readyState';
import { publishCatalogsHealth } from './diagnostics';
import { captureSources, capturedCatalogs, catalogLog, NativeObject, originalKeys, publishCatalogs } from './state';

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

  // Capture-or-upgrade for dex-shaped catalogs: the game exposes partial
  // dex-shaped objects during load (spread sources for the merged dex) and
  // another mod's enumeration order can surface a partial one first. While
  // hooks are installed, a strictly bigger match replaces the capture.
  // mutationCatalog stays capture-once here — its known lookalike has an
  // EQUAL key count (display-name keys), so only the bundle-text merge in
  // fallback.ts can tell them apart.
  const captureOrUpgrade = (
    name: 'itemCatalog' | 'decorCatalog' | 'eggCatalog' | 'petCatalog' | 'plantCatalog',
  ): boolean => {
    const current = capturedCatalogs[name];
    const currentCount = current ? originalKeys.call(NativeObject, current).length : 0;
    if (current && keys.length <= currentCount) return false;
    (capturedCatalogs as unknown as Record<string, unknown>)[name] = record;
    captureSources[name] = 'hook';
    catalogLog(current
      ? `Upgraded ${name} capture (${currentCount} -> ${keys.length} entries)`
      : `Captured ${name} with ${keys.length} entries`);
    return true;
  };

  try {
    if (looksLikeItemCatalog(record, keys) && captureOrUpgrade('itemCatalog')) {
      didCapture = true;
    }

    if (looksLikeDecorCatalog(record, keys) && captureOrUpgrade('decorCatalog')) {
      didCapture = true;
    }

    if (!capturedCatalogs.mutationCatalog && looksLikeMutationCatalog(record, keys)) {
      capturedCatalogs.mutationCatalog = record as GameCatalogs['mutationCatalog'];
      captureSources.mutationCatalog = 'hook';
      catalogLog('Captured mutationCatalog');
      didCapture = true;
      // Reset retry budget when the catalog becomes available.
      pollAttempts.mutationColor = 0;
      void enrichMutationColors();
    }

    if (looksLikeEggCatalog(record, keys) && captureOrUpgrade('eggCatalog')) {
      didCapture = true;
    }

    if (looksLikePetCatalog(record, keys) && captureOrUpgrade('petCatalog')) {
      didCapture = true;
    }

    if (looksLikePetAbilities(record, keys)) {
      // Capture-or-upgrade, not capture-once: the game exposes partial
      // dex-shaped objects during load (spread sources for the merged dex),
      // and another mod's enumeration order can surface a partial one first.
      // A strictly bigger match replaces it while hooks are still installed.
      const current = capturedCatalogs.petAbilities;
      const currentCount = current ? originalKeys.call(NativeObject, current).length : 0;
      if (!current || keys.length > currentCount) {
        capturedCatalogs.petAbilities = record as GameCatalogs['petAbilities'];
        captureSources.petAbilities = 'hook';
        catalogLog(current
          ? `Upgraded petAbilities capture (${currentCount} -> ${keys.length} abilities)`
          : 'Captured petAbilities');
        didCapture = true;
        // Reset retry budget when abilities become available.
        pollAttempts.abilityColor = 0;
        void enrichPetAbilityColors();
        notifyPetAbilitiesCaptured();
      }
    }

    if (looksLikePlantCatalog(record, keys) && captureOrUpgrade('plantCatalog')) {
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
      // A capture after the ready flip must refresh the health line too.
      publishCatalogsHealth();
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
