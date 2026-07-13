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

export const WEATHER_CATALOG_POLL_INTERVAL_MS = 500;
export const MAX_WEATHER_CATALOG_POLL_ATTEMPTS = 20;

export const COSMETIC_CATALOG_POLL_INTERVAL_MS = 1000;
export const MAX_COSMETIC_CATALOG_POLL_ATTEMPTS = 10;
