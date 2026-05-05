// src/ui/hubWindow/groups/configGroup.ts

import type { HubGroupDef, InlineToggleConfig, ExpandableCardConfig } from '../cards/types';
import { toggleWindow } from '../../modalWindow';
import { log } from '../../../utils/logger';
import { getAutoReconnectConfig, updateAutoReconnectConfig } from '../../../features/autoReconnect';
import { isShopKeybindsEnabled, setShopKeybindsEnabled } from '../../../features/shopKeybinds';

export function getConfigGroup(): HubGroupDef {
  const autoReconnectCard: InlineToggleConfig = {
    key: 'auto-reconnect',
    label: 'Auto Reconnect',
    description: 'Reconnect automatically after a disconnect',
    icon: { kind: 'sprite', value: '↻', spriteKey: 'sprite/ui/Refresh', fallback: '↻' },
    tier: 'inline-toggle',
    getEnabled: () => getAutoReconnectConfig().enabled,
    setEnabled: (enabled: boolean) => { updateAutoReconnectConfig({ enabled }); },
  };

  const controllerCard: ExpandableCardConfig = {
    key: 'controller',
    label: 'Controller',
    description: 'Gamepad support: analog cursor, D-pad, rebindable buttons',
    icon: { kind: 'sprite', value: '🎮', spriteKey: 'sprite/ui/Controller', fallback: '🎮' },
    tier: 'expandable',
    renderSummary: (el) => { el.textContent = 'Gamepad bindings and cursor config'; },
    renderExpanded: (container) => {
      container.style.overflowY = 'auto';
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

  const shopKeybindsCard: InlineToggleConfig = {
    key: 'shop-keybinds',
    label: 'Shop Keybinds',
    description: 'Keyboard shortcuts to open game shops',
    icon: { kind: 'sprite', value: '⌨️', spriteKey: 'sprite/ui/Key', fallback: '⌨️' },
    tier: 'inline-toggle',
    getEnabled: () => isShopKeybindsEnabled(),
    setEnabled: (enabled: boolean) => { setShopKeybindsEnabled(enabled); },
    renderSettings: (container) => {
      import('../../sections/shopKeybindsSection').then(({ createShopKeybindsSection }) => {
        container.appendChild(createShopKeybindsSection());
        container.style.display = 'block';
      }).catch(e => log('⚠️ Failed to load shop keybinds settings', e));
    },
  };

  return {
    id: 'config',
    label: 'Config',
    icon: { kind: 'sprite', value: '⚙️', spriteKey: 'sprite/ui/Settings', fallback: '⚙️' },
    cards: [autoReconnectCard, controllerCard, shopKeybindsCard],
  };
}
