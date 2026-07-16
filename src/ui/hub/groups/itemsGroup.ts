// src/ui/hubWindow/groups/itemsGroup.ts

import type { HubGroupDef, ExpandableCardConfig, LauncherCardConfig } from '../cards/types';
import { toggleWindow, windowLog } from '../../core/modalWindow';
import { waitForCatalogs } from '../../../catalogs/gameCatalogs';
import { t } from '../../../i18n';
import {
  startProtectionStatus,
  startCropCalculatorStatus,
  startValueDisplayStatus,
} from '../../panel/tileStatusesCore';
import { startFavoritesStatus } from '../../panel/tileStatusesNew';

async function awaitCatalogs(): Promise<void> {
  try { await waitForCatalogs(10000); }
  catch { /* catalogs subsystem attributes the timeout; hub renders with fallbacks */ }
}

export function getItemsGroup(): HubGroupDef {
  const favoritesCard: ExpandableCardConfig = {
    key: 'favorites',
    label: t('hub.items.favorites.label'),
    description: t('hub.items.favorites.description'),
    icon: { kind: 'sprite', value: '⭐', spriteKey: 'sprite/ui/HeartSticker', fallback: '⭐' },
    labelColor: '#f472b6',
    tier: 'expandable',
    tile: {
      icon: '⭐',
      color: 'rgba(244, 114, 182, 0.28)',
      defaultStatus: 'Off / 0 rules',
      statusProvider: startFavoritesStatus,
    },
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
          windowLog.warn('QPM-UI-002', { what: 'lazy:favs' }, err);
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
        }).catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:favs' }, e));
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
    tile: {
      tileId: 'locker',
      icon: '🔒',
      color: 'rgba(244, 67, 54, 0.28)',
      defaultStatus: 'locker off / 0 slots / 0 fav',
      statusProvider: startProtectionStatus,
    },
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
          windowLog.warn('QPM-UI-002', { what: 'lazy:protect' }, err);
          spinner.textContent = `❌ ${t('common.loadError')}`;
        }
      })();
      return () => { if (cleanup) cleanup(); };
    },
    detachWindowId: 'utility-feature-protection',
    onDetach: () => {
      toggleWindow('utility-feature-protection', '🛡️ Protection', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../sections/protectionSection').then(({ createProtectionSection }) => {
          const { element } = createProtectionSection();
          root.appendChild(element);
        }).catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:protect' }, e));
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
    tile: {
      tileId: 'crop-calculator',
      icon: '🧮',
      color: 'rgba(3, 169, 244, 0.28)',
      defaultStatus: '0 crops / 0 pets / catalogs loading',
      statusProvider: startCropCalculatorStatus,
    },
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
          windowLog.warn('QPM-UI-002', { what: 'lazy:calc' }, err);
          spinner.textContent = `❌ ${t('common.loadError')}`;
        }
      })();
    },
    detachWindowId: 'crop-calculator',
    onDetach: () => {
      import('../../economy/cropCalculatorWindow').then(({ openCalculatorWindow }) => {
        openCalculatorWindow();
      }).catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:calc' }, e));
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
    tile: {
      icon: '👥',
      color: 'rgba(255, 152, 0, 0.28)',
      defaultStatus: '0 active / 0 teams / 0 slots',
      // statusProvider handled by multi-tile startPetDerivedStatuses
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.items.petTeams.summary');
    },
    onOpen: () => {
      import('../../pets/petsWindow').then(({ togglePetsWindow }) => {
        togglePetsWindow();
      }).catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:petTeams' }, e));
    },
  };

  const valueDisplayCard: LauncherCardConfig = {
    key: 'value-display',
    label: t('hub.items.valueDisplay.label'),
    description: t('hub.items.valueDisplay.description'),
    icon: { kind: 'sprite', value: '💰', spriteKey: 'sprite/ui/CoinBag', fallback: '💰' },
    labelColor: '#a3e635',
    tier: 'launcher',
    tile: {
      icon: '💰',
      color: 'rgba(255, 193, 7, 0.28)',
      defaultStatus: '0/4 surfaces / 0 inv / 0 coins',
      statusProvider: startValueDisplayStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.items.valueDisplay.summary');
    },
    onOpen: () => {
      toggleWindow('trackers-v2-storageValue', '💰 Value Display', (root) => {
        root.style.cssText = 'overflow-y:auto;';
        import('../../economy/storageValueWindow').then(({ renderStorageValueSettings }) => {
          renderStorageValueSettings(root);
        }).catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:valDisp' }, e));
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
