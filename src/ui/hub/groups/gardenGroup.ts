// src/ui/hub/groups/gardenGroup.ts

import type { HubGroupDef, ExpandableCardConfig, LauncherCardConfig } from '../cards/types';
import { toggleWindow } from '../../core/modalWindow';
import { log } from '../../../utils/logger';
import { waitForCatalogs } from '../../../catalogs/gameCatalogs';
import { getGardenQolConfig, updateGardenQolConfig, type HoldContexts } from '../../../features/gardenQol/index';
import { t } from '../../../i18n';
import {
  startGardenFiltersStatus,
  startRemindersStatus,
  startGardenStatsStatus,
  startInstaHarvestStatus,
  startHoldSettingsStatus,
  startInventoryCapacityStatus,
} from '../../panel/tileStatusesNew';

/** Best-effort catalog wait — never rejects, just logs and continues */
async function awaitCatalogs(): Promise<void> {
  try { await waitForCatalogs(10000); }
  catch { log('[Hub] Catalogs not ready yet, rendering with fallbacks'); }
}

// ── Extracted render functions for tile actions ──────────────────────────────

function renderInstaHarvestExpanded(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  wrap.appendChild(buildQolToggle('Rainbow', () => getGardenQolConfig().instaHarvestRainbow, (v) => updateGardenQolConfig({ instaHarvestRainbow: v })));
  wrap.appendChild(buildQolToggle('Gold', () => getGardenQolConfig().instaHarvestGold, (v) => updateGardenQolConfig({ instaHarvestGold: v })));
  wrap.appendChild(buildQolToggle(t('feature.locker.ariesHold'), () => getGardenQolConfig().ariesHold, (v) => updateGardenQolConfig({ ariesHold: v })));
  container.appendChild(wrap);
}

function renderHoldSettingsExpanded(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  // Hold rate slider
  const rateRow = document.createElement('div');
  rateRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  const rateLabel = document.createElement('div');
  rateLabel.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff)';
  rateLabel.textContent = t('feature.locker.holdRate');
  const rateValue = document.createElement('div');
  rateValue.style.cssText = 'font-size:12px;color:var(--qpm-accent,#8f82ff);font-weight:600';
  const cfg = getGardenQolConfig();
  rateValue.textContent = `${cfg.holdRateHz} Hz`;
  rateRow.append(rateLabel, rateValue);
  wrap.appendChild(rateRow);

  const rateSlider = document.createElement('input');
  rateSlider.type = 'range'; rateSlider.min = '5'; rateSlider.max = '20'; rateSlider.step = '1';
  rateSlider.value = String(cfg.holdRateHz);
  rateSlider.style.cssText = 'width:100%;cursor:pointer';
  rateSlider.addEventListener('input', () => { rateValue.textContent = `${rateSlider.value} Hz`; });
  rateSlider.addEventListener('change', () => { updateGardenQolConfig({ holdRateHz: Number(rateSlider.value) }); });
  wrap.appendChild(rateSlider);

  // Hold context checkboxes
  const ctxKeys: Array<{ key: keyof HoldContexts; label: string }> = [
    { key: 'harvest', label: t('feature.locker.ctx.harvest') },
    { key: 'plant',   label: t('feature.locker.ctx.plant') },
    { key: 'shovel',  label: t('feature.locker.ctx.shovel') },
    { key: 'sell',    label: t('feature.locker.ctx.sell') },
    { key: 'hatch',   label: t('feature.locker.ctx.hatch') },
    { key: 'other',   label: t('feature.locker.ctx.other') },
  ];
  for (const { key, label } of ctxKeys) {
    wrap.appendChild(buildQolToggle(label, () => getGardenQolConfig().holdContexts[key], (v) => {
      const cur = getGardenQolConfig();
      updateGardenQolConfig({ holdContexts: { ...cur.holdContexts, [key]: v } });
    }));
  }

  container.appendChild(wrap);
}

export function getGardenGroup(): HubGroupDef {
  const gardenFiltersCard: ExpandableCardConfig = {
    key: 'garden-filters',
    label: t('hub.garden.gardenFilters.label'),
    description: t('hub.garden.gardenFilters.description'),
    icon: { kind: 'sprite', value: '🔍', spriteKey: 'sprite/plant/RoseRed', spriteMutations: ['Thunderstruck'], fallback: '🔍' },
    labelColor: '#c084fc',
    tier: 'expandable',
    tile: {
      icon: '🔍',
      color: 'rgba(192, 132, 252, 0.28)',
      defaultStatus: 'Off / 0 filters',
      statusProvider: startGardenFiltersStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.garden.gardenFilters.summary');
    },
    renderExpanded: (container) => {
      const spinner = document.createElement('div');
      spinner.style.cssText = 'color:rgba(224,224,224,0.45);font-size:12px;padding:8px;';
      spinner.textContent = `⏳ ${t('common.loading')}`;
      container.appendChild(spinner);

      (async () => {
        try {
          await awaitCatalogs();
          const { createGardenFiltersSection } = await import('../../garden/gardenFiltersSection');
          const el = await createGardenFiltersSection();
          spinner.remove();
          container.appendChild(el);
        } catch (err) {
          log('⚠️ Failed to load Garden Filters', err);
          spinner.textContent = `❌ ${t('common.loadError')}`;
        }
      })();
    },
    detachWindowId: 'utility-feature-garden-filters',
    onDetach: () => {
      toggleWindow('utility-feature-garden-filters', '🔍 Garden Filters', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../garden/gardenFiltersSection').then(async ({ createGardenFiltersSection }) => {
          root.appendChild(await createGardenFiltersSection());
        }).catch(e => log('⚠️ Failed to load Garden Filters', e));
      }, '580px', '78vh');
    },
  };

  const remindersCard: ExpandableCardConfig = {
    key: 'reminders',
    label: t('hub.garden.reminders.label'),
    description: t('hub.garden.reminders.description'),
    icon: { kind: 'sprite', value: '🔔', spriteKey: 'sprite/plant/Mushroom', spriteMutations: ['Dawnlit'], fallback: '🔔' },
    labelColor: '#34d399',
    tier: 'expandable',
    tile: {
      icon: '🔔',
      color: 'rgba(52, 211, 153, 0.28)',
      defaultStatus: '0 ready / 0 pending',
      statusProvider: startRemindersStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.garden.reminders.summary');
    },
    renderExpanded: (container) => {
      // overflow left to parent hub scroll container
      import('../../core/originalPanel').then(({ renderRemindersContent }) => {
        renderRemindersContent(container, { startExpanded: true });
      }).catch(e => log('⚠️ Failed to load Reminders', e));
    },
    detachWindowId: 'utility-feature-reminders',
    onDetach: () => {
      toggleWindow('utility-feature-reminders', '🔔 Reminders', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../core/originalPanel').then(({ renderRemindersContent }) => {
          renderRemindersContent(root);
        }).catch(e => log('⚠️ Failed to load Reminders', e));
      }, '580px', '78vh');
    },
  };

  const statsCard: LauncherCardConfig = {
    key: 'stats',
    label: t('hub.garden.stats.label'),
    description: t('hub.garden.stats.description'),
    icon: {
      kind: 'sprite', value: '🌿', fallback: '🌿',
      bunched: [
        { spriteKey: 'sprite/plant/Starweaver', mutations: ['Rainbow', 'Frozen'], offsetX: -6, scale: 0.85 },
        { spriteKey: 'sprite/pet/MythicalEgg', offsetX: 6, offsetY: 1, scale: 0.8 },
      ],
    },
    labelColor: '#93c5fd',
    tier: 'launcher',
    tile: {
      tileId: 'garden-stats',
      icon: '🌿',
      color: 'rgba(147, 197, 253, 0.28)',
      defaultStatus: '0 species / $0',
      statusProvider: startGardenStatsStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.garden.stats.summary');
    },
    onOpen: () => {
      import('../../stats/statsHubWindow').then(({ openStatsHubWindow }) => {
        openStatsHubWindow();
      }).catch(e => log('⚠️ Failed to open Stats Hub', e));
    },
  };

  const instaHarvestCard: ExpandableCardConfig = {
    key: 'insta-harvest',
    label: t('hub.garden.instaHarvest.label'),
    description: t('hub.garden.instaHarvest.description'),
    icon: { kind: 'sprite', value: '⚡', spriteKey: 'sprite/plant/RoseRed', spriteMutations: ['Rainbow'], fallback: '⚡' },
    labelColor: '#fbbf24',
    tier: 'expandable',
    tile: {
      icon: '⚡',
      color: 'rgba(255, 191, 36, 0.28)',
      defaultStatus: 'Off',
      statusProvider: startInstaHarvestStatus,
      action: () => {
        toggleWindow('garden-insta-harvest', `⚡ ${t('hub.garden.instaHarvest.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          renderInstaHarvestExpanded(root);
        }, '420px', '50vh');
      },
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      const cfg = getGardenQolConfig();
      const parts: string[] = [];
      if (cfg.instaHarvestRainbow) parts.push('Rainbow');
      if (cfg.instaHarvestGold) parts.push('Gold');
      if (cfg.ariesHold) parts.push('Hold');
      el.textContent = parts.length > 0 ? parts.join(', ') : t('common.disabled');
    },
    renderExpanded: renderInstaHarvestExpanded,
  };

  const holdSettingsCard: ExpandableCardConfig = {
    key: 'hold-settings',
    label: t('hub.garden.holdSettings.label'),
    description: t('hub.garden.holdSettings.description'),
    icon: { kind: 'emoji', value: '🎮' },
    labelColor: '#a78bfa',
    tier: 'expandable',
    tile: {
      icon: '🎮',
      color: 'rgba(167, 139, 250, 0.28)',
      defaultStatus: '10 Hz / 0 ctx',
      statusProvider: startHoldSettingsStatus,
      action: () => {
        toggleWindow('garden-hold-settings', `🎮 ${t('hub.garden.holdSettings.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          renderHoldSettingsExpanded(root);
        }, '420px', '60vh');
      },
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      const cfg = getGardenQolConfig();
      el.textContent = `${cfg.holdRateHz} Hz`;
    },
    renderExpanded: renderHoldSettingsExpanded,
  };

  const inventoryCapacityCard: ExpandableCardConfig = {
    key: 'inventory-capacity',
    label: t('hub.garden.inventoryCapacity.label'),
    description: t('hub.garden.inventoryCapacity.description'),
    icon: { kind: 'emoji', value: '📦' },
    labelColor: '#60a5fa',
    tier: 'expandable',
    tile: {
      icon: '📦',
      color: 'rgba(96, 165, 250, 0.28)',
      defaultStatus: 'Capacity off',
      statusProvider: startInventoryCapacityStatus,
      action: () => {
        toggleWindow('garden-inventory-capacity', `📦 ${t('hub.garden.inventoryCapacity.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../../economy/inventoryCapacitySection').then(({ createInventoryCapacitySection }) => {
            root.appendChild(createInventoryCapacitySection());
          }).catch(e => log('[Hub] Failed to load Inventory Capacity', e));
        }, '420px', '50vh');
      },
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.garden.inventoryCapacity.summary');
    },
    renderExpanded: (container) => {
      import('../../economy/inventoryCapacitySection').then(({ createInventoryCapacitySection }) => {
        container.appendChild(createInventoryCapacitySection());
      }).catch(e => log('[Hub] Failed to load Inventory Capacity', e));
    },
  };

  return {
    id: 'garden',
    label: t('hub.garden.label'),
    icon: {
      kind: 'sprite', value: '🌱', fallback: '🌱',
      bunched: [
        { spriteKey: 'sprite/plant/RoseRed', offsetX: -10, scale: 1.0 },
        { spriteKey: 'sprite/plant/Starweaver', mutations: ['Rainbow', 'Frozen'], offsetX: 3, offsetY: -2, scale: 1.0 },
        { spriteKey: 'sprite/pet/MythicalEgg', offsetX: 12, offsetY: 2, scale: 0.9 },
      ],
    },
    cards: [gardenFiltersCard, instaHarvestCard, holdSettingsCard, inventoryCapacityCard, remindersCard, statsCard],
  };
}

// ── Helper: QOL toggle row ──────────────────────────────────────────────────

function buildQolToggle(label: string, getChecked: () => boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:2px 0';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = 'font-size:12px;color:var(--qpm-text,#eef0ff)';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = getChecked();
  cb.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:var(--qpm-accent,#8f82ff)';
  cb.addEventListener('change', () => onChange(cb.checked));
  row.append(lbl, cb);
  return row;
}
