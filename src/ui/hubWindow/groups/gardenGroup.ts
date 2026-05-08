// src/ui/hubWindow/groups/gardenGroup.ts

import type { HubGroupDef, ExpandableCardConfig, LauncherCardConfig } from '../cards/types';
import { toggleWindow } from '../../modalWindow';
import { log } from '../../../utils/logger';
import { waitForCatalogs } from '../../../catalogs/gameCatalogs';
import { t } from '../../../i18n';

/** Best-effort catalog wait — never rejects, just logs and continues */
async function awaitCatalogs(): Promise<void> {
  try { await waitForCatalogs(10000); }
  catch { log('[Hub] Catalogs not ready yet, rendering with fallbacks'); }
}

export function getGardenGroup(): HubGroupDef {
  const gardenFiltersCard: ExpandableCardConfig = {
    key: 'garden-filters',
    label: t('hub.garden.gardenFilters.label'),
    description: t('hub.garden.gardenFilters.description'),
    icon: { kind: 'sprite', value: '🔍', spriteKey: 'sprite/plant/RoseRed', spriteMutations: ['Thunderstruck'], fallback: '🔍' },
    labelColor: '#c084fc',
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
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
          const { createGardenFiltersSection } = await import('../../sections/gardenFiltersSection');
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
        import('../../sections/gardenFiltersSection').then(async ({ createGardenFiltersSection }) => {
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.garden.reminders.summary');
    },
    renderExpanded: (container) => {
      // overflow left to parent hub scroll container
      import('../../originalPanel').then(({ renderRemindersContent }) => {
        renderRemindersContent(container, { startExpanded: true });
      }).catch(e => log('⚠️ Failed to load Reminders', e));
    },
    detachWindowId: 'utility-feature-reminders',
    onDetach: () => {
      toggleWindow('utility-feature-reminders', '🔔 Reminders', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../originalPanel').then(({ renderRemindersContent }) => {
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.garden.stats.summary');
    },
    onOpen: () => {
      import('../../statsHubWindow').then(({ openStatsHubWindow }) => {
        openStatsHubWindow();
      }).catch(e => log('⚠️ Failed to open Stats Hub', e));
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
    cards: [gardenFiltersCard, remindersCard, statsCard],
  };
}
