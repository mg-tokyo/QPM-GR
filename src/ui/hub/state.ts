// src/ui/hubWindow/state.ts

import { storage } from '../../utils/storage';
import type { HubGroupId } from './cards/types';

const HUB_STATE_KEY = 'qpm.hub.state.v1';

interface HubPersistedState {
  activeGroup: HubGroupId;
  expandedCards: Partial<Record<HubGroupId, string[]>>;
  hiddenCards: Partial<Record<HubGroupId, string[]>>;
}

const DEFAULT_STATE: HubPersistedState = {
  activeGroup: 'trackers',
  expandedCards: {},
  hiddenCards: {},
};

let cached: HubPersistedState | null = null;

function load(): HubPersistedState {
  if (cached) return cached;
  const raw = storage.get<Record<string, unknown> | null>(HUB_STATE_KEY, null);
  if (raw && typeof raw === 'object' && 'activeGroup' in raw) {
    // Migrate old single-string format to array format
    const expandedCards: Partial<Record<HubGroupId, string[]>> = {};
    const rawExpanded = (raw as Record<string, unknown>).expandedCards;
    if (rawExpanded && typeof rawExpanded === 'object') {
      for (const [key, val] of Object.entries(rawExpanded as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          expandedCards[key as HubGroupId] = val as string[];
        } else if (typeof val === 'string') {
          expandedCards[key as HubGroupId] = [val];
        }
        // null → empty (no entry)
      }
    }
    // Migrate hiddenCards (may be absent in older state)
    const hiddenCards: Partial<Record<HubGroupId, string[]>> = {};
    const rawHidden = (raw as Record<string, unknown>).hiddenCards;
    if (rawHidden && typeof rawHidden === 'object') {
      for (const [key, val] of Object.entries(rawHidden as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          hiddenCards[key as HubGroupId] = val as string[];
        }
      }
    }
    cached = {
      activeGroup: raw.activeGroup as HubGroupId,
      expandedCards,
      hiddenCards,
    };
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

export function getExpandedCards(groupId: HubGroupId): string[] {
  const state = load();
  return state.expandedCards[groupId] ?? [];
}

export function setExpandedCard(groupId: HubGroupId, cardKey: string, expanded: boolean): void {
  const state = load();
  const current = state.expandedCards[groupId] ?? [];
  if (expanded) {
    if (!current.includes(cardKey)) {
      state.expandedCards[groupId] = [...current, cardKey];
    }
  } else {
    state.expandedCards[groupId] = current.filter(k => k !== cardKey);
  }
  save();
}

export function getHiddenCards(groupId: HubGroupId): string[] {
  const state = load();
  return state.hiddenCards[groupId] ?? [];
}

export function setCardHidden(groupId: HubGroupId, cardKey: string, hidden: boolean): void {
  const state = load();
  const current = state.hiddenCards[groupId] ?? [];
  if (hidden) {
    if (!current.includes(cardKey)) {
      state.hiddenCards[groupId] = [...current, cardKey];
    }
  } else {
    state.hiddenCards[groupId] = current.filter(k => k !== cardKey);
  }
  save();
}
