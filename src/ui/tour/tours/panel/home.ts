// src/ui/tour/tours/panel/home.ts

import type { TourDefinition } from '../../types';

export const panelHomeTour: TourDefinition = {
  windowId: 'panel-home',
  label: 'Home View',
  category: 'panel',
  version: 1,
  steps: [
    {
      id: 'tile-grid',
      selector: '[data-qpm-tile-grid]',
      title: 'Your quick-launch tiles',
      body: 'Each tile opens a QPM feature. This is your starting point for everything.',
      placement: 'bottom',
    },
    {
      id: 'add-tile',
      selector: '.qpm-add-tile',
      title: 'Customize your tiles',
      body: 'Click the + button to add more features to your home screen, or drag tiles to rearrange them.',
      placement: 'bottom',
    },
  ],
};
