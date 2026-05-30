// src/data/petCompareRules.ts
// Shared compare rule labels/types used by compare UI surfaces.

import {
  areAbilityGroupsComparable,
  type CompareAbilityGroup,
  type ProgressionStage,
} from '../compare';

export type CompareStage = ProgressionStage;
export type CompareGroupId = CompareAbilityGroup;

export const COMPARE_GROUP_FILTER_OPTIONS: Array<{ id: CompareGroupId; label: string }> = [
  { id: 'per_hour', label: 'Per Hour' },
  { id: 'sale', label: 'Sell' },
  { id: 'hatch_dollar', label: 'Hatch $' },
  { id: 'food', label: 'Food' },
  { id: 'hatch_trio', label: 'Hatch Trio' },
  { id: 'isolated', label: 'Review' },
];

export function isCompareGroupId(value: string): value is CompareGroupId {
  return COMPARE_GROUP_FILTER_OPTIONS.some((entry) => entry.id === value);
}

export function areCompareGroupsCompatible(groupA: CompareGroupId, groupB: CompareGroupId): boolean {
  return areAbilityGroupsComparable(groupA, groupB);
}

export function getCompareGroupLabel(groupId: CompareGroupId): string {
  return COMPARE_GROUP_FILTER_OPTIONS.find((entry) => entry.id === groupId)?.label ?? 'Review';
}

export function getCompareMetricLabel(groupId: CompareGroupId, isAction: boolean): string {
  if (isAction) return 'Value/Trigger';
  switch (groupId) {
    case 'per_hour':
    case 'sale':
    case 'hatch_dollar':
      return '$/hr';
    case 'food':
      return '$ saved/hr';
    case 'hatch_trio':
      return 'hatch/hr';
    default:
      return 'Review';
  }
}
