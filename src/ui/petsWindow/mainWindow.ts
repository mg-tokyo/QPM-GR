// Main window shell: tab navigation, sell settings popover, keybind init/stop.

import { toggleWindow } from '../modalWindow';
import { storage } from '../../utils/storage';
import {
  getSellAllPetsSettings,
  setSellAllPetsKeybind,
  setSellAllPetsProtectionRules,
  runSellAllPets,
  isSellAllPetsRunning,
  SELL_ALL_PET_RARITY_OPTIONS,
} from '../../features/sellAllPets';
import {
  getTeamsConfig,
  applyTeam,
  getKeybinds,
} from '../../store/petTeams';
import { initFloatingCards } from '../petFloatingCard';
import type { CompareStage } from '../../data/petCompareRules';
import type { ManagerState } from './types';
import { WINDOW_ID, PETS_WINDOW_SWITCH_TAB_EVENT, DEFAULT_KEYBIND, PETS_TAB_KEY } from './constants';
import { ensureStyles } from './styles';
import { btn, showToast, normalizeKeybind, isEditableTarget, createKeybindButton } from './helpers';
import { buildManagerTab } from './managerTab';
import { startFeedKeybinds, stopFeedKeybinds } from '../../features/feedKeybinds';
import { t } from '../../i18n';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let currentKeybind = DEFAULT_KEYBIND;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function togglePetsWindow(): void {
  toggleWindow(WINDOW_ID, t('feature.petsWindow.title'), renderPetsWindow, '960px', '600px');
}

// ---------------------------------------------------------------------------
// Window renderer
// ---------------------------------------------------------------------------

function renderPetsWindow(root: HTMLElement): void {
  ensureStyles(root.ownerDocument ?? document);

  const container = document.createElement('div');
  container.className = 'qpm-pets';
  root.appendChild(container);

  const allCleanups: Array<() => void> = [];

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'qpm-pets__tabs';
  tabs.dataset.tour = 'pet-hub-tabs';
  container.appendChild(tabs);

  const compareStageBadge = document.createElement('div');
  compareStageBadge.className = 'qpm-pets__stage-badge qpm-pets__stage-badge--hidden';
  compareStageBadge.textContent = t('feature.petsWindow.stageBadge', { stage: 'EARLY' });

  const tabsRight = document.createElement('div');
  tabsRight.className = 'qpm-pets__tabs-right';

  const settingsWrap = document.createElement('div');
  settingsWrap.className = 'qpm-pets__settings-wrap';
  settingsWrap.dataset.tour = 'pet-hub-settings';

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'qpm-pets__settings-btn';
  settingsBtn.title = t('feature.petsWindow.sellSettingsTooltip');
  settingsBtn.textContent = '\u2699';
  settingsBtn.setAttribute('aria-expanded', 'false');

  let settingsOverlay: HTMLElement | null = null;
  let settingsPanel: HTMLElement | null = null;
  let settingsOpen = false;

  const body = document.createElement('div');
  body.className = 'qpm-pets__body';
  body.dataset.tour = 'pet-hub-body';
  container.appendChild(body);

  type TabId = 'manager' | 'pet-optimizer';
  const tabDefs: Array<{ id: TabId; label: string; lazy: boolean }> = [
    { id: 'manager', label: t('feature.petsWindow.tabManager'), lazy: false },
    { id: 'pet-optimizer', label: `\uD83C\uDFAF ${t('feature.petsWindow.tabOptimizer')}`, lazy: true },
  ];
  const validTabIds = new Set<string>(tabDefs.map((d) => d.id));
  const savedTab = storage.get<string>(PETS_TAB_KEY, 'manager');
  let activeTab: TabId = validTabIds.has(savedTab) ? (savedTab as TabId) : 'manager';
  let compareBadgeVisible = false;
  let compareBadgeStage: CompareStage | null = null;

  const panels: Partial<Record<TabId, HTMLElement>> = {};
  const tabBtns: Partial<Record<TabId, HTMLElement>> = {};
  const lazyLoaded = new Set<TabId>();

  function renderCompareStageBadge(): void {
    const show = compareBadgeVisible && activeTab === 'manager' && !!compareBadgeStage;
    compareStageBadge.classList.toggle('qpm-pets__stage-badge--hidden', !show);
    compareStageBadge.classList.remove(
      'qpm-pets__stage-badge--early',
      'qpm-pets__stage-badge--mid',
      'qpm-pets__stage-badge--late',
    );

    if (!show || !compareBadgeStage) return;

    compareStageBadge.textContent = t('feature.petsWindow.stageBadge', { stage: compareBadgeStage.toUpperCase() });
    compareStageBadge.classList.add(`qpm-pets__stage-badge--${compareBadgeStage}`);
  }

  // --- Sell settings popover ---

  function buildSellSettingsPanel(panel: HTMLElement): void {
    const settings = getSellAllPetsSettings();
    const protections = settings.protections;
    panel.replaceChildren();

    const title = document.createElement('div');
    title.className = 'qpm-pets__settings-title';
    title.textContent = t('feature.petsWindow.sellTitle');
    panel.appendChild(title);

    const keybindRow = document.createElement('div');
    keybindRow.className = 'qpm-pets__settings-row';
    const keybindLabel = document.createElement('div');
    keybindLabel.textContent = t('feature.petsWindow.keybindLabel');
    const keybindSubtle = document.createElement('div');
    keybindSubtle.className = 'qpm-pets__settings-subtle';
    keybindSubtle.textContent = t('feature.petsWindow.keybindHint');
    keybindLabel.appendChild(keybindSubtle);

    const keybindInput = createKeybindButton({
      onSet(combo) { setSellAllPetsKeybind(combo); },
      onClear() { setSellAllPetsKeybind(''); },
      readCurrent: () => getSellAllPetsSettings().keybind ?? '',
      width: '120px',
    });

    keybindRow.append(keybindLabel, keybindInput);
    panel.appendChild(keybindRow);

    const divider = document.createElement('div');
    divider.className = 'qpm-pets__settings-divider';
    panel.appendChild(divider);

    const createToggleRow = (
      label: string,
      checked: boolean,
      onChange: (checked: boolean) => void,
      subtitle?: string,
      extraControl?: HTMLElement,
    ): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'qpm-pets__settings-row';

      const text = document.createElement('div');
      text.innerHTML = subtitle
        ? `${label}<div class="qpm-pets__settings-subtle">${subtitle}</div>`
        : label;

      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex;align-items:center;gap:8px;';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = checked;
      toggle.addEventListener('change', () => onChange(toggle.checked));
      controls.appendChild(toggle);

      if (extraControl) controls.appendChild(extraControl);
      row.append(text, controls);
      return row;
    };

    panel.appendChild(createToggleRow(
      t('feature.petsWindow.enableProtection'),
      protections.enabled,
      (checked) => setSellAllPetsProtectionRules({ enabled: checked }),
    ));

    panel.appendChild(createToggleRow(
      t('feature.petsWindow.protectGold'),
      protections.protectGold,
      (checked) => setSellAllPetsProtectionRules({ protectGold: checked }),
    ));

    panel.appendChild(createToggleRow(
      t('feature.petsWindow.protectRainbow'),
      protections.protectRainbow,
      (checked) => setSellAllPetsProtectionRules({ protectRainbow: checked }),
    ));

    const thresholdInput = document.createElement('input');
    thresholdInput.type = 'number';
    thresholdInput.className = 'qpm-pets__threshold';
    thresholdInput.min = '0';
    thresholdInput.max = '100';
    thresholdInput.step = '1';
    thresholdInput.value = String(protections.maxStrThreshold);
    thresholdInput.disabled = !protections.protectMaxStr;
    const saveThreshold = (): void => {
      const value = Number(thresholdInput.value);
      if (!Number.isFinite(value)) return;
      setSellAllPetsProtectionRules({ maxStrThreshold: Math.max(0, Math.min(100, Math.round(value))) });
      thresholdInput.value = String(getSellAllPetsSettings().protections.maxStrThreshold);
    };
    thresholdInput.addEventListener('change', saveThreshold);
    thresholdInput.addEventListener('blur', saveThreshold);

    panel.appendChild(createToggleRow(
      t('feature.petsWindow.protectMaxStr'),
      protections.protectMaxStr,
      (checked) => {
        setSellAllPetsProtectionRules({ protectMaxStr: checked });
        thresholdInput.disabled = !checked;
      },
      t('feature.petsWindow.threshold'),
      thresholdInput,
    ));

    const rarityWrap = document.createElement('div');
    rarityWrap.className = 'qpm-pets__settings-row';
    rarityWrap.style.display = 'grid';
    rarityWrap.style.gap = '8px';

    const rarityTitle = document.createElement('div');
    rarityTitle.textContent = t('feature.petsWindow.protectedRarities');
    const raritySubtle = document.createElement('div');
    raritySubtle.className = 'qpm-pets__settings-subtle';
    raritySubtle.textContent = t('feature.petsWindow.raritiesHint');
    rarityTitle.appendChild(raritySubtle);
    rarityWrap.appendChild(rarityTitle);

    const rarityGrid = document.createElement('div');
    rarityGrid.className = 'qpm-pets__rarity-grid';

    const selected = new Set((protections.protectedRarities ?? []).map((value) => value.toLowerCase()));
    for (const rarity of SELL_ALL_PET_RARITY_OPTIONS) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `qpm-pets__rarity-pill${selected.has(rarity.toLowerCase()) ? ' qpm-pets__rarity-pill--active' : ''}`;
      pill.textContent = rarity;
      pill.addEventListener('click', () => {
        const current = new Set(getSellAllPetsSettings().protections.protectedRarities.map((value) => value.toLowerCase()));
        if (current.has(rarity.toLowerCase())) current.delete(rarity.toLowerCase());
        else current.add(rarity.toLowerCase());
        const next = SELL_ALL_PET_RARITY_OPTIONS.filter((value) => current.has(value.toLowerCase()));
        setSellAllPetsProtectionRules({ protectedRarities: next });
        if (settingsPanel) buildSellSettingsPanel(settingsPanel);
      });
      rarityGrid.appendChild(pill);
    }

    rarityWrap.appendChild(rarityGrid);
    panel.appendChild(rarityWrap);
  }

  function closeSellSettingsPanel(): void {
    if (!settingsOpen) return;
    settingsOpen = false;
    settingsBtn.setAttribute('aria-expanded', 'false');
    settingsOverlay?.remove();
    settingsOverlay = null;
    settingsPanel?.remove();
    settingsPanel = null;
  }

  function positionSellSettingsPanel(): void {
    if (!settingsPanel || !settingsOpen) return;
    const anchor = settingsBtn.getBoundingClientRect();
    const panelWidth = Math.min(320, Math.max(240, window.innerWidth - 16));
    settingsPanel.style.width = `${panelWidth}px`;
    settingsPanel.style.maxHeight = `${Math.max(220, Math.min(420, window.innerHeight - 24))}px`;

    let left = anchor.right - panelWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));

    let top = anchor.bottom + 8;
    const panelHeight = settingsPanel.offsetHeight || 320;
    if (top + panelHeight > window.innerHeight - 8) {
      top = Math.max(8, anchor.top - panelHeight - 8);
    }

    settingsPanel.style.left = `${Math.round(left)}px`;
    settingsPanel.style.top = `${Math.round(top)}px`;
  }

  function openSellSettingsPanel(): void {
    if (settingsOpen) return;
    settingsOpen = true;
    settingsBtn.setAttribute('aria-expanded', 'true');

    settingsOverlay = document.createElement('div');
    settingsOverlay.className = 'qpm-pets__settings-overlay';
    settingsOverlay.addEventListener('mousedown', (event) => {
      if (event.target === settingsOverlay) closeSellSettingsPanel();
    });

    settingsPanel = document.createElement('div');
    settingsPanel.className = 'qpm-pets__settings-popover';
    settingsOverlay.appendChild(settingsPanel);
    document.body.appendChild(settingsOverlay);
    buildSellSettingsPanel(settingsPanel);
    positionSellSettingsPanel();
  }

  settingsBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (settingsOpen) closeSellSettingsPanel();
    else openSellSettingsPanel();
  });

  const onSettingsOutsideClick = (event: MouseEvent): void => {
    if (!settingsOpen) return;
    if (!(event.target instanceof Node)) return;
    if (settingsBtn.contains(event.target)) return;
    if (settingsPanel && settingsPanel.contains(event.target)) return;
    closeSellSettingsPanel();
  };
  document.addEventListener('mousedown', onSettingsOutsideClick, true);
  allCleanups.push(() => document.removeEventListener('mousedown', onSettingsOutsideClick, true));

  const onSettingsEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    closeSellSettingsPanel();
  };
  document.addEventListener('keydown', onSettingsEscape);
  allCleanups.push(() => document.removeEventListener('keydown', onSettingsEscape));

  const onSettingsViewportChange = (): void => {
    if (!settingsOpen) return;
    positionSellSettingsPanel();
  };
  window.addEventListener('resize', onSettingsViewportChange);
  window.addEventListener('scroll', onSettingsViewportChange, true);
  allCleanups.push(() => {
    window.removeEventListener('resize', onSettingsViewportChange);
    window.removeEventListener('scroll', onSettingsViewportChange, true);
  });

  allCleanups.push(closeSellSettingsPanel);

  function reassertScrollChain(panel: HTMLElement | undefined): void {
    if (!panel) return;
    panel.style.minHeight = '0';
    panel.style.overflow = 'hidden';

    const scrollTargets = panel.querySelectorAll<HTMLElement>(
      '.qpm-mgr__teams, .qpm-mgr__editor, .qpm-editor, .qpm-tcmp-grid, .qpm-window-body, .qpm-pet-optimizer-root',
    );
    scrollTargets.forEach((target) => {
      if (!target.style.minHeight) target.style.minHeight = '0';
      if (!target.style.overflowY) target.style.overflowY = 'auto';
    });
  }

  function switchTab(id: TabId): void {
    activeTab = id;
    storage.set(PETS_TAB_KEY, id);
    for (const def of tabDefs) {
      tabBtns[def.id]?.classList.toggle('qpm-pets__tab--active', def.id === id);
      panels[def.id]?.classList.toggle('qpm-pets__panel--active', def.id === id);
    }
    // Force inactive panels hidden to avoid stale sub-layout bleed-through.
    for (const def of tabDefs) {
      const panel = panels[def.id];
      if (!panel) continue;
      panel.style.display = def.id === id ? 'flex' : 'none';
    }
    // Lazy-load optimizer tab on first activation.
    if (id === 'pet-optimizer' && !lazyLoaded.has('pet-optimizer')) {
      lazyLoaded.add('pet-optimizer');
      const panel = panels['pet-optimizer']!;
      import('../petOptimizerWindow').then(({ renderPetOptimizerWindow }) => {
        panel.innerHTML = '';
        renderPetOptimizerWindow(panel);
      }).catch(() => {
        panel.textContent = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'padding:20px;color:#ff6b6b;';
        errDiv.textContent = t('feature.petsWindow.optimizerLoadError');
        panel.appendChild(errDiv);
      });
    }

    renderCompareStageBadge();
    requestAnimationFrame(() => reassertScrollChain(panels[id]));
  }

  let managerState: ManagerState | null = null;

  for (const def of tabDefs) {
    const tabBtn = document.createElement('div');
    tabBtn.className = `qpm-pets__tab${def.id === activeTab ? ' qpm-pets__tab--active' : ''}`;
    tabBtn.textContent = def.label;
    tabBtn.addEventListener('click', () => switchTab(def.id));
    tabs.appendChild(tabBtn);
    tabBtns[def.id] = tabBtn;

    const panel = document.createElement('div');
    panel.className = `qpm-pets__panel${def.id === activeTab ? ' qpm-pets__panel--active' : ''}`;
    body.appendChild(panel);
    panels[def.id] = panel;

    if (def.id === 'manager') {
      managerState = buildManagerTab(panel, ({ visible, stage }) => {
        compareBadgeVisible = visible;
        compareBadgeStage = stage;
        renderCompareStageBadge();
      });
      allCleanups.push(...managerState.cleanups);
    }
    // pet-optimizer is lazy-loaded on first click
  }
  settingsWrap.appendChild(settingsBtn);
  tabsRight.append(compareStageBadge, settingsWrap);
  tabs.appendChild(tabsRight);

  // Normalize initial panel visibility through the same switch path.
  switchTab(activeTab);

  const onWindowRestore = (event: Event): void => {
    const detail = (event as CustomEvent<{ id?: string }>).detail;
    if (!detail || detail.id !== WINDOW_ID) return;
    requestAnimationFrame(() => reassertScrollChain(panels[activeTab]));
  };
  window.addEventListener('qpm:window-restored', onWindowRestore as EventListener);
  allCleanups.push(() => window.removeEventListener('qpm:window-restored', onWindowRestore as EventListener));

  const onPetsWindowSwitchTab = (event: Event): void => {
    const detail = (event as CustomEvent<{ tab?: string; teamId?: string | null }>).detail;
    if (!detail?.tab) return;
    if (detail.tab !== 'manager' && detail.tab !== 'pet-optimizer') return;
    switchTab(detail.tab);
    if (detail.tab === 'manager' && managerState) {
      managerState.selectTeam(detail.teamId ?? null);
    }
  };
  window.addEventListener(PETS_WINDOW_SWITCH_TAB_EVENT, onPetsWindowSwitchTab as EventListener);
  allCleanups.push(() => window.removeEventListener(PETS_WINDOW_SWITCH_TAB_EVENT, onPetsWindowSwitchTab as EventListener));

  // Tour system: check for first-time tour and inject replay button
  import('../tour').then(({ checkTour, injectReplayButton }) => {
    checkTour(WINDOW_ID, root);
    injectReplayButton(WINDOW_ID);
  });

  // Cleanup on window root removal (MutationObserver)
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      observer.disconnect();
      allCleanups.forEach(fn => fn());
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Init (keybind registration)
// ---------------------------------------------------------------------------

let keybindHandler: ((e: KeyboardEvent) => void) | null = null;

export function initPetsWindow(): void {
  initFloatingCards();
  startFeedKeybinds();
  if (keybindHandler) return; // idempotent

  keybindHandler = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (e.repeat) return;

    // Window open/close keybind
    if (currentKeybind && e.key.toLowerCase() === currentKeybind && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      togglePetsWindow();
      return;
    }

    const combo = normalizeKeybind(e);
    if (!combo) return;

    const sellSettings = getSellAllPetsSettings();
    if (sellSettings.keybind && combo === sellSettings.keybind) {
      e.preventDefault();
      e.stopPropagation();

      if (isSellAllPetsRunning()) {
        showToast(t('feature.petsWindow.sellAlreadyRunning'), 'info');
        return;
      }

      showToast(t('feature.petsWindow.sellingPets'), 'info');
      runSellAllPets()
        .then((result) => {
          if (result.status === 'success') {
            showToast(result.message, 'success');
            return;
          }
          if (result.status === 'partial') {
            showToast(result.message, 'error');
            return;
          }
          if (result.status === 'cancelled' || result.status === 'noop' || result.status === 'busy') {
            showToast(result.message, 'info');
            return;
          }
          showToast(result.message, 'error');
        })
        .catch(() => {
          showToast(t('feature.petsWindow.sellFailed'), 'error');
        });
      return;
    }

    // Team keybinds
    const keybinds = getKeybinds();
    const teamId = keybinds[combo];
    if (!teamId) return;

    const config = getTeamsConfig();
    const team = config.teams.find((entry) => entry.id === teamId);
    if (!team) return;

    e.preventDefault();
    e.stopPropagation();
    showToast(t('feature.petsWindow.applyingTeam', { name: team.name }));
    applyTeam(team.id)
      .then(result => {
        if (result.errors.length === 0) {
          showToast(t('feature.petsWindow.appliedTeam', { name: team.name }), 'success');
        } else {
          const summary = result.errorSummary ? `: ${result.errorSummary}` : '';
          showToast(t('feature.petsWindow.appliedWithErrors', { name: team.name, count: String(result.errors.length), summary }), 'error');
        }
      })
      .catch(() => showToast(t('feature.petsWindow.teamApplyFailed'), 'error'));
  };

  document.addEventListener('keydown', keybindHandler);
}

export function stopPetsWindow(): void {
  stopFeedKeybinds();
  if (keybindHandler) {
    document.removeEventListener('keydown', keybindHandler);
    keybindHandler = null;
  }
}
