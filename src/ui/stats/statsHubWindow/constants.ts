// src/ui/statsHubWindow/constants.ts
// Named constants shared across Stats Hub tabs.

export const RAINBOW_GRADIENT = 'linear-gradient(90deg,#e11d48,#f97316,#eab308,#22c55e,#3b82f6,#a855f7)';

/** Base water mutations — Wet and Chilled */
export const BASE_WATER_MUTS = new Set(['wet', 'chilled']);

/** Upgraded water mutations — Frozen */
export const UPGRADED_WATER_MUTS = new Set(['frozen']);

/** Upgraded Dawn mutations — Dawncharged (display: Dawnbound) */
export const UPGRADED_DAWN_MUTS = new Set(['dawncharged']);

/** Upgraded Amber mutations — Ambercharged (display: Amberbound) */
export const UPGRADED_AMBER_MUTS = new Set(['ambercharged']);

/** Hardcoded fallback — used when the mutation catalog isn't loaded yet */
export const FILTER_MUTATIONS_FALLBACK: readonly string[] = [
  'Frozen', 'Wet', 'Chilled', 'Thunderstruck',
  'Dawnlit', 'Dawnbound', 'Amberlit', 'Amberbound',
  'Rainbow', 'Gold',
];

/** Storage key for persisted Stats Hub filters */
export const STATS_HUB_FILTERS_KEY = 'qpm.statsHub.filters.v1';

/** Storage key for persisted active tab */
export const STATS_HUB_ACTIVE_TAB_KEY = 'qpm.statsHub.activeTab.v1';

/** Currency type label mapping */
export const CURRENCY_LABELS: Record<string, string> = {
  coins: 'Coins', credits: 'Credits', dust: 'Magic Dust',
};
