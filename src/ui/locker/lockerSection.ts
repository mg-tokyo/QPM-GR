// src/ui/locker/lockerSection.ts
// Locker section orchestrator — tab bar + panel switching.
// All panel/tile/helper logic lives in lockerPrimitives, lockerPlantPicker,
// lockerCustomRules, and lockerTabPanels.

import { getLockerConfig, updateLockerConfig } from '../../features/locker/index';
import {
  TOGGLE_ROW_CSS, LABEL_CSS, CHECKBOX_CSS, TEXT_MUTED,
  getEligibleData,
} from './lockerPrimitives';
import {
  buildGardenQolPanel, buildPlantsPanel, buildEggsPanel, buildDecorPanel, buildSellPanel,
} from './lockerTabPanels';
import { t } from '../../i18n';

// ── Tab definitions ─────────────────────────────────────────────────────────

type TabId = 'gardenQol' | 'plants' | 'eggs' | 'decor' | 'sell';

/** Built lazily so t() runs after the locale is set. */
function getTabDefs(): { id: TabId; label: string }[] {
  return [
    { id: 'gardenQol', label: `\u2699\uFE0F ${t('feature.locker.tab.gardenQol')}` },
    { id: 'plants',    label: `\ud83c\udf31 ${t('feature.locker.tab.plants')}` },
    { id: 'eggs',      label: `\ud83e\udd5a ${t('feature.locker.tab.eggs')}` },
    { id: 'decor',     label: `\ud83e\ude91 ${t('feature.locker.tab.decor')}` },
    { id: 'sell',      label: `\ud83d\udcb0 ${t('feature.locker.tab.sell')}` },
  ];
}

// ── Tab bar (bug fix #2: returns setActive instead of rebuilding) ────────

interface TabBar {
  bar: HTMLElement;
  setActive: (id: TabId) => void;
}

function buildTabBar(initialTab: TabId, onSwitch: (id: TabId) => void): TabBar {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.08)';

  let currentTab = initialTab;
  const buttons = new Map<TabId, HTMLButtonElement>();

  for (const tab of getTabDefs()) {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    const isActive = tab.id === currentTab;
    btn.style.cssText = `flex:1;padding:8px 0;background:none;border:none;border-bottom:2px solid ${isActive ? '#8f82ff' : 'transparent'};color:${isActive ? '#8f82ff' : TEXT_MUTED};font-size:11px;font-weight:600;cursor:pointer;transition:color .15s,border-color .15s`;
    btn.addEventListener('mouseenter', () => { if (tab.id !== currentTab) btn.style.color = 'rgba(143,130,255,0.7)'; });
    btn.addEventListener('mouseleave', () => { if (tab.id !== currentTab) btn.style.color = TEXT_MUTED as string; });
    btn.addEventListener('click', () => onSwitch(tab.id));
    buttons.set(tab.id, btn);
    bar.appendChild(btn);
  }

  const setActive = (id: TabId): void => {
    currentTab = id;
    for (const [tabId, btn] of buttons) {
      const active = tabId === id;
      btn.style.borderBottomColor = active ? '#8f82ff' : 'transparent';
      btn.style.color = active ? '#8f82ff' : TEXT_MUTED as string;
    }
  };

  return { bar, setActive };
}

// ── Main export ─────────────────────────────────────────────────────────────

export function createLockerSection(): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  function render(): void {
    container.innerHTML = '';
    const cfg = getLockerConfig();

    // ── Master toggle (always visible) ──
    const masterRow = document.createElement('label');
    masterRow.style.cssText = TOGGLE_ROW_CSS;
    const masterText = document.createElement('div');
    masterText.style.cssText = LABEL_CSS;
    masterText.textContent = t('feature.locker.enableLocker');
    const masterInput = document.createElement('input');
    masterInput.type = 'checkbox';
    masterInput.checked = cfg.enabled;
    masterInput.style.cssText = CHECKBOX_CSS;
    masterInput.addEventListener('change', () => {
      updateLockerConfig({ enabled: masterInput.checked });
      render();
    });
    masterRow.append(masterText, masterInput);
    container.appendChild(masterRow);

    // ── Tabs ──
    let activeTab: TabId = 'gardenQol';
    const eligible = getEligibleData();

    const panels: Record<TabId, HTMLElement> = {
      gardenQol: buildGardenQolPanel(cfg),
      plants: buildPlantsPanel(cfg, eligible),
      eggs:   buildEggsPanel(cfg, eligible),
      decor:  buildDecorPanel(cfg, eligible),
      sell:   buildSellPanel(cfg, eligible),
    };

    for (const [id, panel] of Object.entries(panels)) {
      panel.style.display = id === activeTab ? 'flex' : 'none';
    }

    const panelSlot = document.createElement('div');

    function switchTab(id: TabId): void {
      if (id === activeTab) return;
      panels[activeTab].style.display = 'none';
      activeTab = id;
      panels[activeTab].style.display = 'flex';
      tabBar.setActive(activeTab);
    }

    const tabBar = buildTabBar(activeTab, switchTab);
    for (const panel of Object.values(panels)) panelSlot.appendChild(panel);

    container.appendChild(tabBar.bar);
    container.appendChild(panelSlot);
  }

  render();
  return container;
}
