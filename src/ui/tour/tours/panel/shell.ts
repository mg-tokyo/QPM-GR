// src/ui/tour/tours/panel/shell.ts

import type { TourDefinition } from '../../types';

export const panelShellTour: TourDefinition = {
  windowId: 'panel-shell',
  label: 'Panel Basics',
  category: 'panel',
  version: 1,
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
    {
      id: 'version',
      selector: '.qpm-version-bubble',
      title: 'Version & updates',
      body: 'This shows your QPM version. If an update is available, it turns orange — click to install.',
      placement: 'bottom',
    },
    {
      id: 'resize',
      selector: '.qpm-panel__resize-handle',
      title: 'Resize the panel',
      body: 'Drag this edge to make QPM wider or narrower.',
      placement: 'left',
    },
  ],
};
