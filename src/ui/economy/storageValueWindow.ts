// src/ui/storageValueWindow.ts
// Storage Value settings window — 4 per-storage toggles

import {
  getStorageValueConfig,
  saveStorageValueConfig,
  getDetectedStorageIds,
  type StorageValueConfig,
} from '../../features/economy/storageValue';
import {
  getTileValueConfig,
  setTileValueConfig,
} from '../../features/standalone/tooltipInjection';
import { t } from '../../i18n';

// ---------------------------------------------------------------------------
// Toggle switch helper
// ---------------------------------------------------------------------------

interface ToggleRow {
  container: HTMLDivElement;
  input: HTMLInputElement;
}

function buildToggle(
  label: string,
  description: string,
  checked: boolean,
  disabled: boolean,
  onChange: (value: boolean) => void,
): ToggleRow {
  const container = document.createElement('div');
  container.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:12px 14px',
    'border:1px solid rgba(143,130,255,0.18)',
    'border-radius:10px',
    'background:rgba(255,255,255,0.02)',
    'transition:border-color 0.15s,background 0.15s',
  ].join(';');

  if (disabled) {
    container.style.opacity = '0.45';
    container.title = t('feature.storageValue.notDetected');
  }

  // Info section
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;';

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:13px;font-weight:600;color:#e0e0e0;margin-bottom:2px;';
  labelEl.textContent = label;

  const descEl = document.createElement('div');
  descEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);line-height:1.5;';
  descEl.textContent = disabled ? `${description} — ${t('feature.storageValue.notDetectedSuffix')}` : description;

  info.append(labelEl, descEl);

  // Toggle input
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.disabled = disabled;
  input.style.cssText = [
    'accent-color:#8f82ff',
    'width:18px',
    'height:18px',
    'cursor:' + (disabled ? 'not-allowed' : 'pointer'),
    'flex-shrink:0',
  ].join(';');

  if (!disabled) {
    input.addEventListener('change', () => {
      onChange(input.checked);
    });

    container.addEventListener('mouseenter', () => {
      container.style.background = 'rgba(143,130,255,0.05)';
      container.style.borderColor = 'rgba(143,130,255,0.32)';
    });
    container.addEventListener('mouseleave', () => {
      container.style.background = 'rgba(255,255,255,0.02)';
      container.style.borderColor = 'rgba(143,130,255,0.18)';
    });
  }

  container.append(info, input);
  return { container, input };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderStorageValueSettings(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:10px',
    'padding:16px',
    'overflow-y:auto',
  ].join(';');

  const config = getStorageValueConfig();
  const detected = getDetectedStorageIds();

  const headerEl = document.createElement('div');
  headerEl.style.cssText = [
    'font-size:12px',
    'color:rgba(232,224,255,0.5)',
    'line-height:1.5',
    'padding-bottom:4px',
    'border-bottom:1px solid rgba(143,130,255,0.15)',
    'margin-bottom:2px',
  ].join(';');
  headerEl.textContent = t('feature.storageValue.header');
  root.appendChild(headerEl);

  const definitions: Array<{
    key: keyof StorageValueConfig;
    label: string;
    desc: string;
    storageId?: string;
  }> = [
    {
      key: 'seedSilo',
      label: t('feature.storageValue.seedSilo'),
      desc: t('feature.storageValue.seedSiloDesc'),
      storageId: 'SeedSilo',
    },
    {
      key: 'petHutch',
      label: t('feature.storageValue.petHutch'),
      desc: t('feature.storageValue.petHutchDesc'),
      storageId: 'PetHutch',
    },
    {
      key: 'decorShed',
      label: t('feature.storageValue.decorShed'),
      desc: t('feature.storageValue.decorShedDesc'),
      storageId: 'DecorShed',
    },
    {
      key: 'inventory',
      label: t('feature.storageValue.inventory'),
      desc: t('feature.storageValue.inventoryDesc'),
    },
  ];

  for (const def of definitions) {
    const isDetected = !def.storageId || detected.has(def.storageId);
    const { container, input } = buildToggle(
      def.label,
      def.desc,
      config[def.key],
      !isDetected,
      (value) => {
        const next = getStorageValueConfig();
        next[def.key] = value;
        saveStorageValueConfig(next);
      },
    );

    // Keep input in sync if config changes externally
    input.checked = config[def.key];

    root.appendChild(container);
  }

  // ── Crop Price toggle (controls tileValueIndicator) ──
  const tileValueCfg = getTileValueConfig();
  const { container: cropPriceContainer } = buildToggle(
    t('feature.storageValue.cropPrice'),
    t('feature.storageValue.cropPriceDesc'),
    tileValueCfg.enabled,
    false,
    (value) => {
      setTileValueConfig({ enabled: value });
    },
  );
  root.appendChild(cropPriceContainer);
}
