// Debug utilities — manual refresh + console diagnostics.

import { pageWindow } from '../../core/pageContext';
import { writeShimConsole } from '../../diagnostics/logger';
import {
  enrichWeatherCatalog,
  pollAttempts,
  startWeatherCatalogPolling,
} from './enrichment';
import { maybeCapture } from './scan';
import { capturedCatalogs, NativeObject, originalKeys, readiness } from './state';

function dump(...args: unknown[]): void {
  writeShimConsole('QPM Catalog Diagnostics', args);
}

/**
 * Force a weather-catalog enrichment attempt on demand (debug utility).
 */
export async function forceWeatherCatalogRefresh(): Promise<{ success: boolean; count: number }> {
  pollAttempts.weatherCatalog = 0;
  let success = await enrichWeatherCatalog();

  if (!success && !capturedCatalogs.weatherCatalog) {
    // Force one direct scan pass over page globals to capture weather objects
    // that might never hit Object.* hooks after initial load.
    try {
      const keys = originalKeys.call(NativeObject, pageWindow as unknown as object);
      for (const key of keys) {
        maybeCapture((pageWindow as unknown as Record<string, unknown>)[key]);
      }
    } catch {
      // Ignore scan errors.
    }
    success = !!capturedCatalogs.weatherCatalog || await enrichWeatherCatalog();
  }

  if (!success) {
    startWeatherCatalogPolling();
  }

  const count = capturedCatalogs.weatherCatalog ? Object.keys(capturedCatalogs.weatherCatalog).length : 0;
  return { success, count };
}

/**
 * Diagnostic: Manually check and log current catalog status
 * Useful for debugging catalog loading issues
 */
export function diagnoseCatalogs(): void {
  dump('Catalogs Ready:', readiness.catalogsReady);
  dump('Hooks Active:', NativeObject.keys !== originalKeys);

  const catalogs = capturedCatalogs;

  dump('\nPlant Catalog:',
    catalogs.plantCatalog ? `OK ${Object.keys(catalogs.plantCatalog).length} species` : 'NOT CAPTURED'
  );
  if (catalogs.plantCatalog) {
    dump('  Species:', Object.keys(catalogs.plantCatalog).join(', '));
  }

  dump('\nPet Catalog:',
    catalogs.petCatalog ? `OK ${Object.keys(catalogs.petCatalog).length} species` : 'NOT CAPTURED'
  );
  if (catalogs.petCatalog) {
    dump('  Species:', Object.keys(catalogs.petCatalog).join(', '));
  }

  dump('\nPet Abilities:',
    catalogs.petAbilities ? `OK ${Object.keys(catalogs.petAbilities).length} abilities` : 'NOT CAPTURED'
  );
  if (catalogs.petAbilities) {
    dump('  Abilities:', Object.keys(catalogs.petAbilities).slice(0, 20).join(', '), '...');
  }

  dump('\nMutation Catalog:',
    catalogs.mutationCatalog ? `OK ${Object.keys(catalogs.mutationCatalog).length} mutations` : 'NOT CAPTURED'
  );

  dump('\nWeather Catalog:',
    catalogs.weatherCatalog ? `OK ${Object.keys(catalogs.weatherCatalog).length} entries` : 'NOT CAPTURED'
  );

  dump('\nTip: Access catalogs directly via window.__QPM_CATALOGS');
  dump('To check if specific species exist:');
  dump('   window.__QPM_CATALOGS.plantCatalog["PineTree"]');
  dump('   Object.keys(window.__QPM_CATALOGS.plantCatalog)');
}

// Expose diagnostic function globally for debugging
if (typeof window !== 'undefined') {
  (window as any).__QPM_DiagnoseCatalogs = diagnoseCatalogs;
}
