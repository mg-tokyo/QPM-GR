export interface PetManualOverride {
  xp?: number | null;
  targetScale?: number | null;
  strength?: number | null;
}

export interface ManualOverridesStorage {
  [petKey: string]: PetManualOverride;
}

export type TurtleTimerStatus = 'disabled' | 'no-data' | 'no-crops' | 'no-eggs' | 'no-turtles' | 'estimating';

export type TurtleTimerFocus = 'latest' | 'earliest' | 'specific';

export type TurtleAbilityKind = 'plant' | 'egg';

export type TurtleSupportKind = 'restore' | 'slow';

export interface TurtleTimerConfig {
  enabled?: boolean;
  includeBoardwalk?: boolean;
  minActiveHungerPct?: number;
  fallbackTargetScale?: number;
  focus?: TurtleTimerFocus;
  focusTargetTileId?: string | null;
  focusTargetSlotIndex?: number | null;
  eggFocus?: TurtleTimerFocus;
  eggFocusTargetTileId?: string | null;
  eggFocusTargetSlotIndex?: number | null;
}

export interface TurtleResolvedConfig {
  enabled: boolean;
  includeBoardwalk: boolean;
  minActiveHungerPct: number;
  fallbackTargetScale: number;
  focus: TurtleTimerFocus;
  maxTargetScale: number;
  focusTargetTileId: string | null;
  focusTargetSlotIndex: number | null;
  eggFocus: TurtleTimerFocus;
  eggFocusTargetTileId: string | null;
  eggFocusTargetSlotIndex: number | null;
}

export interface ResolvedGrowthAbility {
  kind: 'plant' | 'egg';
  abilityId: string;
  baseProbability: number;
  effectMinutesPerProc: number;
}

export interface GardenSlotEstimate {
  tileId: string;
  slotIndex: number;
  species: string | null;
  seedSpecies: string | null;
  plantSpecies: string | null;
  eggId: string | null;
  eggSpecies: string | null;
  boardwalk: boolean;
  endTime: number | null;
  readyAt: number | null;
  plantedAt: number | null;
  slotType: string | null;
  slotCategory: string | null;
  objectType: string | null;
  tileObjectType: string | null;
  tileCategory: string | null;
  slotKind: string | null;
}

export interface TurtleContribution {
  ability: TurtleAbilityKind;
  abilityNames: string[];
  slotIndex: number;
  name: string | null;
  species: string | null;
  mutations: string[];
  hungerPct: number | null;
  xp: number | null;
  targetScale: number;
  baseScore: number;
  rateContribution: number;
  perHourReduction: number;
  reductionPerProc: number;
  missingStats: boolean;
}

export interface SupportAbilityBreakdown {
  abilityName: string;
  normalizedName: string;
  perTriggerPct: number | null;
  slowdownPct: number | null;
  triggersPerHour: number | null;
  pctPerHour: number | null;
  probabilityPerMinute: number | null;
}

export interface TurtleSupportEntry {
  type: TurtleSupportKind;
  abilityNames: string[];
  slotIndex: number;
  name: string | null;
  species: string | null;
  hungerPct: number | null;
  active: boolean;
  xp: number | null;
  targetScale: number;
  baseScore: number;
  missingStats: boolean;
  abilityDetails: SupportAbilityBreakdown[];
  totalRestorePerTriggerPct: number;
  totalRestorePerHourPct: number;
  totalTriggersPerHour: number;
  totalSlowPct: number;
}

export interface TurtleTimerChannel {
  status: TurtleTimerStatus;
  trackedSlots: number;
  growingSlots: number;
  maturedSlots: number;
  contributions: TurtleContribution[];
  expectedMinutesRemoved: number | null;
  effectiveRate: number | null;
  naturalMsRemaining: number | null;
  adjustedMsRemaining: number | null;
  minutesSaved: number | null;
  focusSlot: (GardenSlotEstimate & { remainingMs: number | null }) | null;
}

export interface TurtleFocusOption {
  key: string;
  tileId: string;
  slotIndex: number;
  species: string | null;
  boardwalk: boolean;
  endTime: number | null;
  remainingMs: number | null;
}

export interface TurtleTimerSupportSummary {
  restoreCount: number;
  restoreActiveCount: number;
  slowCount: number;
  slowActiveCount: number;
  restorePctTotal: number;
  restorePctActive: number;
  restorePctPerHourTotal: number;
  restorePctPerHourActive: number;
  restoreTriggersPerHourTotal: number;
  restoreTriggersPerHourActive: number;
  slowPctTotal: number;
  slowPctActive: number;
  entries: TurtleSupportEntry[];
}

export interface TurtleTimerState {
  enabled: boolean;
  now: number;
  includeBoardwalk: boolean;
  focus: TurtleTimerFocus;
  focusTargetKey: string | null;
  focusTargetAvailable: boolean;
  eggFocus: TurtleTimerFocus;
  eggFocusTargetKey: string | null;
  eggFocusTargetAvailable: boolean;
  minActiveHungerPct: number;
  fallbackTargetScale: number;
  availableTurtles: number;
  hungerFilteredCount: number;
  turtlesMissingStats: number;
  plant: TurtleTimerChannel;
  plantTargets: TurtleFocusOption[];
  egg: TurtleTimerChannel;
  eggTargets: TurtleFocusOption[];
  support: TurtleTimerSupportSummary;
}

export interface CompletionLogEntry {
  id: string;
  type: 'plant' | 'egg';
  species: string;
  tileId: string;
  slotIndex: number;
  startedAt: number;
  completedAt: number;
  estimatedDuration: number;
  actualDuration: number;
  hadTurtles: boolean;
}

export interface TurtlePetStats {
  xp: number | null;
  targetScale: number;
  baseScore: number;
  missingStats: boolean;
}

export interface DebugEggDetectionOptions {
  includeRaw?: boolean;
  focusTileId?: string | null;
  limit?: number;
}
