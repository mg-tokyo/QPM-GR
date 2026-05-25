// src/features/tooltipInjection/types.ts
// Shared types and constants for tooltip injection subsystem.

import type { VariantBadge } from '../../data/variantBadges';

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
// Injector callback
// ---------------------------------------------------------------------------

export type InjectorFn = (container: HTMLElement, cropNameEl: HTMLElement) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CROP_SIZE_STORAGE_KEY = 'qpm.cropSize.v1';
export const CROP_SIZE_LEGACY_KEY = 'cropSizeIndicator:config';
export const TILE_VALUE_STORAGE_KEY = 'qpm.tileValue.v1';

export const TOOLTIP_SELECTOR = '.McFlex.css-fsggty';
export const TOOLTIP_STYLE_ID = 'qpm-tooltip-injection-style';
export const TOOLTIP_ROW_ATTR = 'data-qpm-tooltip-row';
export const JOURNAL_BADGE_ATTR = 'data-qpm-journal-badge';
