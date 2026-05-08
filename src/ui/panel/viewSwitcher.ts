// src/ui/panel/viewSwitcher.ts
import type { HubGroupDef } from '../hubWindow/cards/types';
import { renderPanelNav, type NavId, type PanelNavResult } from './panelNav';
import { renderHomeView, type HomeViewResult } from './homeView';
import { renderPanelFooter, type PanelFooterResult } from './panelFooter';
import { renderHubGroup, type HubGroupResult } from '../hubWindow/hubGroup';
import { setActiveGroup } from '../hubWindow/state';
import { registerBuiltinTiles } from './tileRegistry';

export interface ViewSwitcherResult {
  navElement: HTMLElement;
  viewElement: HTMLElement;
  footerElement: HTMLElement;
  cleanup: () => void;
}

export function createViewSwitcher(groups: ReadonlyArray<HubGroupDef>): ViewSwitcherResult {
  const cleanups: Array<() => void> = [];

  // Register tiles on first call
  registerBuiltinTiles();

  let currentHomeView: HomeViewResult | null = null;
  let currentGroupView: HubGroupResult | null = null;
  const footerResult: PanelFooterResult = renderPanelFooter();
  cleanups.push(footerResult.cleanup);

  const viewContainer = document.createElement('div');
  viewContainer.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;padding:8px 12px;';

  const initialNav: NavId = 'home';

  function showView(id: NavId): void {
    // Cleanup current
    if (currentHomeView) { currentHomeView.cleanup(); currentHomeView = null; }
    if (currentGroupView) { currentGroupView.cleanup(); currentGroupView = null; }
    viewContainer.innerHTML = '';

    if (id === 'home') {
      currentHomeView = renderHomeView();
      viewContainer.appendChild(currentHomeView.element);
    } else {
      const groupDef = groups.find(g => g.id === id);
      if (groupDef) {
        currentGroupView = renderHubGroup(groupDef);
        viewContainer.appendChild(currentGroupView.element);
        setActiveGroup(id);
      }
    }

    navResult.setActive(id);
    document.dispatchEvent(new CustomEvent('qpm:panel-view-change', { detail: { viewId: id } }));
  }

  const navResult: PanelNavResult = renderPanelNav(groups, initialNav, showView);
  cleanups.push(navResult.cleanup);

  // Show initial view
  showView(initialNav);

  return {
    navElement: navResult.element,
    viewElement: viewContainer,
    footerElement: footerResult.element,
    cleanup: () => {
      if (currentHomeView) { currentHomeView.cleanup(); currentHomeView = null; }
      if (currentGroupView) { currentGroupView.cleanup(); currentGroupView = null; }
      cleanups.forEach(fn => fn());
      cleanups.length = 0;
    },
  };
}
