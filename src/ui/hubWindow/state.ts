// src/ui/hubWindow/state.ts

import { storage } from '../../utils/storage';
import type { HubGroupId } from './cards/types';

const HUB_STATE_KEY = 'qpm.hub.state.v1';

interface HubPersistedState {
  activeGroup: HubGroupId;
  expandedCards: Partial<Record<HubGroupId, string | null>>;
}

const DEFAULT_STATE: HubPersistedState = {
  activeGroup: 'trackers',
  expandedCards: {},
};

let cached: HubPersistedState | null = null;

function load(): HubPersistedState {
  if (cached) return cached;
  const raw = storage.get<HubPersistedState | null>(HUB_STATE_KEY, null);
  if (raw && typeof raw === 'object' && 'activeGroup' in raw) {
    cached = { ...DEFAULT_STATE, ...raw };
  } else {
    cached = { ...DEFAULT_STATE };
  }
  return cached;
}

function save(): void {
  if (!cached) return;
  storage.set(HUB_STATE_KEY, cached);
}

export function loadHubState(): HubPersistedState {
  return load();
}

export function saveHubState(): void {
  save();
}

export function getActiveGroup(): HubGroupId {
  return load().activeGroup;
}

export function setActiveGroup(groupId: HubGroupId): void {
  const state = load();
  state.activeGroup = groupId;
  save();
}

export function getExpandedCard(groupId: HubGroupId): string | null {
  const state = load();
  return state.expandedCards[groupId] ?? null;
}

export function setExpandedCard(groupId: HubGroupId, cardKey: string | null): void {
  const state = load();
  state.expandedCards[groupId] = cardKey;
  save();
}
