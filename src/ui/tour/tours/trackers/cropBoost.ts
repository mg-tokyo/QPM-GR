import type { TourDefinition } from '../../types';

export const cropBoostTour: TourDefinition = {
  windowId: 'crop-boost-tracker',
  label: 'Crop Boosts',
  category: 'trackers',
  version: 1,
  steps: [
    {
      id: 'stats',
      selector: '[data-tour="cropboost-stats"]',
      title: 'Boost progress at a glance',
      body: 'See how many crops are at max size, how many still need boosts, and your overall completion percentage.',
      placement: 'bottom',
    },
    {
      id: 'pets',
      selector: '[data-tour="cropboost-pets"]',
      title: 'Your active boost pets',
      body: 'Lists every pet with a crop size ability, their boost percentage, and how often it procs.',
      placement: 'bottom',
    },
    {
      id: 'estimate',
      selector: '[data-tour="cropboost-estimate"]',
      title: 'Time estimates',
      body: 'Rough prediction for when all remaining crops will reach max size based on your boost pet odds.',
      placement: 'top',
    },
    {
      id: 'filter',
      selector: '[data-tour="cropboost-filter"]',
      title: 'Focus on one species',
      body: 'Pick a crop from the dropdown to see only that species in the table below.',
      placement: 'top',
    },
    {
      id: 'toggle',
      selector: '[data-tour="cropboost-toggle"]',
      title: 'Simple vs detailed view',
      body: 'Switch to detailed view for per-crop percentile breakdowns and received-vs-needed boost counts.',
      placement: 'bottom',
    },
  ],
};
