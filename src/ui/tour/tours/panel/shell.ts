import type { TourDefinition } from '../../types';

export const panelShellTour: TourDefinition = {
  windowId: 'panel-shell',
  label: 'Panel Basics',
  category: 'panel',
  version: 2,
  steps: [
    {
      id: 'titlebar',
      selector: '.qpm-panel__titlebar',
      title: 'Drag to move',
      body: 'Click and drag the title bar to reposition QPM anywhere on screen.',
      placement: 'bottom',
    },
    {
      id: 'collapse',
      selector: '[data-qpm-collapse-button]',
      title: 'Collapse the panel',
      body: 'Click this to shrink QPM down to just the title bar. Click again to expand.',
      placement: 'left',
      advanceOn: 'click',
    },
  ],
};
