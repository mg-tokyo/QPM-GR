// src/ui/tour/tours/shops/restock.ts

import type { TourDefinition } from '../../types';

export const shopRestockTour: TourDefinition = {
  windowId: 'shop-restock',
  label: 'Shop Restock',
  category: 'shops',
  version: 1,
  steps: [
    {
      id: 'filters',
      selector: '[data-tour="restock-filters"]',
      title: 'Filter by shop type',
      body: 'Use these buttons to show items from specific shops — seeds, eggs, tools, decor, and more.',
      placement: 'bottom',
    },
    {
      id: 'search',
      selector: '[data-tour="restock-search"]',
      title: 'Search for items',
      body: 'Type a name to quickly find a specific item across all shops.',
      placement: 'bottom',
    },
    {
      id: 'items',
      selector: '[data-tour="restock-items"]',
      title: 'Pin items you care about',
      body: 'Click any row to pin it to the top. Pinned items stay visible so you never miss a restock.',
      placement: 'top',
      advanceOn: 'click',
    },
    {
      id: 'pinned',
      selector: '[data-tour="restock-pinned"]',
      title: 'Your pinned items',
      body: 'Pinned items appear here with alerts when they restock. You can set up sound notifications too.',
      placement: 'bottom',
    },
  ],
};
