// src/ui/statsHubWindow/mainWindow.ts
// Stats Hub window shell — tab bar, tab switching, lifecycle cleanup.

import { toggleWindow } from '../modalWindow';
import { storage } from '../../utils/storage';
import { log } from '../../utils/logger';
import { t } from '../../i18n';
import { STATS_HUB_ACTIVE_TAB_KEY } from './constants';
import { buildGardenTab } from './gardenTab';
import { buildEconomyTab } from './economyTab';

export function openStatsHubWindow(): void {
  toggleWindow('stats-hub', `📊 ${t('feature.statsHub.title')}`, renderStatsHub, '920px', '85vh');
}

type TabId = 'garden' | 'economy';

export function renderStatsHub(root: HTMLElement): void {
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

  const savedTab = storage.get<string>(STATS_HUB_ACTIVE_TAB_KEY, 'garden');
  let activeTab: TabId = savedTab === 'economy' ? 'economy' : 'garden';
  let gardenCleanup: (() => void) | null = null;
  let economyCleanup: (() => void) | null = null;

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.style.cssText = [
    'display:flex',
    'gap:4px',
    'padding:10px 14px 0',
    'border-bottom:1px solid rgba(143,130,255,0.2)',
    'flex-shrink:0',
  ].join(';');

  function makeTab(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = [
      'padding:7px 16px',
      'font-size:13px',
      'font-weight:600',
      'border:none',
      'border-bottom:3px solid transparent',
      'background:transparent',
      'cursor:pointer',
      'color:rgba(224,224,224,0.55)',
      'transition:color 0.12s,border-color 0.12s',
    ].join(';');
    return btn;
  }

  const gardenBtn = makeTab(`🌿 ${t('feature.statsHub.tabGarden')}`);
  const economyBtn = makeTab(`💰 ${t('feature.statsHub.tabEconomy')}`);
  tabBar.append(gardenBtn, economyBtn);
  root.appendChild(tabBar);

  const tabContent = document.createElement('div');
  tabContent.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
  root.appendChild(tabContent);

  const tabBtns: Record<TabId, HTMLButtonElement> = { garden: gardenBtn, economy: economyBtn };

  function setActiveTab(tab: TabId): void {
    activeTab = tab;
    storage.set(STATS_HUB_ACTIVE_TAB_KEY, tab);
    tabContent.innerHTML = '';
    gardenCleanup?.(); gardenCleanup = null;
    economyCleanup?.(); economyCleanup = null;

    for (const [id, btn] of Object.entries(tabBtns)) {
      btn.style.color = id === tab ? '#c8c0ff' : 'rgba(224,224,224,0.55)';
      btn.style.borderBottomColor = id === tab ? '#8f82ff' : 'transparent';
    }

    const panel = document.createElement('div');
    panel.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';
    tabContent.appendChild(panel);

    try {
      if (tab === 'garden') {
        gardenCleanup = buildGardenTab(panel);
      } else {
        economyCleanup = buildEconomyTab(panel);
      }
    } catch (error) {
      log('[StatsHub] Tab build error', error);
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'padding:20px;color:rgba(224,224,224,0.4);font-size:13px;';
      errDiv.textContent = t('feature.statsHub.tabLoadError');
      panel.appendChild(errDiv);
    }
  }

  gardenBtn.addEventListener('click', () => setActiveTab('garden'));
  economyBtn.addEventListener('click', () => setActiveTab('economy'));

  // Cleanup subscriptions when window is removed from DOM
  const observer = new MutationObserver(() => {
    if (!document.contains(root)) {
      gardenCleanup?.();
      economyCleanup?.();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setActiveTab(activeTab);
}
