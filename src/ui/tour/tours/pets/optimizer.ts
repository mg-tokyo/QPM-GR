import type { TourDefinition } from '../../types';

export const petOptimizerTour: TourDefinition = {
  windowId: 'qpm-pets-optimizer',
  label: 'Pet Optimizer',
  category: 'pets',
  version: 3,
  steps: [
    {
      id: 'summary',
      selector: '[data-tour="optimizer-summary"]',
      title: 'Analysis at a glance',
      body: 'See how many pets to keep, sell, or review. Badges show totals and where your pets are.',
      placement: 'bottom',
    },
    {
      id: 'mode',
      selector: '[data-tour="optimizer-mode"]',
      title: 'Choose your strategy',
      body: 'Specialist ranks by single best ability. Slot Efficiency considers how all 3 pets combine.',
      placement: 'bottom',
    },
    {
      id: 'group-filter',
      selector: '[data-tour="optimizer-group-filter"]',
      title: 'Filter by ability',
      body: 'Focus on a specific family like Harvest Speed or Growth Rate to see only relevant pets.',
      placement: 'bottom',
    },
    {
      id: 'results',
      selector: '[data-tour="optimizer-results"]',
      title: 'Your pets, ranked',
      body: 'Color-coded cards: green = keep, red = safe to sell, yellow = needs your judgement.',
      placement: 'top',
    },
    {
      id: 'nav',
      selector: '[data-tour="optimizer-nav"]',
      title: 'Jump between families',
      body: 'Use the sticky nav bar to scroll directly to any ability group.',
      placement: 'bottom',
    },
  ],
};
