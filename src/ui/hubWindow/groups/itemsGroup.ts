// src/ui/hubWindow/groups/itemsGroup.ts

import type { HubGroupDef, ExpandableCardConfig } from '../cards/types';
import { toggleWindow } from '../../modalWindow';
import { log } from '../../../utils/logger';

export function getItemsGroup(): HubGroupDef {
  const favoritesCard: ExpandableCardConfig = {
    key: 'favorites',
    label: 'Favorites',
    description: 'Auto-favorite rules and bulk favorite actions',
    icon: { kind: 'sprite', value: '⭐', spriteKey: 'sprite/ui/Favorite', fallback: '⭐' },
    tier: 'expandable',
    renderSummary: (el) => { el.textContent = 'Auto-rules + bulk favorite/unfavorite'; },
    renderExpanded: (container) => {
      container.style.overflowY = 'auto';
      const spinner = document.createElement('div');
      spinner.style.cssText = 'color:rgba(224,224,224,0.45);font-size:12px;padding:8px;';
      spinner.textContent = '⏳ Loading...';
      container.appendChild(spinner);

      let cleanup: (() => void) | undefined;
      (async () => {
        try {
          const { createFavoritesSection } = await import('../../sections/favoritesSection');
          const result = createFavoritesSection();
          spinner.remove();
          container.appendChild(result.element);
          cleanup = result.cleanup;
        } catch (err) {
          log('⚠️ Failed to load Favorites', err);
          spinner.textContent = '❌ Failed to load';
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
    label: 'Protection',
    description: 'Inventory locks, harvest guards, and capacity alerts',
    icon: { kind: 'sprite', value: '🛡️', spriteKey: 'sprite/ui/Lock', fallback: '🛡️' },
    tier: 'expandable',
    renderSummary: (el) => { el.textContent = 'Action guards + capacity warnings'; },
    renderExpanded: (container) => {
      container.style.overflowY = 'auto';
      const spinner = document.createElement('div');
      spinner.style.cssText = 'color:rgba(224,224,224,0.45);font-size:12px;padding:8px;';
      spinner.textContent = '⏳ Loading...';
      container.appendChild(spinner);

      let cleanup: (() => void) | undefined;
      (async () => {
        try {
          const { createProtectionSection } = await import('../../sections/protectionSection');
          const result = createProtectionSection();
          spinner.remove();
          container.appendChild(result.element);
          cleanup = result.cleanup;
        } catch (err) {
          log('⚠️ Failed to load Protection', err);
          spinner.textContent = '❌ Failed to load';
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
    label: 'Calculator',
    description: 'Calculate crop and pet sell values with mutations',
    icon: { kind: 'sprite', value: '🧮', spriteKey: 'sprite/ui/Coin', fallback: '🧮' },
    tier: 'expandable',
    renderSummary: (el) => { el.textContent = 'Sell price calculator with bonuses'; },
    renderExpanded: (container) => {
      container.style.overflowY = 'auto';
      // Use a wrapper div so renderCalculator's cssText doesn't overwrite container
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;flex-direction:column;min-height:200px;';
      container.appendChild(wrapper);
      import('../../cropCalculatorWindow').then(({ renderCalculator }) => {
        renderCalculator(wrapper);
      }).catch(e => log('⚠️ Failed to load Calculator', e));
    },
    detachWindowId: 'crop-calculator',
    onDetach: () => {
      import('../../cropCalculatorWindow').then(({ openCalculatorWindow }) => {
        openCalculatorWindow();
      }).catch(e => log('⚠️ Failed to open Calculator', e));
    },
  };

  return {
    id: 'items',
    label: 'Items',
    icon: { kind: 'sprite', value: '🎒', spriteKey: 'sprite/ui/Inventory', fallback: '🎒' },
    cards: [favoritesCard, protectionCard, calculatorCard],
  };
}
