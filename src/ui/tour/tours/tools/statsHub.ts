import type { TourDefinition } from '../../types';

export const statsHubTour: TourDefinition = {
  windowId: 'stats-hub',
  label: 'Stats Hub',
  category: 'tools',
  version: 1,
  steps: [
    {
      id: 'tab-bar',
      selector: '[data-tour="stats-tab-bar"]',
      title: 'Switch between views',
      body: 'Garden analyzes your crops and mutations. Economy tracks coins, spending, and net worth.',
      placement: 'bottom',
    },
    {
      id: 'mutation-filters',
      selector: '[data-tour="stats-mutation-filters"]',
      title: 'Track mutation progress',
      body: "Toggle mutations to see which plants still need them and how much value they'd add.",
      placement: 'bottom',
    },
    {
      id: 'plant-filter',
      selector: '[data-tour="stats-plant-filter"]',
      title: 'Filter by species',
      body: 'Narrow your view to only the crops you care about.',
      placement: 'bottom',
    },
    {
      id: 'tile-grid',
      selector: '[data-tour="stats-tile-grid"]',
      title: 'Your plants at a glance',
      body: 'Each card shows mutations, value, and ready status. Click a card to highlight that plant on your garden.',
      placement: 'top',
    },
    {
      id: 'max-size',
      selector: '[data-tour="stats-max-size"]',
      title: 'Track undersized crops',
      body: "Toggle this to separate plants that haven't reached full size yet.",
      placement: 'top',
    },
  ],
};
