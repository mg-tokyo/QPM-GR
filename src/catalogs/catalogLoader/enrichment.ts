// Post-capture enrichment: ability colors, weather catalog, cosmetic catalog.
// Each has an immediate attempt + bounded retry polling.

import { DEFAULT_ABILITY_COLOR, getAbilityColorMap, type RuntimeAbilityColor } from '../logic/abilityColors';
import { getMutationColorMap } from '../logic/mutationColors';
import { getWeatherCatalogMap } from '../logic/weatherCatalog';
import { getCosmeticCatalogFromBundle } from '../logic/cosmeticCatalog';
import { markBundleConsumerDone } from '../logic/bundleParser';
import { readSharedGlobal } from '../../core/pageContext';
import type { GameCatalogs } from '../types';
import {
  ABILITY_COLOR_ANCHORS,
  ABILITY_COLOR_POLL_INTERVAL_MS,
  COSMETIC_CATALOG_POLL_INTERVAL_MS,
  MAX_ABILITY_COLOR_POLL_ATTEMPTS,
  MAX_COSMETIC_CATALOG_POLL_ATTEMPTS,
  MAX_MUTATION_COLOR_POLL_ATTEMPTS,
  MAX_WEATHER_CATALOG_POLL_ATTEMPTS,
  MUTATION_COLOR_POLL_INTERVAL_MS,
  WEATHER_CATALOG_POLL_INTERVAL_MS,
} from './constants';
import { diagLog, diagState, publishCatalogsHealth } from './diagnostics';
import { capturedCatalogs, catalogLog, publishCatalogs } from './state';

// Live holder — retry budgets reset from scan.ts (ability) and debug.ts (weather).
export const pollAttempts = {
  abilityColor: 0,
  mutationColor: 0,
  weatherCatalog: 0,
  cosmeticCatalog: 0,
};

interface EnrichmentAttempt {
  enriched: boolean;
  triedNewChunks: boolean;
}

let abilityColorPollTimer: ReturnType<typeof setInterval> | null = null;
let abilityColorEnrichInFlight: Promise<EnrichmentAttempt> | null = null;
let mutationColorPollTimer: ReturnType<typeof setInterval> | null = null;
let mutationColorEnrichInFlight: Promise<EnrichmentAttempt> | null = null;
let weatherCatalogPollTimer: ReturnType<typeof setInterval> | null = null;
let weatherCatalogEnrichInFlight: Promise<EnrichmentAttempt> | null = null;
let cosmeticCatalogPollTimer: ReturnType<typeof setInterval> | null = null;
let cosmeticCatalogEnrichInFlight: Promise<EnrichmentAttempt> | null = null;

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

// Complete only when EVERY entry has a color: a successful pass assigns one to
// every entry (fallback default included), so an entry without one means a
// bundle-text merge added it after the last pass — anchors alone can't see that.
function allPetAbilityColorsEnriched(abilities: Record<string, unknown>): boolean {
  return Object.values(abilities).every(entry => readAbilityColorBg(entry) !== null);
}

// Tier / family fallback for abilities the game's color switch omits
// (e.g. HungerBoostIII grouped with HungerBoost/II but no explicit III case).
// Reasons: the game groups tiered / weather-variant abilities under a single color
// and may drop future tiers from the switch. We derive the color from the base
// ability rather than hardcoding per-ability entries in a UI file.
const TIER_SUFFIX_RE = /(IV|III|II|I)(?:_NEW)?$/i;
const FAMILY_PREFIXES: readonly string[] = [
  'Snowy', 'Frosty', 'Frost', 'Rainy', 'Wet', 'Snow', 'Rain', 'Thunder', 'Dawn', 'Amber',
];

function stripTierSuffix(id: string): string | null {
  const m = id.match(TIER_SUFFIX_RE);
  return m && m.index !== undefined && m.index > 0 ? id.slice(0, m.index) : null;
}

function stripFamilyPrefix(id: string): string | null {
  for (const prefix of FAMILY_PREFIXES) {
    if (id.startsWith(prefix) && id.length > prefix.length + 2) return id.slice(prefix.length);
  }
  return null;
}

function resolveAbilityColorWithFallback(
  abilityId: string,
  colorMap: Record<string, RuntimeAbilityColor>,
): RuntimeAbilityColor {
  const seen = new Set<string>();
  const queue: string[] = [abilityId];
  while (queue.length > 0) {
    const cand = queue.shift()!;
    if (seen.has(cand)) continue;
    seen.add(cand);
    const hit = colorMap[cand];
    if (hit) return hit;
    const t = stripTierSuffix(cand);
    if (t) queue.push(t);
    const f = stripFamilyPrefix(cand);
    if (f) queue.push(f);
  }
  return DEFAULT_ABILITY_COLOR;
}

function isWeatherCatalogEnriched(catalog: GameCatalogs['weatherCatalog']): boolean {
  return !!catalog && typeof catalog === 'object' && Object.keys(catalog).length > 0;
}

export async function enrichPetAbilityColors(): Promise<EnrichmentAttempt> {
  if (!capturedCatalogs.petAbilities) return { enriched: false, triedNewChunks: false };
  const abilities = capturedCatalogs.petAbilities as Record<string, unknown>;
  if (allPetAbilityColorsEnriched(abilities)) return { enriched: true, triedNewChunks: false };
  if (abilityColorEnrichInFlight) return abilityColorEnrichInFlight;

  abilityColorEnrichInFlight = (async () => {
    const { map: colorMap, triedNewChunks } = await getAbilityColorMap();
    if (!colorMap) return { enriched: false, triedNewChunks };

    const enriched: Record<string, unknown> = {};
    let updatedCount = 0;

    for (const [abilityId, abilityDef] of Object.entries(abilities)) {
      const entry = abilityDef && typeof abilityDef === 'object'
        ? { ...(abilityDef as Record<string, unknown>) }
        : {};

      if (readAbilityColorBg(entry) === null) {
        const mapped = resolveAbilityColorWithFallback(abilityId, colorMap);
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

    return { enriched: arePetAbilityColorsEnriched(enriched), triedNewChunks };
  })().finally(() => {
    abilityColorEnrichInFlight = null;
  });

  return abilityColorEnrichInFlight;
}

function areMutationColorsEnriched(catalog: Record<string, unknown>): boolean {
  return Object.values(catalog).some(
    entry => entry !== null && typeof entry === 'object' && typeof (entry as Record<string, unknown>).color === 'string',
  );
}

// Identity of the last catalog object a color pass processed. Unknown mutations
// deliberately stay colorless, so "every entry colored" can't be the done-check;
// a completeness merge replaces the object, which re-arms the pass here.
let mutationColorsEnrichedRef: unknown = null;

export async function enrichMutationColors(): Promise<EnrichmentAttempt> {
  if (!capturedCatalogs.mutationCatalog) return { enriched: false, triedNewChunks: false };
  const catalog = capturedCatalogs.mutationCatalog as Record<string, Record<string, unknown>>;
  if (mutationColorsEnrichedRef === catalog) return { enriched: true, triedNewChunks: false };
  if (mutationColorEnrichInFlight) return mutationColorEnrichInFlight;

  mutationColorEnrichInFlight = (async () => {
    const { map: colorMap, triedNewChunks } = await getMutationColorMap(Object.keys(catalog));
    if (!colorMap) return { enriched: false, triedNewChunks };

    const enriched: Record<string, unknown> = {};
    let updatedCount = 0;

    for (const [mutationId, entry] of Object.entries(catalog)) {
      const copy = entry && typeof entry === 'object' ? { ...entry } : {};
      const color = colorMap[mutationId];
      // Unknown mutations keep color undefined — renderers fall back to white.
      if (typeof copy.color !== 'string' && typeof color === 'string') {
        copy.color = color;
        updatedCount += 1;
      }
      enriched[mutationId] = copy;
    }

    if (updatedCount > 0) {
      capturedCatalogs.mutationCatalog = enriched as GameCatalogs['mutationCatalog'];
      catalogLog(`Enriched mutation colors from runtime bundle (${updatedCount} mutations).`);
      publishCatalogs();
    }

    mutationColorsEnrichedRef = capturedCatalogs.mutationCatalog;
    return { enriched: areMutationColorsEnriched(enriched), triedNewChunks };
  })().finally(() => {
    mutationColorEnrichInFlight = null;
  });

  return mutationColorEnrichInFlight;
}

export async function enrichWeatherCatalog(): Promise<EnrichmentAttempt> {
  if (isWeatherCatalogEnriched(capturedCatalogs.weatherCatalog)) return { enriched: true, triedNewChunks: false };
  if (weatherCatalogEnrichInFlight) return weatherCatalogEnrichInFlight;

  weatherCatalogEnrichInFlight = (async () => {
    const { map: weatherCatalog, triedNewChunks } = await getWeatherCatalogMap();
    if (!weatherCatalog) return { enriched: false, triedNewChunks };

    capturedCatalogs.weatherCatalog = weatherCatalog as GameCatalogs['weatherCatalog'];
    catalogLog(`Enriched weather catalog from runtime bundle (${Object.keys(weatherCatalog).length} entries).`);
    publishCatalogs();
    // Late capture: refresh the health line, or the panel keeps a stale "N/9 loaded".
    publishCatalogsHealth();
    return { enriched: true, triedNewChunks };
  })().finally(() => {
    weatherCatalogEnrichInFlight = null;
  });

  return weatherCatalogEnrichInFlight;
}

async function enrichCosmeticCatalog(): Promise<EnrichmentAttempt> {
  if (capturedCatalogs.cosmeticCatalog) return { enriched: true, triedNewChunks: false };
  if (cosmeticCatalogEnrichInFlight) return cosmeticCatalogEnrichInFlight;

  cosmeticCatalogEnrichInFlight = (async () => {
    const { catalog, triedNewChunks } = await getCosmeticCatalogFromBundle();
    if (!catalog) return { enriched: false, triedNewChunks };

    capturedCatalogs.cosmeticCatalog = catalog as GameCatalogs['cosmeticCatalog'];
    catalogLog(`Enriched cosmetic catalog from bundle (${catalog.length} items).`);
    publishCatalogs();
    publishCatalogsHealth();
    return { enriched: true, triedNewChunks };
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

export function stopMutationColorPolling(): void {
  if (!mutationColorPollTimer) return;
  clearInterval(mutationColorPollTimer);
  mutationColorPollTimer = null;
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

      const { enriched, triedNewChunks } = await enrichPetAbilityColors();
      if (enriched) {
        stopAbilityColorPolling();
        return;
      }
      // Only count an attempt when we actually fetched a previously-untried
      // chunk. The color switch ships in a lazy chunk (e.g. store-*.js) that
      // loads when its owning UI mounts — burning budget on empty polls before
      // that would spuriously fire QPM-CATALOG-003 for healthy sessions.
      if (!triedNewChunks) return;
      pollAttempts.abilityColor += 1;
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

export function startMutationColorPolling(): void {
  if (mutationColorPollTimer) return;
  pollAttempts.mutationColor = 0;

  void enrichMutationColors();

  mutationColorPollTimer = setInterval(() => {
    void (async () => {
      // Don't consume retry budget before the mutation catalog is captured.
      if (!capturedCatalogs.mutationCatalog) return;

      const { enriched, triedNewChunks } = await enrichMutationColors();
      if (enriched) {
        stopMutationColorPolling();
        return;
      }
      // See ability color polling — same lazy-chunk rationale.
      if (!triedNewChunks) return;
      pollAttempts.mutationColor += 1;
      if (pollAttempts.mutationColor >= MAX_MUTATION_COLOR_POLL_ATTEMPTS) {
        if (diagState.started) {
          diagLog.warn('QPM-CATALOG-003', {
            what: 'mutationColors',
            attempts: pollAttempts.mutationColor,
          });
        }
        stopMutationColorPolling();
      }
    })();
  }, MUTATION_COLOR_POLL_INTERVAL_MS);
}

export function startWeatherCatalogPolling(): void {
  if (weatherCatalogPollTimer) return;
  pollAttempts.weatherCatalog = 0;

  // Immediate attempt first, then bounded retry polling.
  void enrichWeatherCatalog();

  weatherCatalogPollTimer = setInterval(() => {
    void (async () => {
      // A full pass fetches every chunk and outlives the tick interval — piled-up
      // ticks awaiting the same pass must not each consume budget.
      if (weatherCatalogEnrichInFlight) return;

      const { enriched, triedNewChunks } = await enrichWeatherCatalog();
      if (enriched) {
        stopWeatherCatalogPolling();
        return;
      }
      // See ability color polling — the weather blueprint moved to a lazy chunk
      // (iconTextureResolution-*.js as of Sep 2026), so only real new-chunk work counts.
      if (!triedNewChunks) return;
      pollAttempts.weatherCatalog += 1;
      if (pollAttempts.weatherCatalog >= MAX_WEATHER_CATALOG_POLL_ATTEMPTS) {
        if (diagState.started) {
          diagLog.warn('QPM-CATALOG-003', {
            what: 'weatherCatalog',
            attempts: pollAttempts.weatherCatalog,
          });
        }
        // Give up for the session: release the shared bundle-text cache hold too,
        // or the multi-MB chunk texts would be retained until page unload.
        markBundleConsumerDone('weather');
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
      if (cosmeticCatalogEnrichInFlight) return;

      const { enriched, triedNewChunks } = await enrichCosmeticCatalog();
      if (enriched) {
        stopCosmeticCatalogPolling();
        return;
      }
      // The cosmetic array ships in a lazy chunk (truncatePlayerName-*.js as of
      // Sep 2026) — only count attempts that actually fetched a new chunk.
      if (!triedNewChunks) return;
      pollAttempts.cosmeticCatalog += 1;
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
