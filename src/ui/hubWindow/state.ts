import { storage } from '../../utils/storage';
import type { HubGroupId } from './cards/types';

const STATE_KEY = 'qpm.hub.state.v1';

interface HubState {
  activeGroup: HubGroupId;
  expandedCards: Partial<Record<HubGroupId, string | null>>;
}

const DEFAULT_STATE: HubState = {
  activeGroup: 'trackers',
  expandedCards: {},
};

let current: HubState = { ...DEFAULT_STATE };

export function loadHubState(): HubState {
  try {
    const raw = storage.get<string | null>(STATE_KEY, null);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HubState>;
      current = {
        activeGroup: parsed.activeGroup ?? DEFAULT_STATE.activeGroup,
        expandedCards: parsed.expandedCards ?? {},
      };
    }
  } catch {
    current = { ...DEFAULT_STATE };
  }
  return current;
}

export function saveHubState(): void {
  storage.set(STATE_KEY, JSON.stringify(current));
}

export function getActiveGroup(): HubGroupId {
  return current.activeGroup;
}

export function setActiveGroup(group: HubGroupId): void {
  current.activeGroup = group;
  saveHubState();
}

export function getExpandedCard(group: HubGroupId): string | null {
  return current.expandedCards[group] ?? null;
}

export function setExpandedCard(group: HubGroupId, cardKey: string | null): void {
  current.expandedCards[group] = cardKey;
  saveHubState();
}
