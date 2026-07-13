import type { AbilityDefinition } from '../data/petAbilities';

export interface ComparePetInput {
  id: string;
  species: string;
  strength: number | null;
  targetScale: number | null;
  abilities: string[];
  mutations?: string[];
}

export type ProgressionStage = 'early' | 'mid' | 'late';

export interface ProgressionSignalSnapshot {
  rbwCount: number | null;
  rainbowGranterPetCount: number;
  petPowerBand: number | null;
  storage: {
    petHutch: number | null;
    seedSilo: number | null;
    decorShed: number | null;
  };
  celestial: {
    starweaver: number | null;
    moon: number | null;
    dawn: number | null;
  };
  eggs: number | null;
  coins: number | null;
}

export interface ProgressionStageSnapshot {
  stage: ProgressionStage;
  score: number;
  signals: ProgressionSignalSnapshot;
}

export type CompareAbilityGroup = 'per_hour' | 'sale' | 'hatch_dollar' | 'food' | 'hatch_trio' | 'isolated';
export type ActionBucketKey = 'harvest' | 'sell' | 'hatch';

export interface AbilityContribution {
  rawAbilityId: string;
  abilityId: string;
  name: string;
  definition: AbilityDefinition | null;
  group: CompareAbilityGroup;
  isAction: boolean;
  isReview: boolean;
  isIgnored: boolean;
  triggerLabel: string;
  actionBucket: ActionBucketKey | null;
  procsPerHour: number;
  chancePercent: number;
  impactPerHour: number;
  valuePerTrigger: number;
  expectedValuePerTrigger: number;
  expectedValuePerHour: number;
  scoreValue: number;
  unit: 'coins' | 'minutes' | 'xp' | 'none';
}

export interface ActionBucketSummary {
  key: ActionBucketKey;
  triggerLabel: string;
  combinedChancePercent: number;
  expectedValuePerTrigger: number;
  entries: AbilityContribution[];
}

export interface PetCompareProfile {
  petId: string;
  stage: ProgressionStage;
  score: number;
  reviewCount: number;
  abilities: AbilityContribution[];
  byAbilityId: Map<string, AbilityContribution>;
  totals: {
    coinsPerHour: number;
    plantMinutesPerHour: number;
    eggMinutesPerHour: number;
    xpPerHour: number;
  };
  actionBuckets: Record<ActionBucketKey, ActionBucketSummary>;
}

export interface TeamCompareProfile {
  stage: ProgressionStageSnapshot;
  pets: PetCompareProfile[];
  totals: {
    coinsPerHour: number;
    plantMinutesPerHour: number;
    eggMinutesPerHour: number;
    xpPerHour: number;
  };
  actionBuckets: Record<ActionBucketKey, ActionBucketSummary>;
  score: number;
}

export interface OptimizerAbilityFamilyInfo {
  exactFamilyKey: string;
  exactFamilyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  hidden: boolean;
}
