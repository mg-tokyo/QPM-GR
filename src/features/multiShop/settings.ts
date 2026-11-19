import { createPanelSettings } from '../multiStorage/settings';

export const MULTI_SHOP_ENABLED_KEY = 'qpm.multiShop.enabled.v1';
export const MULTI_SHOP_PICK_KEY = 'qpm.multiShop.pick.v1';
export const MULTI_SHOP_LAYOUT_KEY = 'qpm.multiShop.layout.v1';

const settings = createPanelSettings({
  enabled: MULTI_SHOP_ENABLED_KEY, pick: MULTI_SHOP_PICK_KEY, layout: MULTI_SHOP_LAYOUT_KEY,
});

export const onMultiShopSettingsChange = settings.onChange;
export const isMultiShopEnabled = settings.isEnabled;
export const setMultiShopEnabled = settings.setEnabled;
/** Shop panel ids (`seedShop`, …); null means every shop. */
export const getShopPick = settings.getPick;
export const setShopPick = settings.setPick;
/** Screen fractions per shop panel id. */
export const getSavedShopLayout = settings.getSavedLayout;
export const saveShopLayoutCells = settings.saveLayoutCells;
export const clearSavedShopLayout = settings.clearSavedLayout;
