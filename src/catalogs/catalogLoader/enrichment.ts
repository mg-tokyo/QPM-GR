// Post-capture enrichment: ability colors, weather catalog, cosmetic catalog.
// Each has an immediate attempt + bounded retry polling.

import { DEFAULT_ABILITY_COLOR, getAbilityColorMap } from '../logic/abilityColors';
import { getWeatherCatalogMap } from '../logic/weatherCatalog';
import { getCosmeticCatalogFromBundle } from '../logic/cosmeticCatalog';
import { readSharedGlobal } from '../../core/pageContext';
import type { GameCatalogs } from '../types';
import {
  ABILITY_COLOR_ANCHORS,
  ABILITY_COLOR_POLL_INTERVAL_MS,
  COSMETIC_CATALOG_POLL_INTERVAL_MS,
  MAX_ABILITY_COLOR_POLL_ATTEMPTS,
  MAX_COSMETIC_CATALOG_POLL_ATTEMPTS,
  MAX_WEATHER_CATALOG_POLL_ATTEMPTS,
  WEATHER_CATALOG_POLL_INTERVAL_MS,
} from './constants';
import { diagLog, diagState } from './diagnostics';
import { capturedCatalogs, catalogLog, publishCatalogs } from './state';

// Live holder — retry budgets reset from scan.ts (ability) and debug.ts (weather).
export const pollAttempts = {
  abilityColor: 0,
  weatherCatalog: 0,
  cosmeticCatalog: 0,
};

let abilityColorPollTimer: ReturnType<typeof setInterval> | null = null;
let abilityColorEnrichInFlight: Promise<boolean> | null = null;
let weatherCatalogPollTimer: ReturnType<typeof setInterval> | null = null;
let weatherCatalogEnrichInFlight: Promise<boolean> | null = null;
let cosmeticCatalogPollTimer: ReturnType<typeof setInterval> | null = null;
let cosmeticCatalogEnrichInFlight: Promise<boolean> | null = null;

const shouldLogAbilityColorDebug = (): boolean => {
  try {
    return readSharedGlobal('__QPM_DEBUG_ABILITY_COLORS') === true;
  } catch {
    return false;
  }
};

function readAbilityColorBg(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const color = record.color;

  if (typeof color === 'string') {
    const trimmed = color.trim();
    return trimmed.length ? trimmed : null;
  }
  if (!color || typeof color !== 'object') return null;

  const bg = (color as Record<string, unknown>).bg;
  if (typeof bg === 'string') {
    const trimmed = bg.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function arePetAbilityColorsEnriched(abilities: Record<string, unknown>): boolean {
  return ABILITY_COLOR_ANCHORS.some(id => readAbilityColorBg(abilities[id]) !== null);
}

function isWeatherCatalogEnriched(catalog: GameCatalogs['weatherCatalog']): boolean {
  return !!catalog && typeof catalog === 'object' && Object.keys(catalog).length > 0;
}

export async function enrichPetAbilityColors(): Promise<boolean> {
  if (!capturedCatalogs.petAbilities) return false;
  const abilities = capturedCatalogs.petAbilities as Record<string, unknown>;
  if (arePetAbilityColorsEnriched(abilities)) return true;
  if (abilityColorEnrichInFlight) return abilityColorEnrichInFlight;

  abilityColorEnrichInFlight = (async () => {
    const colorMap = await getAbilityColorMap();
    if (!colorMap) return false;

    const enriched: Record<string, unknown> = {};
    let updatedCount = 0;

    for (const [abilityId, abilityDef] of Object.entries(abilities)) {
      const entry = abilityDef && typeof abilityDef === 'object'
        ? { ...(abilityDef as Record<string, unknown>) }
        : {};

      if (readAbilityColorBg(entry) === null) {
        const mapped = colorMap[abilityId] || DEFAULT_ABILITY_COLOR;
        entry.color = {
          bg: mapped.bg,
          hover: mapped.hover || mapped.bg,
        };
        updatedCount += 1;
      }
      enriched[abilityId] = entry;
    }

    if (updatedCount > 0) {
      capturedCatalogs.petAbilities = enriched as GameCatalogs['petAbilities'];
      catalogLog(`Enriched ability colors from runtime bundle (${updatedCount} abilities).`);
      publishCatalogs();
    }

    return arePetAbilityColorsEnriched(enriched);
  })().finally(() => {
    abilityColorEnrichInFlight = null;
  });

  return abilityColorEnrichInFlight;
}

export async function enrichWeatherCatalog(): Promise<boolean> {
  if (isWeatherCatalogEnriched(capturedCatalogs.weatherCatalog)) return true;
  if (weatherCatalogEnrichInFlight) return weatherCatalogEnrichInFlight;

  weatherCatalogEnrichInFlight = (async () => {
    const weatherCatalog = await getWeatherCatalogMap();
    if (!weatherCatalog) return false;

    capturedCatalogs.weatherCatalog = weatherCatalog as GameCatalogs['weatherCatalog'];
    catalogLog(`Enriched weather catalog from runtime bundle (${Object.keys(weatherCatalog).length} entries).`);
    publishCatalogs();
    return true;
  })().finally(() => {
    weatherCatalogEnrichInFlight = null;
  });

  return weatherCatalogEnrichInFlight;
}

async function enrichCosmeticCatalog(): Promise<boolean> {
  if (capturedCatalogs.cosmeticCatalog) return true;
  if (cosmeticCatalogEnrichInFlight) return cosmeticCatalogEnrichInFlight;

  cosmeticCatalogEnrichInFlight = (async () => {
    const catalog = await getCosmeticCatalogFromBundle();
    if (!catalog) return false;

    capturedCatalogs.cosmeticCatalog = catalog as GameCatalogs['cosmeticCatalog'];
    catalogLog(`Enriched cosmetic catalog from bundle (${catalog.length} items).`);
    publishCatalogs();
    return true;
  })().finally(() => {
    cosmeticCatalogEnrichInFlight = null;
  });

  return cosmeticCatalogEnrichInFlight;
}

export function stopAbilityColorPolling(): void {
  if (!abilityColorPollTimer) return;
  clearInterval(abilityColorPollTimer);
  abilityColorPollTimer = null;
}

export function stopWeatherCatalogPolling(): void {
  if (!weatherCatalogPollTimer) return;
  clearInterval(weatherCatalogPollTimer);
  weatherCatalogPollTimer = null;
}

export function stopCosmeticCatalogPolling(): void {
  if (!cosmeticCatalogPollTimer) return;
  clearInterval(cosmeticCatalogPollTimer);
  cosmeticCatalogPollTimer = null;
}

export function startAbilityColorPolling(): void {
  if (abilityColorPollTimer) return;
  pollAttempts.abilityColor = 0;

  // Immediate attempt first, then bounded retry polling.
  void enrichPetAbilityColors();

  abilityColorPollTimer = setInterval(() => {
    void (async () => {
      // Gemini-style enrichment depends on having the ability catalog first.
      // Do not consume retry budget before abilities are captured.
      if (!capturedCatalogs.petAbilities) return;

      const enriched = await enrichPetAbilityColors();
      pollAttempts.abilityColor += 1;
      if (enriched) {
        stopAbilityColorPolling();
        return;
      }
      if (pollAttempts.abilityColor >= MAX_ABILITY_COLOR_POLL_ATTEMPTS) {
        if (shouldLogAbilityColorDebug()) {
          catalogLog('Ability color enrichment timed out, using fallback colors.');
        }
        if (diagState.started) {
          diagLog.warn('QPM-CATALOG-003', {
            what: 'abilityColors',
            attempts: pollAttempts.abilityColor,
          });
        }
        stopAbilityColorPolling();
      }
    })();
  }, ABILITY_COLOR_POLL_INTERVAL_MS);
}

export function startWeatherCatalogPolling(): void {
  if (weatherCatalogPollTimer) return;
  pollAttempts.weatherCatalog = 0;

  // Immediate attempt first, then bounded retry polling.
  void enrichWeatherCatalog();

  weatherCatalogPollTimer = setInterval(() => {
    void (async () => {
      const enriched = await enrichWeatherCatalog();
      pollAttempts.weatherCatalog += 1;
      if (enriched) {
        stopWeatherCatalogPolling();
        return;
      }
      if (pollAttempts.weatherCatalog >= MAX_WEATHER_CATALOG_POLL_ATTEMPTS) {
        if (diagState.started) {
          diagLog.warn('QPM-CATALOG-003', {
            what: 'weatherCatalog',
            attempts: pollAttempts.weatherCatalog,
          });
        }
        stopWeatherCatalogPolling();
      }
    })();
  }, WEATHER_CATALOG_POLL_INTERVAL_MS);
}

export function startCosmeticCatalogPolling(): void {
  if (cosmeticCatalogPollTimer) return;
  pollAttempts.cosmeticCatalog = 0;

  void enrichCosmeticCatalog();

  cosmeticCatalogPollTimer = setInterval(() => {
    void (async () => {
      const enriched = await enrichCosmeticCatalog();
      pollAttempts.cosmeticCatalog += 1;
      if (enriched) {
        stopCosmeticCatalogPolling();
        return;
      }
      if (pollAttempts.cosmeticCatalog >= MAX_COSMETIC_CATALOG_POLL_ATTEMPTS) {
        if (diagState.started) {
          diagLog.warn('QPM-CATALOG-003', {
            what: 'cosmeticCatalog',
            attempts: pollAttempts.cosmeticCatalog,
          });
        }
        stopCosmeticCatalogPolling();
      }
    })();
  }, COSMETIC_CATALOG_POLL_INTERVAL_MS);
}
