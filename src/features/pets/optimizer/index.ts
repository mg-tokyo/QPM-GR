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
import { getCapturedGameVersion } from '../../../diagnostics/gameVersionCapture';
import { getAbilityCatalogDrift } from '../data/petAbilities/drift';
import { FORWARD_COMPAT_ABILITY_IDS } from '../data/petAbilities/definitions';

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
    // New catalog-only abilities, unclassified auto-derived ones, and forward-compat
    // entries missing from a stale catalog are the expected steady state.
    const hardcodedRegressions = d.hardcodedOnly.filter((id) => !FORWARD_COMPAT_ABILITY_IDS.has(id));
    if (hardcodedRegressions.length || d.unknownParamKeys.length || d.unknownTriggers.length) {
      // gameVersion distinguishes a stale client bundle (old catalog on an old
      // build) from a real rename on the current build.
      warnFeature('QPM-FEATURE-004', {
        what: 'ability-catalog-drift',
        gameVersion: getCapturedGameVersion(),
        ...d,
      });
    } else if (d.catalogOnly.length || d.unclassified.length || d.hardcodedOnly.length) {
      diag.debug('ability-catalog-drift (auto-resolved)', {
        catalogOnly: d.catalogOnly.length,
        unclassified: d.unclassified.length,
        forwardCompatMissing: d.hardcodedOnly.length,
        gameVersion: getCapturedGameVersion(),
      });
    }
  });
}

export function stopPetOptimizer(): void {
  driftUnsub?.();
  driftUnsub = null;
}
