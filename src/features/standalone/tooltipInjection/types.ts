// src/features/standalone/tooltipInjection/types.ts
// Shared types and constants for tooltip injection subsystem.
//
// MG migrated the plant tile info from a DOM tooltip to a persistent PIXI
// card labelled `GardenInfoCardSystem`. Our overlay tracks that PIXI node's
// screen-space bounds and renders QPM rows (journal letters + sell price)
// in a DOM element positioned directly beneath it.

import type { VariantBadge } from '../../mutations/data/variantBadges';

// Re-export for convenience
export type { VariantBadge };

// ---------------------------------------------------------------------------
// Config interfaces (separate to preserve independent toggles)
// ---------------------------------------------------------------------------

export interface CropSizeConfig {
  enabled: boolean;
  showForGrowing: boolean;
  showForMature: boolean;
  showJournalIndicators: boolean;
}

export interface TileValueConfig {
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Shared slot data
// ---------------------------------------------------------------------------

export interface ResolvedSlot {
  species: string;
  targetScale: number;
  mutations: string[];
  slotId: number;
  endTime: number;
}

// ---------------------------------------------------------------------------
// Injector callback — populates the overlay container with a QPM row.
// ---------------------------------------------------------------------------

export type InjectorFn = (container: HTMLElement) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CROP_SIZE_STORAGE_KEY = 'qpm.cropSize.v1';
export const CROP_SIZE_LEGACY_KEY = 'cropSizeIndicator:config';
export const TILE_VALUE_STORAGE_KEY = 'qpm.tileValue.v1';

/** PIXI label of the persistent tile info card MG renders at the bottom of the canvas. */
export const GARDEN_INFO_CARD_LABEL = 'GardenInfoCardSystem';

/** Root DOM id for the QPM overlay that piggybacks on GardenInfoCardSystem. */
export const OVERLAY_ID = 'qpm-tile-info-overlay';

export const TOOLTIP_STYLE_ID = 'qpm-tooltip-injection-style';
export const TOOLTIP_ROW_ATTR = 'data-qpm-tooltip-row';
export const JOURNAL_BADGE_ATTR = 'data-qpm-journal-badge';
