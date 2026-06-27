// src/features/chargedAbilities/storage.ts
// Persists which "Others" pet cards the user has expanded across sessions,
// plus the auto-open-overlay preference.

import { storage } from '../../utils/storage';
import { PANEL_EXPANDED_STORAGE_KEY, AUTO_OPEN_OVERLAY_STORAGE_KEY } from './constants';

interface ExpandedState {
  petIds: string[];
  updatedAt: number;
}

function readSet(): Set<string> {
  const raw = storage.get<ExpandedState>(PANEL_EXPANDED_STORAGE_KEY, { petIds: [], updatedAt: 0 });
  const ids = Array.isArray(raw?.petIds)
    ? raw.petIds.filter((s): s is string => typeof s === 'string')
    : [];
  return new Set(ids);
}

export function getExpandedPetIds(): Set<string> {
  return readSet();
}

export function setPetExpanded(petSlotId: string, expanded: boolean): void {
  const set = readSet();
  if (expanded) set.add(petSlotId); else set.delete(petSlotId);
  storage.set(PANEL_EXPANDED_STORAGE_KEY, {
    petIds: [...set],
    updatedAt: Date.now(),
  } satisfies ExpandedState);
}

interface AutoOpenState {
  enabled: boolean;
  updatedAt: number;
}

export function getAutoOpenOverlay(): boolean {
  const raw = storage.get<AutoOpenState>(AUTO_OPEN_OVERLAY_STORAGE_KEY, { enabled: true, updatedAt: 0 });
  return raw?.enabled !== false;
}

export function setAutoOpenOverlay(enabled: boolean): void {
  storage.set(AUTO_OPEN_OVERLAY_STORAGE_KEY, {
    enabled,
    updatedAt: Date.now(),
  } satisfies AutoOpenState);
}
