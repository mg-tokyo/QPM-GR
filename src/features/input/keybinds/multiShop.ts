// Multi-shop key actions: both start unbound (multi-shop plan P10); the feature stays inert until one is bound.

import { resetShopLayoutFromKey, toggleShopsFromKey } from '../../multiShop';
import type { RunnableAction } from './types';

export function buildMultiShopActions(): RunnableAction[] {
  return [
    { id: 'multiShop', section: 'gamePanels', run: toggleShopsFromKey },
    { id: 'multiShopReset', section: 'gamePanels', run: () => Promise.resolve().then(resetShopLayoutFromKey) },
  ];
}
