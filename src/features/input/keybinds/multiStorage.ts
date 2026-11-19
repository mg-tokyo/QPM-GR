// Multi-storage key actions: both start unbound (multi-storage plan D2); the feature stays inert until one is bound.

import { resetLayoutFromKey, toggleStoragesFromKey } from '../../multiStorage';
import type { RunnableAction } from './types';

export function buildMultiStorageActions(): RunnableAction[] {
  return [
    { id: 'multiStorage', section: 'gamePanels', run: toggleStoragesFromKey },
    { id: 'multiStorageReset', section: 'gamePanels', run: () => Promise.resolve().then(resetLayoutFromKey) },
  ];
}
