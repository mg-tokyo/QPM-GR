import { publishOk, warnFeature } from './_diagnostics';
import {
  getOptimizerConfig,
  loadOptimizerConfig,
  onAnalysisUpdate,
  protectPet,
  setOptimizerConfig,
  unprotectPet,
} from './runtime';
import {
  analyzePets,
  analyzePetsAsync,
  getOptimizerAnalysis,
  getOptimizerDebugExplain,
  getOptimizerDebugFamily,
  getOptimizerDebugSnapshot,
} from './analysis';
import { collectAllPets } from './collection';
import { calculatePetScore } from './scoring';
import { onPetAbilitiesCaptured } from '../../../catalogs/gameCatalogs';
import { getAbilityCatalogDrift } from '../data/petAbilities/drift';

export type {
  CollectedPet,
  FamilyRankSnapshot,
  OptimizerAnalysis,
  OptimizerCompareFilter,
  OptimizerConfig,
  PetComparison,
  PetLocation,
  PetScore,
  PetStatus,
  RecommendationMode,
  SlotEfficiencyBonusSummary,
  SlotEfficiencyFamilySummary,
  SlotEfficiencySupportSummary,
  TurtleCompositeSnapshot,
} from './types';

export {
  analyzePets,
  analyzePetsAsync,
  calculatePetScore,
  collectAllPets,
  getOptimizerAnalysis,
  getOptimizerConfig,
  getOptimizerDebugExplain,
  getOptimizerDebugFamily,
  getOptimizerDebugSnapshot,
  onAnalysisUpdate,
  protectPet,
  setOptimizerConfig,
  unprotectPet,
};

let driftUnsub: (() => void) | null = null;

export function startPetOptimizer(): void {
  loadOptimizerConfig();
  const cfg = getOptimizerConfig();
  publishOk('Started', {
    recommendationMode: cfg.recommendationMode,
    selectedStrategy: cfg.selectedStrategy,
    protectedPets: cfg.protectedPetIds.size,
  });

  driftUnsub?.();
  driftUnsub = onPetAbilitiesCaptured(() => {
    const d = getAbilityCatalogDrift();
    if (d.hardcodedOnly.length || d.unknownParamKeys.length || d.unknownTriggers.length) {
      warnFeature('QPM-FEATURE-004', { what: 'ability-catalog-drift', ...d });
    }
  });
}

export function stopPetOptimizer(): void {
  driftUnsub?.();
  driftUnsub = null;
}
