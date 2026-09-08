/** Watchdog: if essential catalogs do not arrive in this window, fire CATALOG-001. */
export const READY_WATCHDOG_MS = 30_000;
/** Grace period after ready before non-essential gaps are reported as partial. */
export const PARTIAL_GRACE_MS = 30_000;

// Hook lifecycle — see initCatalogLoader for removal policy.
export const HOOKS_HARD_DEADLINE_MS = 120_000;
export const HOOKS_RECHECK_INTERVAL_MS = 5_000;

export const ABILITY_COLOR_POLL_INTERVAL_MS = 1000;
export const MAX_ABILITY_COLOR_POLL_ATTEMPTS = 10;
export const ABILITY_COLOR_ANCHORS = ['ProduceScaleBoost', 'RainbowGranter', 'GoldGranter'];

export const MUTATION_COLOR_POLL_INTERVAL_MS = 1000;
export const MAX_MUTATION_COLOR_POLL_ATTEMPTS = 10;

// Attempts only count when a previously-untried chunk was fetched (the blueprint
// ships in a lazy chunk), so the poll idles cheaply until new chunks appear.
export const WEATHER_CATALOG_POLL_INTERVAL_MS = 1000;
export const MAX_WEATHER_CATALOG_POLL_ATTEMPTS = 20;

export const COSMETIC_CATALOG_POLL_INTERVAL_MS = 1000;
export const MAX_COSMETIC_CATALOG_POLL_ATTEMPTS = 10;

// After this many consecutive idle poll ticks (no new-chunk fetch), one poll
// attempt is consumed — bounds wall-clock time an enrichment poll can wait for
// lazy chunks that will never arrive (spec F4 / C1 Step 2).
export const MAX_ENRICHMENT_IDLE_TICKS = 60;

// After give-up, at most this many chunk-appearance retries per consumer.
// A lazy chunk mounted long after boot (e.g. Shop UI) gets one enrichment
// attempt; anything past this cap is treated as "never arriving" (spec F4 /
// R2 Step 2).
export const MAX_ENRICHMENT_CHUNK_RETRIES = 5;

/** One-shot dex completeness audit fires this long after catalogs-ready —
 * late enough to miss the load-critical window, early enough to heal an
 * enumeration-race capture before the user opens the affected UI. */
export const DEX_AUDIT_DELAY_MS = 15_000;
