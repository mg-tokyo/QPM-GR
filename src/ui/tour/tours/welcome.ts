import type { TourDefinition } from '../types';

export const welcomeTour: TourDefinition = {
  windowId: 'welcome',
  label: 'Welcome to QPM',
  category: 'welcome',
  version: 2,
  steps: [
    {
      id: 'panel',
      resolve: (body) => body.closest('.qpm-panel') as HTMLElement | null ?? body,
      title: 'Welcome to QPM!',
      body: 'This panel is your command center for Magic Garden — trackers, tools, and shortcuts for everything.',
      placement: 'right',
    },
    {
      id: 'tiles',
      selector: '[data-qpm-tile-grid]',
      title: 'Your home screen',
      body: 'Each tile opens a feature. Click the + button to add more, or drag tiles to rearrange them.',
      placement: 'bottom',
    },
  ],
};
