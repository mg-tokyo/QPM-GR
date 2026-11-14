// src/ui/statsHubWindow/types.ts
// Shared type definitions for the Stats Hub window.

export type { SlotEntry, TileEntry } from '../../../features/garden/gardenTiles';

export interface StatsHubFilters {
  speciesFilters?: string[];
  mutationFilters?: string[];
  maxSizeOnly?: boolean;
  eggsView?: 'session' | 'lifetime';
}

export type SectionFilterSource = 'remaining' | 'complete' | null;
