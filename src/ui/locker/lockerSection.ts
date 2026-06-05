// src/ui/locker/lockerSection.ts
// Locker section orchestrator — 3-tab layout (General / Overrides / Restrictions).

import { getLockerConfig, updateLockerConfig } from '../../features/locker/index';
import { createTabBar } from '../components/tabBar';
import { createToggle } from '../components/toggle';
import { getEligibleData } from './lockerPrimitives';
import { buildGeneralPanel, buildOverridesPanel, buildRestrictionsPanel } from './lockerTabPanels';
import { t } from '../../i18n';

// ── Tab definitions ─────────────────────────────────────────────────────────

type TabId = 'general' | 'overrides' | 'restrictions';

const TAB_IDS: TabId[] = ['general', 'overrides', 'restrictions'];

function getTabDefs(): { id: string; label: string }[] {
  return [
    { id: 'general',      label: t('feature.locker.tab.general') },
    { id: 'overrides',    label: t('feature.locker.tab.overrides') },
    { id: 'restrictions', label: t('feature.locker.tab.restrictions') },
  ];
}

// ── Main export ─────────────────────────────────────────────────────────────

export function createLockerSection(): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  function render(): void {
    container.innerHTML = '';
    const cfg = getLockerConfig();

    // ── Master toggle (always visible, outside tabs) ──
    const masterRow = document.createElement('div');
    masterRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0';
    const masterLabel = document.createElement('div');
    masterLabel.textContent = t('feature.locker.enableLocker');
    masterLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--qpm-text,#eef0ff)';

    const toggle = createToggle({
      checked: cfg.enabled,
      onChange: (checked) => {
        updateLockerConfig({ enabled: checked });
        render();
      },
    });

    masterRow.append(masterLabel, toggle.root);
    container.appendChild(masterRow);

    // ── Tab bar ──
    let activeTab: TabId = 'general';
    const eligible = getEligibleData();

    const panels: Record<TabId, HTMLElement> = {
      general: buildGeneralPanel(cfg),
      overrides: buildOverridesPanel(cfg, eligible),
      restrictions: buildRestrictionsPanel(cfg, eligible),
    };

    for (const id of TAB_IDS) {
      panels[id].style.display = id === activeTab ? 'flex' : 'none';
    }

    const panelSlot = document.createElement('div');
    for (const id of TAB_IDS) panelSlot.appendChild(panels[id]);

    const tabBar = createTabBar(getTabDefs(), {
      defaultTab: 'general',
      onChange: (id) => {
        const tabId = id as TabId;
        if (tabId === activeTab) return;
        panels[activeTab].style.display = 'none';
        activeTab = tabId;
        panels[activeTab].style.display = 'flex';
      },
    });

    container.appendChild(tabBar.root);
    container.appendChild(panelSlot);
  }

  render();
  return container;
}
