import type { TourDefinition } from '../../types';

export const hubTour: TourDefinition = {
  windowId: 'qpm-hub',
  label: 'Hub',
  category: 'panel',
  version: 1,
  steps: [
    {
      id: 'nav-bar',
      selector: '[data-tour="hub-nav"]',
      title: 'Switch between groups',
      body: 'Each icon opens a different set of features: trackers, items, garden, config, and tools.',
      placement: 'bottom',
    },
    {
      id: 'group-header',
      selector: '[data-tour="hub-group-header"]',
      title: 'Features at a glance',
      body: 'Each group lists its features as cards. The count shows how many are visible.',
      placement: 'bottom',
    },
    {
      id: 'cards',
      selector: '[data-tour="hub-cards"]',
      title: 'Expand or launch features',
      body: 'Click a card to expand it inline. Some cards have an Open button to launch a separate window.',
      placement: 'top',
    },
    {
      id: 'visibility',
      selector: '[data-tour="hub-visibility"]',
      title: 'Customize what you see',
      body: 'Show or hide individual features per group. Your choices are saved.',
      placement: 'left',
    },
    {
      id: 'home-btn',
      selector: '[data-tour="hub-home-btn"]',
      title: 'Return to your tiles',
      body: 'The home icon takes you back to your quick-launch tile grid.',
      placement: 'bottom',
    },
  ],
};
