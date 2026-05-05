// src/ui/panel/panelNav.ts
import type { HubGroupDef, HubGroupId } from '../hubWindow/cards/types';
import { buildSidebarIcon } from '../hubWindow/cards/iconRenderer';
import type { CardIcon } from '../hubWindow/cards/types';

export type NavId = 'home' | HubGroupId;

export interface PanelNavResult {
  element: HTMLElement;
  setActive: (id: NavId) => void;
  cleanup: () => void;
}

interface NavButton {
  id: NavId;
  label: string;
  icon: CardIcon;
}

const HOME_BUTTON: NavButton = {
  id: 'home',
  label: 'Home',
  icon: { kind: 'emoji', value: '🏠' },
};

export function renderPanelNav(
  groups: ReadonlyArray<HubGroupDef>,
  activeId: NavId,
  onSelect: (id: NavId) => void,
): PanelNavResult {
  const bar = document.createElement('div');
  bar.style.cssText = [
    'display:flex',
    'gap:4px',
    'padding:5px 8px',
    'background:rgba(143,130,255,0.04)',
    'border:1px solid rgba(143,130,255,0.1)',
    'border-radius:8px',
    'align-items:center',
    'flex-shrink:0',
  ].join(';');

  const buttons = new Map<NavId, HTMLButtonElement>();

  function createBtn(nav: NavButton, pushRight: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = nav.label;
    btn.style.cssText = [
      'width:32px',
      'height:32px',
      'border-radius:6px',
      'border:1px solid transparent',
      'background:transparent',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-size:14px',
      'transition:background 0.15s,border-color 0.15s,opacity 0.15s',
      'opacity:0.45',
      'outline:none',
      'flex-shrink:0',
      pushRight ? 'margin-left:auto' : '',
    ].join(';');
    btn.appendChild(buildSidebarIcon(nav.icon));
    btn.addEventListener('click', () => onSelect(nav.id));
    buttons.set(nav.id, btn);
    return btn;
  }

  // Home button first
  bar.appendChild(createBtn(HOME_BUTTON, false));

  // Group buttons (tools last, pushed right)
  const mainGroups = groups.filter(g => g.id !== 'tools');
  const toolsGroup = groups.find(g => g.id === 'tools');

  for (const group of mainGroups) {
    bar.appendChild(createBtn({ id: group.id, label: group.label, icon: group.icon }, false));
  }
  if (toolsGroup) {
    bar.appendChild(createBtn({ id: toolsGroup.id, label: toolsGroup.label, icon: toolsGroup.icon }, true));
  }

  function setActive(id: NavId): void {
    for (const [navId, btn] of buttons) {
      const isActive = navId === id;
      btn.style.background = isActive ? 'rgba(143,130,255,0.15)' : 'transparent';
      btn.style.borderColor = isActive ? 'rgba(143,130,255,0.3)' : 'transparent';
      btn.style.opacity = isActive ? '1' : '0.45';
    }
  }

  setActive(activeId);

  return {
    element: bar,
    setActive,
    cleanup: () => { buttons.clear(); },
  };
}
