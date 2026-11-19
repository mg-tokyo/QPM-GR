// What the two shop key actions run (`multiStorage/panelControl.ts`, shared with multi-storage).
import { t } from '../../i18n';
import { createPanelControl } from '../multiStorage/panelControl';
import { closeShops, disposeShops, resetShopLayout, toggleShops } from './session';
import { isMultiShopEnabled, setMultiShopEnabled } from './settings';

const shopControl = createPanelControl({
  toggle: toggleShops,
  close: closeShops,
  dispose: disposeShops,
  reset: resetShopLayout,
  isEnabled: isMultiShopEnabled,
  setEnabled: setMultiShopEnabled,
  emptyReason: 'no-shops',
  emptyText: () => t('feature.multiShop.noShops'),
  unavailableText: () => t('feature.multiShop.unavailable'),
  layoutResetText: () => t('feature.multiShop.layoutReset'),
  // The game's shop list is read some seconds after a page load (`session.ts` openInner).
  notReady: { missing: 'shop-panels', text: () => t('feature.multiShop.notReady') },
});

export const startMultiShop = shopControl.start;
export const stopMultiShop = shopControl.stop;
export const toggleShopsFromKey = shopControl.toggleFromKey;
export const setShopsEnabled = shopControl.setEnabled;
export const resetShopLayoutFromKey = shopControl.resetFromKey;
