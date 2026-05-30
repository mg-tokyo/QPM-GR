// src/ui/hubWindow/groups/itemsGroup.ts

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

export function getItemsGroup(): HubGroupDef {
  const favoritesCard: ExpandableCardConfig = {
    key: 'favorites',
    label: t('hub.items.favorites.label'),
    description: t('hub.items.favorites.description'),
    icon: { kind: 'sprite', value: '⭐', spriteKey: 'sprite/ui/HeartSticker', fallback: '⭐' },
    labelColor: '#f472b6',
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.items.favorites.summary');
    },
    renderExpanded: (container) => {
      const spinner = document.createElement('div');
      spinner.style.cssText = 'color:rgba(224,224,224,0.45);font-size:12px;padding:8px;';
      spinner.textContent = `⏳ ${t('common.loading')}`;
      container.appendChild(spinner);

      let cleanup: (() => void) | undefined;
      (async () => {
        try {
          await awaitCatalogs();
          const { createFavoritesSection } = await import('../../sections/favoritesSection');
          const result = createFavoritesSection();
          spinner.remove();
          container.appendChild(result.element);
          cleanup = result.cleanup;
        } catch (err) {
          log('⚠️ Failed to load Favorites', err);
          spinner.textContent = `❌ ${t('common.loadError')}`;
        }
      })();
      return () => { if (cleanup) cleanup(); };
    },
    detachWindowId: 'hub-favorites',
    onDetach: () => {
      toggleWindow('hub-favorites', '⭐ Favorites', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../sections/favoritesSection').then(({ createFavoritesSection }) => {
          const { element } = createFavoritesSection();
          root.appendChild(element);
        }).catch(e => log('⚠️ Failed to load Favorites', e));
      }, '580px', '78vh');
    },
  };

  const protectionCard: ExpandableCardConfig = {
    key: 'protection',
    label: t('hub.items.protection.label'),
    description: t('hub.items.protection.description'),
    icon: { kind: 'sprite', value: '🛡️', spriteKey: 'sprite/ui/Locked', fallback: '🛡️' },
    labelColor: '#fb923c',
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.items.protection.summary');
    },
    renderExpanded: (container) => {
      const spinner = document.createElement('div');
      spinner.style.cssText = 'color:rgba(224,224,224,0.45);font-size:12px;padding:8px;';
      spinner.textContent = `⏳ ${t('common.loading')}`;
      container.appendChild(spinner);

      let cleanup: (() => void) | undefined;
      (async () => {
        try {
          await awaitCatalogs();
          const { createProtectionSection } = await import('../../sections/protectionSection');
          const result = createProtectionSection();
          spinner.remove();
          container.appendChild(result.element);
          cleanup = result.cleanup;
        } catch (err) {
          log('⚠️ Failed to load Protection', err);
          spinner.textContent = `❌ ${t('common.loadError')}`;
        }
      })();
      return () => { if (cleanup) cleanup(); };
    },
    detachWindowId: 'hub-protection',
    onDetach: () => {
      toggleWindow('hub-protection', '🛡️ Protection', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../sections/protectionSection').then(({ createProtectionSection }) => {
          const { element } = createProtectionSection();
          root.appendChild(element);
        }).catch(e => log('⚠️ Failed to load Protection', e));
      }, '580px', '78vh');
    },
  };

  const calculatorCard: ExpandableCardConfig = {
    key: 'calculator',
    label: t('hub.items.calculator.label'),
    description: t('hub.items.calculator.description'),
    icon: { kind: 'sprite', value: '🧮', spriteKey: 'sprite/ui/Coin', fallback: '🧮' },
    labelColor: '#fbbf24',
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.items.calculator.summary');
    },
    renderExpanded: (container) => {
      const spinner = document.createElement('div');
      spinner.style.cssText = 'color:rgba(224,224,224,0.45);font-size:12px;padding:8px;';
      spinner.textContent = `⏳ ${t('common.loading')}`;
      container.appendChild(spinner);

      (async () => {
        try {
          await awaitCatalogs();
          spinner.remove();
          const wrapper = document.createElement('div');
          wrapper.style.cssText = 'display:flex;flex-direction:column;min-height:200px;';
          container.appendChild(wrapper);
          const { renderCalculator } = await import('../../economy/cropCalculatorWindow');
          renderCalculator(wrapper);
        } catch (err) {
          log('⚠️ Failed to load Calculator', err);
          spinner.textContent = `❌ ${t('common.loadError')}`;
        }
      })();
    },
    detachWindowId: 'crop-calculator',
    onDetach: () => {
      import('../../economy/cropCalculatorWindow').then(({ openCalculatorWindow }) => {
        openCalculatorWindow();
      }).catch(e => log('⚠️ Failed to open Calculator', e));
    },
  };

  const petTeamsCard: LauncherCardConfig = {
    key: 'pet-teams',
    label: t('hub.items.petTeams.label'),
    description: t('hub.items.petTeams.description'),
    icon: {
      kind: 'sprite', value: '🐾', fallback: '🐾',
      bunched: [
        { spriteKey: 'sprite/pet/Peacock', mutations: ['Rainbow'], offsetX: -8, scale: 0.85 },
        { spriteKey: 'sprite/pet/Capybara', offsetX: 8, offsetY: 1, scale: 0.8 },
      ],
    },
    labelColor: '#818cf8',
    tier: 'launcher',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.items.petTeams.summary');
    },
    onOpen: () => {
      import('../../petsWindow').then(({ togglePetsWindow }) => {
        togglePetsWindow();
      }).catch(e => log('⚠️ Failed to open Pet Teams', e));
    },
  };

  const valueDisplayCard: LauncherCardConfig = {
    key: 'value-display',
    label: t('hub.items.valueDisplay.label'),
    description: t('hub.items.valueDisplay.description'),
    icon: { kind: 'sprite', value: '💰', spriteKey: 'sprite/ui/CoinBag', fallback: '💰' },
    labelColor: '#a3e635',
    tier: 'launcher',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.items.valueDisplay.summary');
    },
    onOpen: () => {
      toggleWindow('trackers-v2-storageValue', '💰 Value Display', (root) => {
        root.style.cssText = 'overflow-y:auto;';
        import('../../economy/storageValueWindow').then(({ renderStorageValueSettings }) => {
          renderStorageValueSettings(root);
        }).catch(e => log('⚠️ Failed to load Value Display', e));
      }, '420px', '78vh');
    },
  };

  return {
    id: 'items',
    label: t('hub.items.label'),
    icon: {
      kind: 'sprite', value: '🎒', fallback: '🎒',
      bunched: [
        { spriteKey: 'sprite/ui/InventoryBag', offsetX: -10, scale: 1.0 },
        { spriteKey: 'sprite/ui/HeartSticker', offsetX: 2, offsetY: -3, scale: 0.8 },
        { spriteKey: 'sprite/ui/CoinBag', offsetX: 12, offsetY: 2, scale: 0.85 },
      ],
    },
    cards: [favoritesCard, protectionCard, petTeamsCard, calculatorCard, valueDisplayCard],
  };
}
