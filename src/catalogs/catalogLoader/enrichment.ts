// Post-capture enrichment: ability colors, weather catalog, cosmetic catalog.
// Each has an immediate attempt + bounded retry polling.

import { DEFAULT_ABILITY_COLOR, getAbilityColorMap, type RuntimeAbilityColor } from '../logic/abilityColors';
import { getMutationColorMap } from '../logic/mutationColors';
import { getWeatherCatalogMap } from '../logic/weatherCatalog';
import { getCosmeticCatalogFromBundle } from '../logic/cosmeticCatalog';
import { markBundleConsumerDone, onNewBundleChunk, registerBundleConsumer } from '../logic/bundleParser';
import { readSharedGlobal } from '../../core/pageContext';
import type { GameCatalogs } from '../types';
import {
  ABILITY_COLOR_ANCHORS,
  ABILITY_COLOR_POLL_INTERVAL_MS,
  COSMETIC_CATALOG_POLL_INTERVAL_MS,
  MAX_ABILITY_COLOR_POLL_ATTEMPTS,
  MAX_COSMETIC_CATALOG_POLL_ATTEMPTS,
  MAX_ENRICHMENT_CHUNK_RETRIES,
  MAX_ENRICHMENT_IDLE_TICKS,
  MAX_MUTATION_COLOR_POLL_ATTEMPTS,
  MAX_WEATHER_CATALOG_POLL_ATTEMPTS,
  MUTATION_COLOR_POLL_INTERVAL_MS,
  WEATHER_CATALOG_POLL_INTERVAL_MS,
} from './constants';
import { diagLog, diagState, publishCatalogsHealth } from './diagnostics';
import { capturedCatalogs, catalogLog, publishCatalogs } from './state';

type PollerKey = 'abilityColor' | 'mutationColor' | 'weatherCatalog' | 'cosmeticCatalog';

// Live holder — retry budgets reset from scan.ts (ability) and debug.ts (weather).
export const pollAttempts: Record<PollerKey, number> = {
  abilityColor: 0,
  mutationColor: 0,
  weatherCatalog: 0,
  cosmeticCatalog: 0,
};

// Consecutive idle poll ticks (no new-chunk fetch, or prerequisite catalog
// still absent). At MAX_ENRICHMENT_IDLE_TICKS the poll gives up on that tick
// so give-up wall-clock is bounded (spec D7).
const idleTicks: Record<PollerKey, number> = {
  abilityColor: 0,
  mutationColor: 0,
  weatherCatalog: 0,
  cosmeticCatalog: 0,
};

// After give-up, one retry per newly loaded game chunk that the enricher
// actually fetched, capped so a page that keeps loading chunks can't loop.
const chunkRetries: Record<PollerKey, number> = {
  abilityColor: 0,
  mutationColor: 0,
  weatherCatalog: 0,
  cosmeticCatalog: 0,
};

interface EnrichmentAttempt {
  enriched: boolean;
  triedNewChunks: boolean;
}

let abilityColorEnrichInFlight: Promise<EnrichmentAttempt> | null = null;
let mutationColorEnrichInFlight: Promise<EnrichmentAttempt> | null = null;
let weatherCatalogEnrichInFlight: Promise<EnrichmentAttempt> | null = null;
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


interface PollerSpec {
  key: PollerKey;
  what: 'abilityColors' | 'mutationColors' | 'weatherCatalog' | 'cosmeticCatalog';
  intervalMs: number;
  maxAttempts: number;
  /** bundleTextCache hold released at give-up and around each retry; null when
   * the enricher keeps its own text cache (cosmetics). */
  consumer: 'ability-colors' | 'mutation-colors' | 'weather' | null;
  /** Base catalog the enricher needs. Ticks wait for it (idle-counted); a late
   * capture restarts the poller via start(). */
  ready?: () => boolean;
  inFlight: () => boolean;
  run: () => Promise<EnrichmentAttempt>;
  onGiveUp?: () => void;
}

interface EnrichmentPoller { start(): void; stop(): void }

// Raw setInterval on purpose: timerManager is a rAF loop and never ticks in a
// hidden tab, but a user who boots in a background tab still needs the
// bounded (≤ 60 s) enrichment pass to finish.
function createEnrichmentPoller(spec: PollerSpec): EnrichmentPoller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let chunkRetry: (() => void) | null = null;

  const releaseRetry = (): void => {
    if (chunkRetry) { chunkRetry(); chunkRetry = null; }
  };

  const stop = (): void => {
    if (timer) { clearInterval(timer); timer = null; }
    releaseRetry();
  };

  const installChunkRetry = (): void => {
    if (chunkRetry) return;
    chunkRetries[spec.key] = 0;
    chunkRetry = onNewBundleChunk(() => {
      void (async () => {
        if (spec.ready && !spec.ready()) return;
        // A hit cached during this retry must be released again: give-up already
        // dropped the hold, so this register/release pair keeps the "text cache
        // held iff a consumer is registered" invariant when a new chunk lands.
        if (spec.consumer) registerBundleConsumer(spec.consumer);
        try {
          const { enriched, triedNewChunks } = await spec.run();
          if (enriched) { releaseRetry(); return; }
          // Only a chunk the enricher actually fetched spends a retry — analytics
          // and extension scripts also show up as `.js` resource entries.
          if (!triedNewChunks) return;
          chunkRetries[spec.key] += 1;
          if (chunkRetries[spec.key] >= MAX_ENRICHMENT_CHUNK_RETRIES) releaseRetry();
        } finally {
          if (spec.consumer) markBundleConsumerDone(spec.consumer);
        }
      })();
    });
  };

  // `warn` is false while the prerequisite never arrived: nothing was attempted,
  // so QPM-CATALOG-003 would blame the enricher for a missing base catalog.
  const giveUp = (warn: boolean): void => {
    if (warn) {
      if (diagState.started) {
        diagLog.warn('QPM-CATALOG-003', { what: spec.what, attempts: pollAttempts[spec.key], idleTicks: idleTicks[spec.key] });
      }
      spec.onGiveUp?.();
    }
    if (spec.consumer) markBundleConsumerDone(spec.consumer);
    stop();
    installChunkRetry();
  };

  const tick = async (): Promise<void> => {
    // A full pass fetches every chunk and can outlive the interval — piled-up
    // ticks awaiting the same pass must not each consume budget.
    if (spec.inFlight()) return;
    if (spec.ready && !spec.ready()) {
      idleTicks[spec.key] += 1;
      if (idleTicks[spec.key] >= MAX_ENRICHMENT_IDLE_TICKS) giveUp(false);
      return;
    }
    const { enriched, triedNewChunks } = await spec.run();
    if (enriched) { stop(); return; }
    // Attempts only count real new-chunk work (lazy chunks load when their UI
    // mounts); the idle cap turns a plateau into an immediate give-up instead.
    if (!triedNewChunks) {
      idleTicks[spec.key] += 1;
      if (idleTicks[spec.key] < MAX_ENRICHMENT_IDLE_TICKS) return;
      pollAttempts[spec.key] = spec.maxAttempts - 1;
    } else {
      idleTicks[spec.key] = 0;
    }
    pollAttempts[spec.key] += 1;
    if (pollAttempts[spec.key] >= spec.maxAttempts) giveUp(true);
  };

  // Idempotent and budget-resetting: capture sites call it again when the base
  // catalog lands so a poller that parked while waiting resumes with full budget.
  const start = (): void => {
    pollAttempts[spec.key] = 0;
    idleTicks[spec.key] = 0;
    releaseRetry();
    void spec.run();
    if (timer) return;
    timer = setInterval(() => { void tick(); }, spec.intervalMs);
  };

  return { start, stop };
}

const abilityColorPoller = createEnrichmentPoller({
  key: 'abilityColor',
  what: 'abilityColors',
  intervalMs: ABILITY_COLOR_POLL_INTERVAL_MS,
  maxAttempts: MAX_ABILITY_COLOR_POLL_ATTEMPTS,
  consumer: 'ability-colors',
  ready: () => !!capturedCatalogs.petAbilities,
  inFlight: () => abilityColorEnrichInFlight !== null,
  run: enrichPetAbilityColors,
  onGiveUp: () => {
    if (shouldLogAbilityColorDebug()) catalogLog('Ability color enrichment timed out, using fallback colors.');
  },
});

const mutationColorPoller = createEnrichmentPoller({
  key: 'mutationColor',
  what: 'mutationColors',
  intervalMs: MUTATION_COLOR_POLL_INTERVAL_MS,
  maxAttempts: MAX_MUTATION_COLOR_POLL_ATTEMPTS,
  consumer: 'mutation-colors',
  ready: () => !!capturedCatalogs.mutationCatalog,
  inFlight: () => mutationColorEnrichInFlight !== null,
  run: enrichMutationColors,
});

const weatherCatalogPoller = createEnrichmentPoller({
  key: 'weatherCatalog',
  what: 'weatherCatalog',
  intervalMs: WEATHER_CATALOG_POLL_INTERVAL_MS,
  maxAttempts: MAX_WEATHER_CATALOG_POLL_ATTEMPTS,
  consumer: 'weather',
  inFlight: () => weatherCatalogEnrichInFlight !== null,
  run: enrichWeatherCatalog,
});

// Cosmetics keep their own cosmeticBundleCache (cosmeticCatalog.ts), never
// bundleTextCache, so there is no consumer hold to release.
const cosmeticCatalogPoller = createEnrichmentPoller({
  key: 'cosmeticCatalog',
  what: 'cosmeticCatalog',
  intervalMs: COSMETIC_CATALOG_POLL_INTERVAL_MS,
  maxAttempts: MAX_COSMETIC_CATALOG_POLL_ATTEMPTS,
  consumer: null,
  inFlight: () => cosmeticCatalogEnrichInFlight !== null,
  run: enrichCosmeticCatalog,
});

export function startAbilityColorPolling(): void { abilityColorPoller.start(); }
export function stopAbilityColorPolling(): void { abilityColorPoller.stop(); }
export function startMutationColorPolling(): void { mutationColorPoller.start(); }
export function stopMutationColorPolling(): void { mutationColorPoller.stop(); }
export function startWeatherCatalogPolling(): void { weatherCatalogPoller.start(); }
export function stopWeatherCatalogPolling(): void { weatherCatalogPoller.stop(); }
export function startCosmeticCatalogPolling(): void { cosmeticCatalogPoller.start(); }
export function stopCosmeticCatalogPolling(): void { cosmeticCatalogPoller.stop(); }
