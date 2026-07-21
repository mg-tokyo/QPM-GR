// src/features/standalone/tooltipInjection/types.ts
// Shared types and constants for tooltip injection subsystem.
//
// MG migrated the plant tile info to a PIXI system. The parent container is
// `GardenInfoCardSystem`, which stacks (top-to-bottom):
//   1. GardenInfoActionToggles
//   2. GardenInfoPlantAbilities  ← ability hover tooltip lives above this
//   3. GardenInfoOrientControls
//   4. GardenInfoCardRow → GardenInfoObjectCard  ← the actual tile card
//
// We anchor to `GardenInfoObjectCard` (the innermost bottom card, not the
// whole system) so our overlay sits directly above the tile card without
// colliding with the ability panel or its hover tooltip.

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
  /** Unlogged-variant badge rendering: game UI icon sprites or letter glyphs. */
  journalBadgeStyle: 'icons' | 'letters';
}

export interface TileValueConfig {
  enabled: boolean;
}

export interface TileEtaConfig {
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

export interface ResolvedEgg {
  eggId: string;
  maturedAt: number;
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
export const TILE_ETA_STORAGE_KEY = 'qpm.tileEta.v1';

/**
 * Whole tile info panel — includes the object card AND the ability chip
 * section above it, so anchoring above these bounds naturally puts the
 * overlay above the ability chip too. Confirmed findable in the PIXI tree
 * (debug probe 2026-07-07).
 */
export const GARDEN_INFO_CARD_LABEL = 'GardenInfoCardSystem';

/**
 * Inner popup child of `PixiTooltip`. Critical: MG creates ~27 PixiTooltip
 * containers (one per registered hover target) that all stay `visible=true`
 * forever. Only the inner `TooltipPopup` toggles visibility on hover
 * (PixiTooltip.ts:148-149 — starts `visible=false`). Scanning by this label
 * with a visibility filter gives us only *actively-showing* tooltips.
 */
export const PIXI_TOOLTIP_LABEL = 'TooltipPopup';

/** Root DOM id for the QPM overlay that piggybacks on GardenInfoCardSystem. */
export const OVERLAY_ID = 'qpm-tile-info-overlay';

export const TOOLTIP_STYLE_ID = 'qpm-tooltip-injection-style';
export const TOOLTIP_ROW_ATTR = 'data-qpm-tooltip-row';
export const JOURNAL_BADGE_ATTR = 'data-qpm-journal-badge';

// Inner card node label (distinct from GARDEN_INFO_CARD_LABEL which is the
// whole HUD system). Verified at
// scraped-data/BetaGameSourceFiles/gg-preview-pr-2994-app/preview.magicgarden.gg/
// src/games/Quinoa/components/QuinoaCanvas/systems/gardenInfo/ObjectCardSection.ts:226
export const OBJECT_CARD_LABEL = 'GardenInfoObjectCard';

/** Root DOM id for the QPM lock badge pinned to the object card's top-right. */
export const LOCK_BADGE_ID = 'qpm-tile-info-lock';

export type { TileLockContext } from '../../locker/tileLockCheck';
