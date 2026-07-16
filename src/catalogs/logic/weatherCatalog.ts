// Weather catalog extraction from live game-bundle chunks. All text parsing
// lives in bundleTextParsing.ts; this file only orchestrates fetch + cache.

import { fetchBundleContaining, markBundleConsumerDone } from './bundleParser';
import { WEATHER_BLUEPRINT_MARKER, extractWeatherCatalogFromText } from './bundleTextParsing';
import type { RuntimeWeatherCatalog } from './bundleTextParsing';
import { createNamedLogger } from '../../diagnostics/logger';

export type { RuntimeWeatherCatalog } from './bundleTextParsing';

const log = createNamedLogger('catalogs');

let weatherCatalogCache: RuntimeWeatherCatalog | null = null;
let weatherCatalogInFlight: Promise<RuntimeWeatherCatalog | null> | null = null;

async function loadWeatherCatalogFromBundle(): Promise<RuntimeWeatherCatalog | null> {
  const bundleText = await fetchBundleContaining(WEATHER_BLUEPRINT_MARKER);
  if (!bundleText) {
    log.debug('weatherCatalog: no loaded chunk contains the weather blueprint marker');
    return null;
  }

  const catalog = extractWeatherCatalogFromText(bundleText);
  if (!catalog) {
    log.debug('weatherCatalog: blueprint chunk found but parse failed');
  }
  return catalog;
}

export async function getWeatherCatalogMap(): Promise<RuntimeWeatherCatalog | null> {
  if (weatherCatalogCache) return weatherCatalogCache;
  if (weatherCatalogInFlight) return weatherCatalogInFlight;

  weatherCatalogInFlight = (async () => {
    const map = await loadWeatherCatalogFromBundle();
    if (!map) return null;
    weatherCatalogCache = map;
    markBundleConsumerDone('weather');
    return map;
  })().finally(() => {
    weatherCatalogInFlight = null;
  });

  return weatherCatalogInFlight;
}
