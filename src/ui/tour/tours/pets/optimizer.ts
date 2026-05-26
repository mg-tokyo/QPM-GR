import type { TourDefinition } from '../../types';

export const petOptimizerTour: TourDefinition = {
  windowId: 'qpm-pets-optimizer',
  label: 'Pet Optimizer',
  category: 'pets',
  version: 2,
  steps: [
    {
      id: 'summary',
      selector: '[data-tour="optimizer-summary"]',
      title: 'Analysis at a glance',
      body: 'See how many pets to keep, sell, or review. Badges show the active analysis mode and where your pets are.',
      placement: 'bottom',
    },
    {
      id: 'filters',
      selector: '[data-tour="optimizer-group-filter"]',
      title: 'Filter and switch modes',
      body: 'Focus on a specific ability family, or switch between Specialist and Slot Efficiency analysis.',
      placement: 'bottom',
    },
  ],
};
