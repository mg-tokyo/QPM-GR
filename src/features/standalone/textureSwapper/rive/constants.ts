// src/features/standalone/textureSwapper/rive/constants.ts
// Immutable runtime constants for the Rive pipeline. Extracted from
// riveAdapter.ts during the 2026-06-27 perf refactor (PR #1).
//
// The Rainbow shader sources (RAINBOW_VERTEX_SOURCE / RAINBOW_FRAGMENT_SOURCE)
// are NOT here — they duplicated existing exports in riveFilters.ts. PR #5
// task 21 of the perf plan deletes the duplicates and routes rainbow-filter.ts
// through riveFilters.ts. Until then the duplicate shader sources stay inline
// in rainbow-filter.ts as a temporary home.

/**
 * The 5 Rive-backed decor IDs come from
 * scraped-data/BetaGameSourceFiles/Thundershop/.../decorRenderDex.ts:53-74.
 */
export const RIVE_DECOR_IDS = [
  'WoodWindmill',
  'MarbleFountain',
  'StoneBirdbath',
  'WindSpinner',
  'WindTurner',
] as const;

export const RIVE_DECOR_LOWER = new Set(RIVE_DECOR_IDS.map((id) => id.toLowerCase()));

/** Rainbow lite (Phase 4a) gradient colors. */
export const RAINBOW_COLORS = ['#FF1744', '#FF9100', '#FFEA00', '#00E676', '#2979FF', '#D500F9'] as const;

export const RAINBOW_ANGLE_DEG = 130;

/**
 * Overlay alpha. With blendMode='color' the overlay does HSL color blending,
 * matching the game's RainbowFilter math. Reduced from 1.0 because at full
 * alpha the hue transfer was too intense on pets.
 */
export const RAINBOW_ALPHA = 0.55;

/** Fixed gradient texture size. Sprite width/height setters scale it on screen. */
export const GRADIENT_REF_SIZE = 256;
