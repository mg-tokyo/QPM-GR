import type { TourDefinition } from '../../types';

export const shopRestockTour: TourDefinition = {
  windowId: 'shop-restock',
  label: 'Shop Restock',
  category: 'shops',
  version: 2,
  steps: [
    {
      id: 'filters',
      selector: '[data-tour="restock-filters"]',
      title: 'Filter by shop type',
      body: 'Use these buttons to show items from specific shops — seeds, eggs, tools, decor, and more.',
      placement: 'bottom',
    },
    {
      id: 'items',
      selector: '[data-tour="restock-items"]',
      title: 'Pin items for restock alerts',
      body: 'Click any row to pin it. Pinned items stay at the top and trigger a notification the moment they restock.',
      placement: 'top',
      advanceOn: 'click',
    },
  ],
};
