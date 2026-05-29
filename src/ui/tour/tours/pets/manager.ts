import type { TourDefinition } from '../../types';

export const petManagerTour: TourDefinition = {
  windowId: 'qpm-pets-manager',
  label: 'Pet Team Manager',
  category: 'pets',
  version: 3,
  steps: [
    {
      id: 'teams',
      selector: '[data-tour="mgr-teams"]',
      title: 'Your saved teams',
      body: 'Each team is a preset group of 3 pets. Click one to select it, drag to reorder.',
      placement: 'right',
    },
    {
      id: 'editor',
      selector: '[data-tour="mgr-editor"]',
      title: 'Edit and apply',
      body: 'Assign pets to each slot and hit Apply to swap your garden pets in one click.',
      placement: 'left',
    },
    {
      id: 'toolbar',
      selector: '[data-tour="mgr-toolbar"]',
      title: 'Build your collection',
      body: 'Create new teams, compare two side-by-side, or import setups from Aries Mod.',
      placement: 'bottom',
    },
    {
      id: 'slots',
      selector: '[data-tour="mgr-slots"]',
      title: 'Fine-tune each pet',
      body: 'Swap pets, check hunger, feed directly, and use the gear icon to control each pet\u2019s diet.',
      placement: 'top',
    },
    {
      id: 'keybind',
      selector: '[data-tour="mgr-keybind"]',
      title: 'Quick-swap from anywhere',
      body: 'Bind a key combo to apply this team without opening the window.',
      placement: 'top',
    },
  ],
};
