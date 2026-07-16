import { isCompareGroupId } from '../data/petCompareRules';
import { warnFeature } from './_diagnostics';
import { storage } from '../../../utils/storage';
import { DEFAULT_CONFIG } from './constants';
import type {
  OptimizerAnalysis,
  OptimizerCompareFilter,
  OptimizerConfig,
} from './types';

const OPTIMIZER_CONFIG_KEY = 'qpm.petOptimizer.config.v4';
const OPTIMIZER_LEGACY_CONFIG_KEYS = ['petOptimizer:config.v3', 'petOptimizer:config.v2'] as const;

let config: OptimizerConfig = { ...DEFAULT_CONFIG, protectedPetIds: new Set() };
let cachedAnalysis: OptimizerAnalysis | null = null;
let analysisTimestamp = 0;
const listeners = new Set<(analysis: OptimizerAnalysis) => void>();

interface StoredOptimizerConfig {
  selectedStrategy?: unknown;
  recommendationMode?: unknown;
  showReview?: boolean;
  showSell?: boolean;
  showAllKeeps?: boolean;
  dislikeGold?: boolean;
  showObsoleteOnly?: boolean;
  showSellOnly?: boolean;
  protectedPetIds?: string[];
}

function normalizeStoredStrategy(value: unknown): OptimizerCompareFilter {
  if (typeof value !== 'string') return 'all';
  if (value === 'all') return 'all';
  return isCompareGroupId(value) ? value : 'all';
}

function saveConfig(): void {
  storage.set(OPTIMIZER_CONFIG_KEY, {
    ...config,
    protectedPetIds: Array.from(config.protectedPetIds),
  });
}

export function loadOptimizerConfig(): void {
  const currentStored = storage.get<Partial<OptimizerConfig> & StoredOptimizerConfig>(OPTIMIZER_CONFIG_KEY);
  const legacyStored = currentStored ? null : (
    storage.get<Partial<OptimizerConfig> & StoredOptimizerConfig>(OPTIMIZER_LEGACY_CONFIG_KEYS[0])
      ?? storage.get<Partial<OptimizerConfig> & StoredOptimizerConfig>(OPTIMIZER_LEGACY_CONFIG_KEYS[1])
  );

  const stored = currentStored ?? legacyStored;
  if (!stored) return;

  const recommendationMode = stored.recommendationMode === 'specialist'
    ? 'specialist'
    : 'slot_efficiency';
  const showReview = typeof stored.showReview === 'boolean'
    ? stored.showReview
    : true;
  const showSell = typeof stored.showSell === 'boolean'
    ? stored.showSell
    : typeof stored.showSellOnly === 'boolean'
      ? stored.showSellOnly
      : true;
  const showAllKeeps = typeof stored.showAllKeeps === 'boolean'
    ? stored.showAllKeeps
    : false;
  const dislikeGold = typeof stored.dislikeGold === 'boolean'
    ? stored.dislikeGold
    : true;

  config = {
    ...DEFAULT_CONFIG,
    ...stored,
    recommendationMode,
    showReview,
    showSell,
    showAllKeeps,
    dislikeGold,
    selectedStrategy: normalizeStoredStrategy(stored.selectedStrategy),
    protectedPetIds: new Set(stored.protectedPetIds || []),
  };

  if (!currentStored && legacyStored) {
    saveConfig();
  }
}

export function getRuntimeConfig(): OptimizerConfig {
  return config;
}

export function getOptimizerConfig(): OptimizerConfig {
  return { ...config, protectedPetIds: new Set(config.protectedPetIds) };
}

export function setOptimizerConfig(updates: Partial<OptimizerConfig>): void {
  config = { ...config, ...updates };
  saveConfig();
  invalidateOptimizerAnalysisCache();
}

export function protectPet(petId: string): void {
  config.protectedPetIds.add(petId);
  saveConfig();
  invalidateOptimizerAnalysisCache();
}

export function unprotectPet(petId: string): void {
  config.protectedPetIds.delete(petId);
  saveConfig();
  invalidateOptimizerAnalysisCache();
}

export function invalidateOptimizerAnalysisCache(): void {
  cachedAnalysis = null;
  analysisTimestamp = 0;
}

export function getCachedOptimizerAnalysis(): OptimizerAnalysis | null {
  return cachedAnalysis;
}

export function getOptimizerAnalysisTimestamp(): number {
  return analysisTimestamp;
}

export function setCachedOptimizerAnalysis(analysis: OptimizerAnalysis, timestamp: number): void {
  cachedAnalysis = analysis;
  analysisTimestamp = timestamp;
}

export function onAnalysisUpdate(callback: (analysis: OptimizerAnalysis) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function notifyAnalysisUpdateListeners(analysis: OptimizerAnalysis): void {
  for (const listener of listeners) {
    try {
      listener(analysis);
    } catch (error) {
      warnFeature('QPM-FEATURE-004', { what: 'listener:analysisUpdate' }, error);
    }
  }
}
