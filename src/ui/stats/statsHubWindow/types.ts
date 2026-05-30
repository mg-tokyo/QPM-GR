// src/ui/statsHubWindow/types.ts
// Shared type definitions for the Stats Hub window.

export interface SlotEntry {
  species: string;
  mutations: string[];
  endTime: number | null;
  fruitCount: number;
  /** In-garden targetScale (becomes scale at harvest). Defaults to 1 if absent. */
  targetScale: number;
  /** Species-specific maximum scale (from slot data, catalog lookup, or 2.0 fallback). */
  maxScale: number;
  /** Size percent 50–100, where 100 = max size (targetScale >= maxScale for this species). */
  sizePercent: number;
}

export interface TileEntry {
  tileKey: string;
  plantedAt: number | null;
  slots: SlotEntry[];
}

export interface StatsHubFilters {
  speciesFilters?: string[];
  mutationFilters?: string[];
  maxSizeOnly?: boolean;
  eggsView?: 'session' | 'lifetime';
}

export type SectionFilterSource = 'remaining' | 'complete' | null;
