// src/ui/panel/panelNav.ts
import type { HubGroupDef, HubGroupId } from '../hubWindow/cards/types';
import { buildSidebarIcon } from '../hubWindow/cards/iconRenderer';
import type { CardIcon } from '../hubWindow/cards/types';
import { t } from '../../i18n';

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

function getHomeButton(): NavButton {
  return {
    id: 'home',
    label: t('panel.nav.home'),
    icon: { kind: 'emoji', value: '🏠' },
  };
}

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
    'background:rgba(12,14,22,0.52)',
    'border:1px solid rgba(143,130,255,0.16)',
    'border-radius:10px',
    'align-items:center',
    'flex-shrink:0',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,0.04)',
  ].join(';');

  const buttons = new Map<NavId, HTMLButtonElement>();

  function createBtn(nav: NavButton, pushRight: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = nav.label;
    btn.setAttribute('aria-label', nav.label);
    btn.style.cssText = [
      'width:48px',
      'height:48px',
      'border-radius:8px',
      'border:1px solid rgba(143,130,255,0.18)',
      'background:linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035))',
      'color:rgba(224,224,224,0.68)',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-size:20px',
      'transition:background 0.15s,border-color 0.15s,opacity 0.15s,transform 0.15s,box-shadow 0.15s,color 0.15s',
      'opacity:0.82',
      'outline:none',
      'flex-shrink:0',
      pushRight ? 'margin-left:auto' : '',
    ].join(';');

    const iconWrap = document.createElement('span');
    iconWrap.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;';
    iconWrap.appendChild(buildSidebarIcon(nav.icon));

    btn.appendChild(iconWrap);
    btn.addEventListener('click', () => onSelect(nav.id));
    btn.addEventListener('mouseenter', () => applyButtonState(btn, btn.dataset.active === 'true', true));
    btn.addEventListener('mouseleave', () => applyButtonState(btn, btn.dataset.active === 'true', false));
    btn.addEventListener('focus', () => {
      btn.style.boxShadow = '0 0 0 2px rgba(143,130,255,0.18)';
    });
    btn.addEventListener('blur', () => applyButtonState(btn, btn.dataset.active === 'true', false));
    btn.addEventListener('pointerdown', () => {
      btn.style.transform = 'translateY(1px)';
    });
    btn.addEventListener('pointerup', () => applyButtonState(btn, btn.dataset.active === 'true', true));
    btn.addEventListener('pointercancel', () => applyButtonState(btn, btn.dataset.active === 'true', false));
    buttons.set(nav.id, btn);
    return btn;
  }

  function applyButtonState(btn: HTMLButtonElement, active: boolean, hover = false): void {
    btn.dataset.active = String(active);
    if (active) {
      btn.style.background = 'linear-gradient(180deg, rgba(143,130,255,0.28), rgba(143,130,255,0.14))';
      btn.style.borderColor = 'rgba(143,130,255,0.55)';
      btn.style.color = '#f2f0ff';
      btn.style.opacity = '1';
      btn.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.08), 0 3px 12px rgba(143,130,255,0.16)';
      btn.style.transform = hover ? 'translateY(-1px)' : '';
      return;
    }

    btn.style.background = hover
      ? 'linear-gradient(180deg, rgba(255,255,255,0.11), rgba(143,130,255,0.07))'
      : 'linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035))';
    btn.style.borderColor = hover ? 'rgba(143,130,255,0.38)' : 'rgba(143,130,255,0.18)';
    btn.style.color = hover ? 'rgba(238,240,255,0.92)' : 'rgba(224,224,224,0.68)';
    btn.style.opacity = hover ? '1' : '0.82';
    btn.style.boxShadow = hover ? '0 2px 10px rgba(0,0,0,0.22)' : '';
    btn.style.transform = hover ? 'translateY(-1px)' : '';
  }

  // Home button first
  bar.appendChild(createBtn(getHomeButton(), false));

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
      applyButtonState(btn, isActive, false);
    }
  }

  setActive(activeId);

  return {
    element: bar,
    setActive,
    cleanup: () => { buttons.clear(); },
  };
}
