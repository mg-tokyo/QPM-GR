import type { TourDefinition } from '../../types';

export const petManagerTour: TourDefinition = {
  windowId: 'qpm-pets-manager',
  label: 'Pet Team Manager',
  category: 'pets',
  version: 2,
  steps: [
    {
      id: 'teams',
      selector: '[data-tour="mgr-teams"]',
      title: 'Your saved teams',
      body: 'Each team is a preset group of pets. Click one to select it, then edit or apply it.',
      placement: 'right',
    },
    {
      id: 'editor',
      selector: '[data-tour="mgr-editor"]',
      title: 'Edit and apply teams',
      body: 'Assign pets to slots, set a keybind for quick-swap, and apply the team to your garden with one click.',
      placement: 'left',
    },
  ],
};
