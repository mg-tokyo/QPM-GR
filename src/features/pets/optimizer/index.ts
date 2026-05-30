import { log } from '../../../utils/logger';
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

export function startPetOptimizer(): void {
  loadOptimizerConfig();
  log('Pet Optimizer initialized');
}
