// src/ui/hubWindow/groups/configGroup.ts

import type { HubGroupDef, ExpandableCardConfig } from '../cards/types';
import { toggleWindow } from '../../core/modalWindow';
import { log } from '../../../utils/logger';
import {
  isShopKeybindsEnabled,
  setShopKeybindsEnabled,
  getAllShopKeybinds,
  setShopKeybind,
  clearShopKeybind,
  type ShopId,
} from '../../../features/shop/keybinds';
import {
  getPanelToggleKeybind,
  setPanelToggleKeybind,
  resetPanelToggleKeybind,
  onPanelToggleKeybindChange,
} from '../../../features/input/panelHotkey';
import { normalizeKeybind, formatKeybind, createKeybindButton } from '../../pets/petsWindow/helpers';
import { t } from '../../../i18n';
import { startControllerStatus } from '../../panel/tileStatusesCore';
import { startShopKeybindsStatus, startPanelShortcutStatus } from '../../panel/tileStatusesNew';
import { getDiagnosticsCard } from '../../../diagnostics/configCard';

const SHOP_IDS: readonly ShopId[] = ['seedShop', 'eggShop', 'toolShop', 'decorShop'];
const SHOP_I18N_KEYS: Record<ShopId, string> = {
  seedShop: 'feature.shopKeybinds.seedShop',
  eggShop: 'feature.shopKeybinds.eggShop',
  toolShop: 'feature.shopKeybinds.toolShop',
  decorShop: 'feature.shopKeybinds.decorShop',
};
const KEYBIND_BUTTON_STYLE = [
  'min-width:100px',
  'text-align:center',
  'background:rgba(255,255,255,0.06)',
  'border:1px solid var(--qpm-accent-border)',
  'border-radius:5px',
  'color:#e0e0e0',
  'font-family:inherit',
  'font-size:12px',
  'padding:5px 8px',
  'cursor:pointer',
  'white-space:nowrap',
  'overflow:hidden',
  'text-overflow:ellipsis',
].join(';');

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildToggleRow(label: string, checked: boolean, onChange: (v: boolean) => void): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('label');
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:10px',
    'padding:8px 10px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
    'cursor:pointer',
  ].join(';');

  const text = document.createElement('div');
  text.style.cssText = 'font-size:12px;font-weight:600;color:#e0e0e0;';
  text.textContent = label;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:var(--qpm-accent);';
  input.addEventListener('change', () => onChange(input.checked));

  row.append(text, input);
  return { row, input };
}

// ── Shop Keybinds ────────────────────────────────────────────────────────────

export function renderShopKeybindsExpanded(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  // Toggle
  const { row: toggleRow, input: toggleInput } = buildToggleRow(t('common.enabled'), isShopKeybindsEnabled(), (v) => {
    setShopKeybindsEnabled(v);
    syncEnabled();
  });
  container.appendChild(toggleRow);

  // Binds
  const bindsWrap = document.createElement('div');
  bindsWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  container.appendChild(bindsWrap);

  function syncEnabled(): void {
    const on = toggleInput.checked;
    bindsWrap.style.opacity = on ? '1' : '0.45';
    bindsWrap.style.pointerEvents = on ? '' : 'none';
  }

  for (const shopId of SHOP_IDS) {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:10px',
      'padding:8px 10px',
      'border-radius:8px',
      'border:1px solid rgba(255,255,255,0.08)',
      'background:rgba(255,255,255,0.03)',
    ].join(';');

    const label = document.createElement('div');
    label.style.cssText = 'font-size:12px;font-weight:600;color:#e0e0e0;';
    label.textContent = t(SHOP_I18N_KEYS[shopId]);

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const kbDisplay = document.createElement('button');
    kbDisplay.type = 'button';
    kbDisplay.style.cssText = [
      'min-width:90px',
      'text-align:center',
      'background:rgba(255,255,255,0.06)',
      'border:1px solid var(--qpm-accent-border)',
      'border-radius:5px',
      'color:#e0e0e0',
      'font-family:inherit',
      'font-size:12px',
      'padding:5px 8px',
      'cursor:pointer',
      'white-space:nowrap',
    ].join(';');

    let recording = false;

    function updateDisplay(): void {
      const binds = getAllShopKeybinds();
      const combo = binds[shopId];
      kbDisplay.textContent = recording ? t('hub.config.pressKeys') : (combo ? formatKeybind(combo) : '\u2014');
      kbDisplay.style.borderColor = recording ? 'var(--qpm-accent)' : 'var(--qpm-accent-border)';
    }
    updateDisplay();

    function onKeyDown(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();
      const combo = normalizeKeybind(e);
      if (!combo || combo === 'Escape') {
        stopRecording();
        return;
      }
      setShopKeybind(shopId, combo);
      stopRecording();
    }

    function startRecording(): void {
      recording = true;
      updateDisplay();
      document.addEventListener('keydown', onKeyDown, true);
    }

    function stopRecording(): void {
      recording = false;
      document.removeEventListener('keydown', onKeyDown, true);
      updateDisplay();
    }

    kbDisplay.addEventListener('click', () => {
      if (recording) stopRecording();
      else startRecording();
    });

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = '×';
    resetBtn.title = t('hub.config.resetToDefault');
    resetBtn.style.cssText = [
      'background:rgba(255,100,100,0.1)',
      'border:1px solid rgba(255,100,100,0.25)',
      'color:#ff8888',
      'font-size:14px',
      'cursor:pointer',
      'padding:2px 6px',
      'border-radius:4px',
      'line-height:1',
    ].join(';');
    resetBtn.addEventListener('click', () => {
      clearShopKeybind(shopId);
      updateDisplay();
    });

    right.append(kbDisplay, resetBtn);
    row.append(label, right);
    bindsWrap.appendChild(row);
  }

  syncEnabled();
  return () => {};
}

export function renderPanelShortcutExpanded(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:10px',
    'padding:8px 10px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
  ].join(';');

  const label = document.createElement('div');
  label.style.cssText = 'font-size:12px;font-weight:600;color:#e0e0e0;';
  label.textContent = t('hub.config.panelShortcut.togglePanel');

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;align-items:center;gap:6px;';

  const kbDisplay = createKeybindButton({
    onSet: setPanelToggleKeybind,
    onClear: resetPanelToggleKeybind,
    readCurrent: getPanelToggleKeybind,
  });
  kbDisplay.style.cssText = KEYBIND_BUTTON_STYLE;

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = '×';
  resetBtn.title = 'Reset to default';
  resetBtn.style.cssText = [
    'background:rgba(255,100,100,0.1)',
    'border:1px solid rgba(255,100,100,0.25)',
    'color:#ff8888',
    'font-size:14px',
    'cursor:pointer',
    'padding:2px 6px',
    'border-radius:4px',
    'line-height:1',
  ].join(';');
  resetBtn.addEventListener('click', () => {
    resetPanelToggleKeybind();
    kbDisplay.textContent = formatKeybind(getPanelToggleKeybind());
  });

  right.append(kbDisplay, resetBtn);
  row.append(label, right);
  container.appendChild(row);

  const note = document.createElement('div');
  note.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.48);line-height:1.45;padding:0 2px;';
  note.textContent = t('hub.config.panelShortcut.note');
  container.appendChild(note);

  return () => {};
}

// ── Group definition ─────────────────────────────────────────────────────────

export function getConfigGroup(): HubGroupDef {
  const controllerCard: ExpandableCardConfig = {
    key: 'controller',
    label: t('hub.config.controller.label'),
    description: t('hub.config.controller.description'),
    icon: { kind: 'sprite', value: '🎮', spriteKey: 'sprite/ui/Touchpad', fallback: '🎮' },
    labelColor: '#60a5fa',
    tier: 'expandable',
    tile: {
      icon: '🎮',
      color: 'rgba(96, 125, 139, 0.28)',
      defaultStatus: '0 binds / medium / no gamepad',
      statusProvider: startControllerStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.config.controller.summary');
    },
    renderExpanded: (container) => {
      // overflow left to parent hub scroll container
      import('../../sections/controllerSection').then(({ createControllerSection }) => {
        container.appendChild(createControllerSection(null, null));
      }).catch(e => log('⚠️ Failed to load Controller', e));
    },
    detachWindowId: 'utility-feature-controller',
    onDetach: () => {
      toggleWindow('utility-feature-controller', '🎮 Controller Settings', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../sections/controllerSection').then(({ createControllerSection }) => {
          root.appendChild(createControllerSection(null, null));
        }).catch(e => log('⚠️ Failed to load Controller', e));
      }, '580px', '78vh');
    },
  };

  const shopKeybindsCard: ExpandableCardConfig = {
    key: 'shop-keybinds',
    label: t('hub.config.shopKeybinds.label'),
    description: t('hub.config.shopKeybinds.description'),
    icon: { kind: 'sprite', value: '⌨️', spriteKey: 'sprite/ui/ArrowKeys', fallback: '⌨️' },
    tier: 'expandable',
    tile: {
      icon: '⌨️',
      color: 'rgba(96, 165, 250, 0.28)',
      defaultStatus: 'Off',
      statusProvider: startShopKeybindsStatus,
      action: () => {
        toggleWindow('config-shop-keybinds', `⌨️ ${t('hub.config.shopKeybinds.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          renderShopKeybindsExpanded(root);
        }, '420px', '60vh');
      },
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = isShopKeybindsEnabled() ? t('common.enabled') : t('common.disabled');
    },
    renderExpanded: renderShopKeybindsExpanded,
  };

  const panelShortcutCard: ExpandableCardConfig = {
    key: 'panel-shortcut',
    label: t('hub.config.panelShortcut.label'),
    description: t('hub.config.panelShortcut.description'),
    icon: { kind: 'sprite', value: '⌨️', spriteKey: 'sprite/ui/ArrowKeys', fallback: '⌨️' },
    labelColor: '#a78bfa',
    tier: 'expandable',
    tile: {
      icon: '⌨️',
      color: 'rgba(167, 139, 250, 0.28)',
      defaultStatus: 'Alt+Q',
      statusProvider: startPanelShortcutStatus,
      action: () => {
        toggleWindow('config-panel-shortcut', `⌨️ ${t('hub.config.panelShortcut.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          renderPanelShortcutExpanded(root);
        }, '420px', '50vh');
      },
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      return onPanelToggleKeybindChange((combo) => {
        el.textContent = t('hub.config.panelShortcut.summary', { keybind: formatKeybind(combo) });
      });
    },
    renderExpanded: renderPanelShortcutExpanded,
  };

  const resetToursCard: ExpandableCardConfig = {
    key: 'reset-tours',
    label: t('hub.config.resetTours.label', undefined, 'Tutorials'),
    description: t('hub.config.resetTours.description', undefined, 'Reset all guided tours so they show again'),
    icon: { kind: 'emoji', value: '?' },
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.config.resetTours.summary', undefined, 'Replay first-time walkthroughs');
    },
    renderExpanded: (container) => {
      container.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

      // ── Toggle row ──
      const toggleRow = document.createElement('div');
      toggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0 2px;';

      const toggleLabel = document.createElement('div');
      toggleLabel.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
      const toggleTitle = document.createElement('span');
      toggleTitle.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.9);font-weight:500;';
      toggleTitle.textContent = 'Show guided tours';
      const toggleSub = document.createElement('span');
      toggleSub.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);';
      toggleSub.textContent = 'Auto-play walkthroughs when opening features for the first time';
      toggleLabel.appendChild(toggleTitle);
      toggleLabel.appendChild(toggleSub);

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:#8f82ff;';

      import('../../tour').then(({ getToursEnabled, setToursEnabled }) => {
        toggle.checked = getToursEnabled();
        toggle.addEventListener('change', () => {
          setToursEnabled(toggle.checked);
        });
      });

      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(toggle);
      container.appendChild(toggleRow);

      // ── Divider ──
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:rgba(120,130,170,0.15);';
      container.appendChild(divider);

      // ── Note ──
      const note = document.createElement('div');
      note.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.6);line-height:1.45;padding:0 2px;';
      note.textContent = t('hub.config.resetTours.note', undefined, 'This resets progress for all guided tours. They will show again the next time you open each window.');
      container.appendChild(note);

      // ── Reset button ──
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t('hub.config.resetTours.button', undefined, 'Reset all tutorials');
      btn.style.cssText = [
        'padding:8px 16px',
        'font-size:13px',
        'font-weight:600',
        'border-radius:8px',
        'cursor:pointer',
        'border:1px solid rgba(255,100,100,0.35)',
        'background:rgba(255,100,100,0.12)',
        'color:#ff8888',
        'transition:all 0.15s',
        'align-self:flex-start',
      ].join(';');
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255,100,100,0.2)';
        btn.style.borderColor = 'rgba(255,100,100,0.5)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(255,100,100,0.12)';
        btn.style.borderColor = 'rgba(255,100,100,0.35)';
      });
      btn.addEventListener('click', () => {
        import('../../tour').then(({ resetAllTours }) => {
          resetAllTours();
          btn.textContent = t('hub.config.resetTours.done', undefined, 'Done — tours will replay on next open');
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'default';
        });
      });
      container.appendChild(btn);
    },
  };

  return {
    id: 'config',
    label: t('hub.config.label'),
    icon: { kind: 'emoji', value: '⚙️' },
    cards: [controllerCard, panelShortcutCard, shopKeybindsCard, getDiagnosticsCard(), resetToursCard],
  };
}
