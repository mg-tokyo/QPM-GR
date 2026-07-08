import type { TourDefinition } from '../types';

/** Check whether the panel content area is currently collapsed (display: none). */
function isPanelCollapsed(panel: HTMLElement): boolean {
  const content = panel.querySelector<HTMLElement>('.qpm-content');
  if (!content) return true;
  return getComputedStyle(content).display === 'none';
}

/** waitFor predicate: content visible AND tile grid rendered. */
function contentAndTilesReady(): HTMLElement | null {
  const panel = document.querySelector<HTMLElement>('.qpm-panel');
  if (!panel) return null;
  const content = panel.querySelector<HTMLElement>('.qpm-content');
  if (!content || getComputedStyle(content).display === 'none') return null;
  return panel.querySelector<HTMLElement>('[data-qpm-tile-grid]');
}

export const welcomeTour: TourDefinition = {
  windowId: 'welcome',
  label: 'Welcome to QPM',
  category: 'welcome',
  version: 4,
  steps: [
    {
      id: 'expand',
      resolve: (body) => {
        const panel = body.closest('.qpm-panel') as HTMLElement | null ?? body;
        return isPanelCollapsed(panel)
          ? panel.querySelector<HTMLElement>('[data-qpm-collapse-button]')
          : null; // expanded \u2014 skip this step
      },
      title: 'Expand the panel',
      body: 'QPM is collapsed right now. Click this button to expand it.',
      placement: 'right',
      advanceOn: 'click',
    },
    {
      id: 'panel',
      resolve: (body) => body.closest('.qpm-panel') as HTMLElement | null ?? body,
      waitFor: contentAndTilesReady,
      title: 'Welcome to QPM!',
      body: 'The QPM panel is your central screen for every feature \u2014 trackers, tools, and shortcuts all start here.',
      placement: 'right',
    },
  ],
};
