import type { TourDefinition } from '../../types';

export const abilityTrackerTour: TourDefinition = {
  windowId: 'trackers-v2-ability',
  label: 'Ability Tracker',
  category: 'trackers',
  version: 2,
  steps: [
    {
      id: 'summary',
      selector: '[data-tour="ability-summary"]',
      title: 'At-a-glance stats',
      body: 'See how many pets and abilities are active, plus your total coins per hour across all pets.',
      placement: 'bottom',
    },
    {
      id: 'cards',
      selector: '[data-tour="ability-cards"]',
      title: 'Per-pet breakdown',
      body: 'Each card shows one pet\'s abilities with procs/hr, coins/hr, and countdown to next activation.',
      placement: 'top',
    },
  ],
};
