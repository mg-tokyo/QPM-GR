import { getAbilityDefinition } from '../data/petAbilities';
import { resolveCatalogFamilyKey } from './catalogParams';
import {
  OPTIMIZER_BROAD_ROLE_LABELS,
  OPTIMIZER_HIDDEN_FAMILY_KEYS,
  TIER_INDEPENDENT_FAMILY_IDS,
} from './constants';
import type { OptimizerAbilityFamilyInfo } from './types';

export function getAbilityFamilyKey(abilityId: string): string {
  const normalizedAbilityId = getAbilityDefinition(abilityId)?.id ?? abilityId;
  const catalogFamilyKey = resolveCatalogFamilyKey(normalizedAbilityId);
  if (catalogFamilyKey) {
    return catalogFamilyKey;
  }

  return normalizedAbilityId
    .replace(/_NEW$/i, '')
    .replace(/(I{1,3}|IV)$/i, '');
}

function stripOptimizerAbilityFamilySuffix(value: string): string {
  if (TIER_INDEPENDENT_FAMILY_IDS.has(value)) {
    return value.replace(/_NEW$/i, '');
  }
  return value
    .replace(/_NEW$/i, '')
    .replace(/(I{1,3}|IV)$/i, '');
}

function normalizeOptimizerFamilyLabel(value: string, preserveTier = false): string {
  let result = value.trim();
  if (!preserveTier) {
    result = result
      .replace(/\s+(?:IV|III|II|I)$/i, '')
      .replace(/\s+[1-4]$/i, '');
  }
  return result.trim();
}

function resolveOptimizerBroadRoleFamilyLabel(
  broadRoleFamilyKey: string,
  exactFamilyLabel: string,
): string {
  return OPTIMIZER_BROAD_ROLE_LABELS[broadRoleFamilyKey] ?? exactFamilyLabel;
}

export function getOptimizerAbilityFamilyInfo(
  abilityId: string,
  fallbackName = '',
): OptimizerAbilityFamilyInfo | null {
  const fallback = fallbackName.trim();
  const rawAbilityId = abilityId.trim();
  if (!rawAbilityId && !fallback) return null;

  const definition = getAbilityDefinition(rawAbilityId || fallback);
  const normalizedAbilityId = (definition?.id ?? rawAbilityId ?? fallback).trim();
  if (!normalizedAbilityId) return null;

  const exactFamilyKey = stripOptimizerAbilityFamilySuffix(normalizedAbilityId).trim().toLowerCase();
  if (!exactFamilyKey) return null;

  const preserveTier = TIER_INDEPENDENT_FAMILY_IDS.has(normalizedAbilityId);
  const exactFamilyLabelSource = definition?.name ?? fallback ?? normalizedAbilityId;
  const exactFamilyLabel = normalizeOptimizerFamilyLabel(exactFamilyLabelSource, preserveTier)
    || exactFamilyLabelSource
    || normalizedAbilityId;
  const broadRoleFamilyKeyRaw = getAbilityFamilyKey(normalizedAbilityId).trim();
  const broadRoleFamilyKey = (broadRoleFamilyKeyRaw || exactFamilyKey).trim().toLowerCase();
  const broadRoleFamilyLabel = resolveOptimizerBroadRoleFamilyLabel(
    broadRoleFamilyKey,
    exactFamilyLabel,
  );

  return {
    exactFamilyKey,
    exactFamilyLabel,
    broadRoleFamilyKey,
    broadRoleFamilyLabel,
    hidden: OPTIMIZER_HIDDEN_FAMILY_KEYS.has(exactFamilyKey),
  };
}

export function getOptimizerCompetitionFamilyKey(abilityId: string, fallbackName = ''): string {
  return getOptimizerAbilityFamilyInfo(abilityId, fallbackName)?.exactFamilyKey ?? '';
}

export function getOptimizerCompetitionFamilyLabel(abilityId: string, fallbackName = ''): string {
  return getOptimizerAbilityFamilyInfo(abilityId, fallbackName)?.exactFamilyLabel ?? fallbackName ?? abilityId;
}

export function getOptimizerBroadRoleFamilyKey(abilityId: string, fallbackName = ''): string {
  return getOptimizerAbilityFamilyInfo(abilityId, fallbackName)?.broadRoleFamilyKey ?? '';
}

export function isOptimizerAbilityVisible(abilityId: string, fallbackName = ''): boolean {
  const info = getOptimizerAbilityFamilyInfo(abilityId, fallbackName);
  return !!info && !info.hidden;
}
