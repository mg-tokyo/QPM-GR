// src/ui/hubWindow/groups/configGroup.ts

import type { HubGroupDef, ExpandableCardConfig } from '../cards/types';
import { toggleWindow } from '../../modalWindow';
import { log } from '../../../utils/logger';
import {
  getAutoReconnectConfig,
  updateAutoReconnectConfig,
  subscribeToAutoReconnectConfig,
} from '../../../features/autoReconnect';
import {
  isShopKeybindsEnabled,
  setShopKeybindsEnabled,
  getAllShopKeybinds,
  setShopKeybind,
  clearShopKeybind,
  type ShopId,
} from '../../../features/shopKeybinds';
import {
  getPanelToggleKeybind,
  setPanelToggleKeybind,
  resetPanelToggleKeybind,
  onPanelToggleKeybindChange,
} from '../../../features/panelHotkey';
import { normalizeKeybind, formatKeybind, createKeybindButton } from '../../petsWindow/helpers';
import { t } from '../../../i18n';

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

// ── Auto Reconnect ───────────────────────────────────────────────────────────

export function renderAutoReconnectExpanded(container: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  container.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

  const cfg = getAutoReconnectConfig();

  // Toggle
  const { row: toggleRow, input: toggleInput } = buildToggleRow(t('common.enabled'), cfg.enabled, (v) => {
    updateAutoReconnectConfig({ enabled: v });
  });
  container.appendChild(toggleRow);

  // Delay slider
  const sliderWrap = document.createElement('div');
  sliderWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:4px 2px;';

  const sliderLabel = document.createElement('div');
  sliderLabel.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.7);';

  function formatDelay(ms: number): string {
    const s = Math.round(ms / 1000);
    return s === 0 ? t('hub.config.autoReconnect.delayInstant') : `${s}s`;
  }
  sliderLabel.textContent = t('hub.config.autoReconnect.delayLabel', { delay: formatDelay(cfg.delayMs) });

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '300';
  slider.step = '5';
  slider.value = String(Math.round(cfg.delayMs / 1000));
  slider.style.cssText = 'width:100%;accent-color:var(--qpm-accent);cursor:pointer;';
  slider.addEventListener('input', () => {
    const seconds = Number(slider.value);
    sliderLabel.textContent = t('hub.config.autoReconnect.delayLabel', { delay: formatDelay(seconds * 1000) });
    updateAutoReconnectConfig({ delayMs: seconds * 1000 });
  });

  sliderWrap.append(sliderLabel, slider);
  container.appendChild(sliderWrap);

  // Subscribe to external changes
  const unsub = subscribeToAutoReconnectConfig((c) => {
    toggleInput.checked = c.enabled;
    const s = Math.round(c.delayMs / 1000);
    slider.value = String(s);
    sliderLabel.textContent = t('hub.config.autoReconnect.delayLabel', { delay: formatDelay(c.delayMs) });
  });
  cleanups.push(unsub);

  return () => { cleanups.forEach(fn => fn()); };
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
  const autoReconnectCard: ExpandableCardConfig = {
    key: 'auto-reconnect',
    label: t('hub.config.autoReconnect.label'),
    description: t('hub.config.autoReconnect.description'),
    icon: { kind: 'sprite', value: '↻', spriteKey: 'sprite/ui/ProgressStar', fallback: '↻' },
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      function update(): void {
        const cfg = getAutoReconnectConfig();
        const s = Math.round(cfg.delayMs / 1000);
        const delay = s === 0
          ? t('hub.config.autoReconnect.delayInstant')
          : t('hub.config.autoReconnect.delaySeconds', { seconds: s });
        el.textContent = cfg.enabled
          ? t('hub.config.autoReconnect.summaryEnabled', { delay })
          : t('hub.config.autoReconnect.summaryDisabled');
      }
      update();
      const unsub = subscribeToAutoReconnectConfig(update);
      return unsub;
    },
    renderExpanded: renderAutoReconnectExpanded,
  };

  const controllerCard: ExpandableCardConfig = {
    key: 'controller',
    label: t('hub.config.controller.label'),
    description: t('hub.config.controller.description'),
    icon: { kind: 'sprite', value: '🎮', spriteKey: 'sprite/ui/Touchpad', fallback: '🎮' },
    labelColor: '#60a5fa',
    tier: 'expandable',
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      return onPanelToggleKeybindChange((combo) => {
        el.textContent = t('hub.config.panelShortcut.summary', { keybind: formatKeybind(combo) });
      });
    },
    renderExpanded: renderPanelShortcutExpanded,
  };

  return {
    id: 'config',
    label: t('hub.config.label'),
    icon: { kind: 'emoji', value: '⚙️' },
    cards: [autoReconnectCard, controllerCard, panelShortcutCard, shopKeybindsCard],
  };
}
