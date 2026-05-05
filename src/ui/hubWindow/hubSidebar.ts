// src/ui/hubWindow/hubSidebar.ts

import type { HubGroupDef, HubGroupId } from './cards/types';
import { buildSidebarIcon } from './cards/iconRenderer';

export interface HubSidebarResult {
  element: HTMLElement;
  setActive: (id: HubGroupId) => void;
  cleanup: () => void;
}

export function renderHubSidebar(
  groups: ReadonlyArray<HubGroupDef>,
  activeGroupId: HubGroupId,
  onGroupSelect: (groupId: HubGroupId) => void,
): HubSidebarResult {
  const sidebar = document.createElement('div');
  sidebar.style.cssText = [
    'width:52px',
    'flex-shrink:0',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'padding:8px 0',
    'gap:4px',
    'background:rgba(143,130,255,0.04)',
    'border-right:1px solid rgba(143,130,255,0.1)',
  ].join(';');

  const buttons = new Map<HubGroupId, HTMLButtonElement>();

  // Separate tools (last group) from main groups
  const mainGroups = groups.filter(g => g.id !== 'tools');
  const toolsGroup = groups.find(g => g.id === 'tools');

  const createButton = (group: HubGroupDef): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = group.label;
    btn.style.cssText = [
      'width:36px',
      'height:36px',
      'border-radius:8px',
      'border:1px solid transparent',
      'background:transparent',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-size:16px',
      'transition:background 0.15s,border-color 0.15s,opacity 0.15s',
      'opacity:0.4',
      'outline:none',
    ].join(';');
    btn.appendChild(buildSidebarIcon(group.icon));

    btn.addEventListener('click', () => onGroupSelect(group.id));

    buttons.set(group.id, btn);
    return btn;
  };

  for (const group of mainGroups) {
    sidebar.appendChild(createButton(group));
  }

  // Spacer pushes tools to bottom
  if (toolsGroup) {
    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1;';
    sidebar.appendChild(spacer);
    sidebar.appendChild(createButton(toolsGroup));
  }

  const setActive = (id: HubGroupId): void => {
    for (const [groupId, btn] of buttons) {
      const isActive = groupId === id;
      btn.style.background = isActive ? 'rgba(143,130,255,0.15)' : 'transparent';
      btn.style.borderColor = isActive ? 'rgba(143,130,255,0.3)' : 'transparent';
      btn.style.opacity = isActive ? '1' : '0.4';
    }
  };

  setActive(activeGroupId);

  return {
    element: sidebar,
    setActive,
    cleanup: () => { buttons.clear(); },
  };
}
