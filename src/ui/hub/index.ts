// src/ui/hubWindow/index.ts — Public API

import type { HubGroupDef, HubGroupId } from './cards/types';
import { toggleWindow } from '../core/modalWindow';
import { renderHub } from './hubWindow';
import { setActiveGroup } from './state';

export type { HubGroupDef, HubGroupId, CardConfig, CardIcon } from './cards/types';
export type { InlineToggleConfig, ExpandableCardConfig, LauncherCardConfig } from './cards/types';

export const HUB_WINDOW_ID = 'qpm-hub';

let registeredGroups: ReadonlyArray<HubGroupDef> = [];

export function registerHubGroups(groups: ReadonlyArray<HubGroupDef>): void {
  registeredGroups = groups;
}

export function toggleHub(): void {
  // Hub is now integrated into the panel nav — this is a no-op.
  // Kept for backwards compatibility with any code that calls it.
}

export function openHubToGroup(groupId: HubGroupId): void {
  setActiveGroup(groupId);
  toggleHub();
}
