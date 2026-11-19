import {
  getLayoutPreview, isMultiStorageEnabled, listStorageChoices, onStorageChoicesChange, resetStorageLayout, setStoragesEnabled,
  toggleStorageChoice,
} from '../../features/multiStorage';
import type { CardIcon, ExpandableCardConfig } from '../hub/cards/types';
import { createPanelsCard, createPanelsSection, type PanelChoice, type PanelsCardSpec } from './panelsCard';
import type { SectionHandle } from './sectionLayout';

// eslint-disable-next-line qpm/no-emoji-in-ui -- CardIcon fallback while sprites load, as the keybind cards in configGroup.ts.
const ICON: CardIcon = { kind: 'sprite', value: '📦', spriteKey: 'sprite/ui/StorageButton', fallback: '📦' };

const storageChoices = (): PanelChoice[] => listStorageChoices().map(c => ({
  id: c.storageId, title: c.title, spriteKey: c.spriteKey, picked: c.picked, value: c.value,
}));

const SPEC: PanelsCardSpec = {
  key: 'multiStorage',
  attr: 'mstore',
  detachId: 'config-multi-storage',
  icon: ICON,
  text: {
    title: 'feature.multiStorage.card.title',
    caption: 'feature.multiStorage.card.caption',
    listTitle: 'feature.multiStorage.card.storagesTitle',
    listHelp: 'feature.multiStorage.card.storagesHelp',
    lastPicked: 'feature.multiStorage.card.lastPicked',
    empty: 'feature.multiStorage.card.noneOwned',
    summaryOne: 'feature.multiStorage.card.summaryOne',
    summaryMany: 'feature.multiStorage.card.summaryMany',
  },
  // The registry action ids from features/input/keybinds/multiStorage.ts.
  keyRows: [
    { actionId: 'multiStorage', label: 'feature.multiStorage.card.keyToggle' },
    { actionId: 'multiStorageReset', label: 'feature.multiStorage.card.resetLayout' },
  ],
  toggleActionId: 'multiStorage',
  isEnabled: isMultiStorageEnabled,
  setEnabled: setStoragesEnabled,
  choices: storageChoices,
  toggle: toggleStorageChoice,
  preview: getLayoutPreview,
  reset: () => { resetStorageLayout(); },
  onChange: onStorageChoicesChange,
  summaryCount: choices => choices.filter(c => c.picked).length,
};

export function createMultiStorageSection(): SectionHandle {
  return createPanelsSection(SPEC);
}

export function getMultiStorageCard(): ExpandableCardConfig {
  return createPanelsCard(SPEC);
}
