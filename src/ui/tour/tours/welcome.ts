import type { TourDefinition } from '../types';

/** Mac-aware hotkey label — computed once at module scope. */
const hotkeyLabel = /Mac|iPhone|iPad/.test(navigator.platform)
  ? 'Option+Q (\u2325Q)'
  : 'Alt+Q';

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
  version: 3,
  steps: [
    {
      id: 'expand',
      resolve: (body) => {
        const panel = body.closest('.qpm-panel') as HTMLElement | null ?? body;
        return isPanelCollapsed(panel)
          ? panel.querySelector<HTMLElement>('[data-qpm-collapse-button]')
          : null; // expanded — skip this step
      },
      title: 'Expand the panel',
      body: `QPM is collapsed right now. Click this button (or press ${hotkeyLabel}) to expand it.`,
      placement: 'right',
      advanceOn: 'click',
    },
    {
      id: 'panel',
      resolve: (body) => body.closest('.qpm-panel') as HTMLElement | null ?? body,
      waitFor: contentAndTilesReady,
      title: 'Welcome to QPM!',
      body: 'This panel is your command center for Magic Garden \u2014 trackers, tools, and shortcuts for everything.',
      placement: 'right',
    },
    {
      id: 'tiles',
      selector: '[data-qpm-tile-grid]',
      waitFor: contentAndTilesReady,
      title: 'Your home screen',
      body: 'Each tile opens a feature. Click the + button to add more, or drag tiles to rearrange them.',
      placement: 'bottom',
    },
  ],
};
