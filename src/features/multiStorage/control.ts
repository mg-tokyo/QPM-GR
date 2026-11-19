// What the two storage key actions run (`panelControl.ts`).
import { t } from '../../i18n';
import { createPanelControl } from './panelControl';
import { closeStorages, disposeStorages, resetStorageLayout, toggleStorages } from './session';
import { isMultiStorageEnabled, setMultiStorageEnabled } from './settings';

const storageControl = createPanelControl({
  toggle: toggleStorages,
  close: closeStorages,
  dispose: disposeStorages,
  reset: resetStorageLayout,
  isEnabled: isMultiStorageEnabled,
  setEnabled: setMultiStorageEnabled,
  emptyReason: 'no-storages',
  emptyText: () => t('feature.multiStorage.noStorages'),
  unavailableText: () => t('feature.multiStorage.unavailable'),
  layoutResetText: () => t('feature.multiStorage.layoutReset'),
});

export const startMultiStorage = storageControl.start;
export const stopMultiStorage = storageControl.stop;
export const toggleStoragesFromKey = storageControl.toggleFromKey;
export const setStoragesEnabled = storageControl.setEnabled;
export const resetLayoutFromKey = storageControl.resetFromKey;
