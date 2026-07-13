import type { MutationActiveWeather } from '../../../store/mutationSummary';

export interface MutationConfig {
  enabled: boolean;
  showNotifications: boolean;
  highlightPlants: boolean;
}

export type MutationLetter = 'F' | 'W' | 'C' | 'D' | 'A' | 'R' | 'G';

export interface MutationBadge {
  letter: MutationLetter;
  isBold: boolean;
}

export type MutationStage = 'wet' | 'dawn' | 'amber';

export interface MutationStageProgress {
  complete: number;
  total: number;
}

export interface PlantSlotState {
  letters: MutationLetter[];
  hasFrozen: boolean;
  hasWet: boolean;
  hasChilled: boolean;
  hasDawnlit: boolean;
  hasAmberlit: boolean;
  hasDawnbound: boolean;
  hasAmberbound: boolean;
  hasRainbow: boolean;
  hasGold: boolean;
  progress: Partial<Record<MutationStage, MutationStageProgress>>;
  /** Any mutation names from the game catalog not matched by the known set above */
  unknownMutations: string[];
}

export interface PlantData {
  name: string;
  mutations: string; // e.g., "FC", "W", "DA", "", includes combined letters from all slots
  element: Element;
  fruitCount: number; // For multi-harvest plants (e.g., +9 means 9 fruits)
  slotStates: PlantSlotState[];
  slotSource: 'inventory' | 'fallback' | 'garden';
  domMutationCounts: Record<MutationLetter, number>;
  domBoldCounts: Record<'D' | 'A', number>;
}

export type WeatherType = 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm' | 'sunny' | 'unknown';

export interface PlantMutationEvaluation {
  decision: boolean;
  pendingFruits: number;
  totalFruits: number;
  needsSnow: number;
  detail: PlantDebugDetail;
}

export interface GlobalInventoryResult {
  items: any[];
  source: string;
  hasSlotData: boolean;
}

export interface InventoryPlantEntry {
  baseIndex: number;
  id: string | null;
  slotStates: PlantSlotState[];
  raw: unknown;
  name: string | null;
  normalizedName: string | null;
  used: boolean;
}

export interface InventoryLookups {
  byIndex: Map<number, InventoryPlantEntry>;
  byId: Map<string, InventoryPlantEntry>;
  byName: Map<string, InventoryPlantEntry[]>;
}

export type PlantDebugDetail =
  | ({ strategy: 'inventory'; totalFruits: number; wetPending: number; wetFinished: number; wetNeedsSnow: number; wetProgressComplete: number; wetProgressTotal: number; domWetProgress: number; domWetNeedsSnow: number; dawnPending: number; dawnProgressComplete: number; dawnProgressTotal: number; domDawnComplete: number; amberPending: number; amberProgressComplete: number; amberProgressTotal: number; domAmberComplete: number; hasAnyDawn: boolean; hasAnyAmber: boolean; hasAnyRainbow: boolean; hasAnyGold: boolean })
  | ({ strategy: 'fallback'; fruitCount: number; frozenCount: number; wetCount: number; chilledCount: number; dawnCount: number; amberCount: number; dawnBoundCount: number; amberBoundCount: number; rainbowCount: number; goldCount: number });

export type MutationSummaryCollector = (
  weather: MutationActiveWeather,
  plant: PlantData,
  stats: { pendingFruit: number; needsSnowFruit: number; tag?: string },
) => void;
