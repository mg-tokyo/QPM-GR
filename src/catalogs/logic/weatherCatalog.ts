// Weather catalog extraction from live game-bundle chunks. All text parsing
// lives in bundleTextParsing.ts; this file only orchestrates fetch + cache.

import { fetchBundleContaining, getMarkerMissCount, markBundleConsumerDone } from './bundleParser';
import { WEATHER_BLUEPRINT_MARKER, extractWeatherCatalogFromText } from './bundleTextParsing';
import type { RuntimeWeatherCatalog } from './bundleTextParsing';
import { createNamedLogger } from '../../diagnostics/logger';

export type { RuntimeWeatherCatalog } from './bundleTextParsing';

const log = createNamedLogger('catalogs');

export interface WeatherCatalogLoadResult {
  map: RuntimeWeatherCatalog | null;
  /** Whether this call fetched at least one previously untried chunk — used to
   * gate retry budgets so lazy chunks that haven't loaded yet don't burn attempts. */
  triedNewChunks: boolean;
}

let weatherCatalogCache: RuntimeWeatherCatalog | null = null;
let weatherCatalogInFlight: Promise<WeatherCatalogLoadResult> | null = null;

async function loadWeatherCatalogFromBundle(): Promise<WeatherCatalogLoadResult> {
  const missesBefore = getMarkerMissCount(WEATHER_BLUEPRINT_MARKER);
  const bundleText = await fetchBundleContaining(WEATHER_BLUEPRINT_MARKER);
  const triedNewChunks = getMarkerMissCount(WEATHER_BLUEPRINT_MARKER) > missesBefore;

  if (!bundleText) {
    log.debug('weatherCatalog: no loaded chunk contains the weather blueprint marker');
    return { map: null, triedNewChunks };
  }

  const catalog = extractWeatherCatalogFromText(bundleText);
  if (!catalog) {
    log.debug('weatherCatalog: blueprint chunk found but parse failed');
  }
  return { map: catalog, triedNewChunks };
}

export async function getWeatherCatalogMap(): Promise<WeatherCatalogLoadResult> {
  if (weatherCatalogCache) return { map: weatherCatalogCache, triedNewChunks: false };
  if (weatherCatalogInFlight) return weatherCatalogInFlight;

  weatherCatalogInFlight = (async () => {
    const result = await loadWeatherCatalogFromBundle();
    if (!result.map) return result;
    weatherCatalogCache = result.map;
    markBundleConsumerDone('weather');
    return result;
  })().finally(() => {
    weatherCatalogInFlight = null;
  });

  return weatherCatalogInFlight;
}
