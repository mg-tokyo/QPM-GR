import { normalizeSpeciesKey } from '../../utils/helpers';
import type { PetFeedPolicy, PetItemFeedOverride } from '../../types/petTeams';
import { store, saveFeedPolicy } from './state';

export function getFeedPolicy(): PetFeedPolicy {
  const petItemOverrides: PetFeedPolicy['petItemOverrides'] = {};
  for (const [petItemId, value] of Object.entries(store.feedPolicy.petItemOverrides)) {
    petItemOverrides[petItemId] = {
      ...value,
      ...(Array.isArray(value.allowed) ? { allowed: [...value.allowed] } : {}),
      ...(Array.isArray(value.forbidden) ? { forbidden: [...value.forbidden] } : {}),
    };
  }
  return {
    petItemOverrides,
    updatedAt: store.feedPolicy.updatedAt,
  };
}

export function setFeedPolicyOverride(petItemId: string, override: Partial<PetItemFeedOverride>): void {
  const normalizedPetItemId = String(petItemId ?? '').trim();
  if (!normalizedPetItemId) return;

  const next: PetItemFeedOverride = {
    petItemId: normalizedPetItemId,
  };

  if (typeof override.displayLabel === 'string' && override.displayLabel.trim().length > 0) {
    next.displayLabel = override.displayLabel.trim();
  }

  if (Array.isArray(override.allowed)) {
    next.allowed = override.allowed
      .map((entry) => normalizeSpeciesKey(entry))
      .filter((entry): entry is string => !!entry);
  }

  if (Array.isArray(override.forbidden)) {
    next.forbidden = override.forbidden
      .map((entry) => normalizeSpeciesKey(entry))
      .filter((entry): entry is string => !!entry);
  }

  if (typeof override.preferred === 'string') {
    const preferred = normalizeSpeciesKey(override.preferred);
    if (preferred) {
      next.preferred = preferred;
    }
  }

  const hasAllowed = Array.isArray(next.allowed);
  const hasForbidden = Array.isArray(next.forbidden);
  const hasPreferred = typeof next.preferred === 'string' && next.preferred.length > 0;
  const hasDisplayLabel = typeof next.displayLabel === 'string' && next.displayLabel.length > 0;
  if (!hasAllowed && !hasForbidden && !hasPreferred && !hasDisplayLabel) {
    delete store.feedPolicy.petItemOverrides[normalizedPetItemId];
  } else {
    store.feedPolicy.petItemOverrides[normalizedPetItemId] = next;
  }
  saveFeedPolicy();
}

export function clearFeedPolicyOverride(petItemId: string): void {
  const normalizedPetItemId = String(petItemId ?? '').trim();
  if (!normalizedPetItemId) return;
  delete store.feedPolicy.petItemOverrides[normalizedPetItemId];
  saveFeedPolicy();
}
