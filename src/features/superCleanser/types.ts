export type FilterMode = 'any' | 'all';

export interface SlotView {
  slotId: number;
  species: string;
  mutations: readonly string[];
  weatherMutations: readonly string[];
}

export interface SuperCleanseSettings {
  enabled: boolean;
  autoOpenPanel: boolean;
  filterMode: FilterMode;
  filterMutations: readonly string[];
}

export interface SuperCleanseSnapshot {
  holdingCleanser: boolean;
  currentTileIdx: number | null;
  hoveredSlotId: number | null;
  hoveredWeatherSet: readonly string[];
  slotsOnTile: readonly SlotView[];
}
