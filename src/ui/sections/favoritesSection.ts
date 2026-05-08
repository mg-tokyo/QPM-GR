// src/ui/sections/favoritesSection.ts — Unified Favorites (Auto + Bulk) with tab switching

import { log } from '../../utils/logger';
import { t } from '../../i18n';

type TabKey = 'rules' | 'bulk';

export function createFavoritesSection(): { element: HTMLElement; cleanup: () => void } {
  const cleanups: Array<() => void> = [];
  let activeTab: TabKey = 'rules';

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:0;';

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.style.cssText = [
    'display:flex',
    'gap:2px',
    'padding:4px',
    'background:rgba(143,130,255,0.06)',
    'border-radius:8px',
    'margin-bottom:12px',
  ].join(';');

  const createTab = (key: TabKey, label: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = [
      'flex:1',
      'padding:6px 12px',
      'border:none',
      'border-radius:6px',
      'font-size:12px',
      'font-weight:500',
      'cursor:pointer',
      'transition:background 0.15s,color 0.15s',
      'background:transparent',
      'color:#776ea8',
    ].join(';');
    btn.addEventListener('click', () => switchTab(key));
    return btn;
  };

  const rulesTab = createTab('rules', t('feature.favorites.tabRules'));
  const bulkTab = createTab('bulk', t('feature.favorites.tabBulk'));
  tabBar.append(rulesTab, bulkTab);

  // Content area
  const content = document.createElement('div');
  content.style.cssText = 'min-height:100px;';

  container.append(tabBar, content);

  const syncTabStyles = () => {
    const activeStyle = 'background:rgba(143,130,255,0.18);color:#e8e0ff;border-bottom:2px solid #8f82ff;';
    const inactiveStyle = 'background:transparent;color:#776ea8;border-bottom:2px solid transparent;';
    rulesTab.style.cssText = rulesTab.style.cssText.replace(/background:[^;]+;color:[^;]+;/, activeTab === 'rules' ? activeStyle : inactiveStyle);
    bulkTab.style.cssText = bulkTab.style.cssText.replace(/background:[^;]+;color:[^;]+;/, activeTab === 'bulk' ? activeStyle : inactiveStyle);
  };

  const switchTab = (key: TabKey): void => {
    if (activeTab === key) return;
    activeTab = key;
    syncTabStyles();
    renderContent();
  };

  const renderContent = (): void => {
    content.innerHTML = '';
    const spinner = document.createElement('div');
    spinner.style.cssText = 'color:rgba(224,224,224,0.45);font-size:12px;padding:8px;';
    spinner.textContent = `⏳ ${t('common.loading')}`;
    content.appendChild(spinner);

    (async () => {
      try {
        if (activeTab === 'rules') {
          const { createAutoFavoriteSection } = await import('./autoFavoriteSection');
          const el = await createAutoFavoriteSection();
          spinner.remove();
          content.appendChild(el);
        } else {
          const { createBulkFavoriteSection } = await import('./bulkFavoriteSection');
          spinner.remove();
          content.appendChild(createBulkFavoriteSection({ startExpanded: true }));
        }
      } catch (err) {
        log('⚠️ Failed to load favorites tab', err);
        spinner.textContent = `❌ ${t('common.loadError')}`;
      }
    })();
  };

  syncTabStyles();
  renderContent();

  return {
    element: container,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; },
  };
}
