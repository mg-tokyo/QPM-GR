// src/ui/tour/tours/welcome.ts

import type { TourDefinition } from '../types';

export const welcomeTour: TourDefinition = {
  windowId: 'welcome',
  label: 'Welcome to QPM',
  category: 'welcome',
  version: 1,
  steps: [
    {
      id: 'panel',
      resolve: (body) => body.closest('.qpm-panel') as HTMLElement | null ?? body,
      title: 'Welcome to QPM!',
      body: 'This panel is your command center for Magic Garden. It has trackers, tools, and shortcuts for everything.',
      placement: 'right',
    },
    {
      id: 'nav',
      resolve: (body) => {
        const content = body.querySelector('.qpm-content');
        return content?.firstElementChild as HTMLElement | null;
      },
      title: 'Switch between sections',
      body: 'Use these tabs to jump between trackers, garden tools, items, settings, and more.',
      placement: 'bottom',
    },
    {
      id: 'tiles',
      selector: '[data-qpm-tile-grid]',
      title: 'Your home screen',
      body: 'Each tile opens a feature. You can add, remove, and rearrange them to fit your playstyle.',
      placement: 'bottom',
    },
    {
      id: 'explore',
      selector: '[data-qpm-tile-grid]',
      title: 'Guides everywhere',
      body: 'Open any feature and you\'ll see a quick guide the first time. Look for the ? button to replay it anytime.',
      placement: 'bottom',
    },
  ],
};
