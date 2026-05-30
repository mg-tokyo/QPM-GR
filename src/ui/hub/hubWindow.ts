// src/ui/hubWindow/hubWindow.ts

import type { HubGroupDef, HubGroupId } from './cards/types';
import { renderHubSidebar } from './hubSidebar';
import { renderHubGroup, type HubGroupResult } from './hubGroup';
import { getActiveGroup, setActiveGroup } from './state';

export interface HubRenderResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderHub(groups: ReadonlyArray<HubGroupDef>): HubRenderResult {
  const cleanups: Array<() => void> = [];
  let currentGroup: HubGroupResult | null = null;

  const shell = document.createElement('div');
  shell.style.cssText = [
    'display:flex',
    'flex-direction:row',
    'width:100%',
    'height:100%',
    'min-height:500px',
    'min-width:600px',
    'overflow:hidden',
  ].join(';');

  // Content area (scrollable)
  const contentArea = document.createElement('div');
  contentArea.style.cssText = [
    'flex:1',
    'min-width:0',
    'overflow-y:auto',
    'overflow-x:hidden',
  ].join(';');

  const showGroup = (groupId: HubGroupId): void => {
    // Clean up previous group
    if (currentGroup) {
      currentGroup.cleanup();
      currentGroup = null;
    }
    contentArea.innerHTML = '';

    const groupDef = groups.find(g => g.id === groupId);
    if (!groupDef) return;

    currentGroup = renderHubGroup(groupDef);
    contentArea.appendChild(currentGroup.element);
    setActiveGroup(groupId);
    sidebarResult.setActive(groupId);
  };

  const initialGroup = getActiveGroup();
  const sidebarResult = renderHubSidebar(groups, initialGroup, showGroup);
  cleanups.push(sidebarResult.cleanup);

  shell.append(sidebarResult.element, contentArea);

  // Render initial group
  showGroup(initialGroup);

  return {
    element: shell,
    cleanup: () => {
      if (currentGroup) {
        currentGroup.cleanup();
        currentGroup = null;
      }
      cleanups.forEach(fn => fn());
      cleanups.length = 0;
    },
  };
}
