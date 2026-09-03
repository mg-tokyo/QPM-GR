import { diag, publishOk, warnFeature } from './_diagnostics';
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
    // Only degrade on regressions the auto-resolver can't handle: hardcoded ability
    // that vanished, param key no rule matches, or a trigger family we don't score.
    // New catalog-only abilities and unclassified auto-derived ones are the expected
    // steady state and stay silent (debug-log only).
    if (d.hardcodedOnly.length || d.unknownParamKeys.length || d.unknownTriggers.length) {
      warnFeature('QPM-FEATURE-004', { what: 'ability-catalog-drift', ...d });
    } else if (d.catalogOnly.length || d.unclassified.length) {
      diag.debug('ability-catalog-drift (auto-resolved)', {
        catalogOnly: d.catalogOnly.length,
        unclassified: d.unclassified.length,
      });
    }
  });
}

export function stopPetOptimizer(): void {
  driftUnsub?.();
  driftUnsub = null;
}
