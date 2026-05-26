import type { TourDefinition } from '../../types';

export const petHubTour: TourDefinition = {
  windowId: 'qpm-pets-window',
  label: 'Pet Hub',
  category: 'pets',
  version: 2,
  steps: [
    {
      id: 'tabs',
      selector: '[data-tour="pet-hub-tabs"]',
      title: 'Pet Hub tabs',
      body: 'Switch between the Team Manager (build and apply pet teams) and the Pet Optimizer (find your best pets).',
      placement: 'bottom',
    },
    {
      id: 'body',
      selector: '[data-tour="pet-hub-body"]',
      title: 'Your active team',
      body: 'This shows your current pet slots. Create teams, assign pets, and apply them with one click.',
      placement: 'top',
    },
  ],
};
