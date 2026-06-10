import type { DiscoveryDefinition } from '../types';

export const cropBoostDiscovery: DiscoveryDefinition = {
  windowId: 'crop-boost-tracker',
  maxVisible: 2,
  items: [
    { id: 'filter', selector: '[data-tour="cropboost-filter"]' },
    { id: 'toggle', selector: '[data-tour="cropboost-toggle"]' },
    { id: 'estimate', selector: '[data-tour="cropboost-estimate"]' },
  ],
};

export const xpTrackerDiscovery: DiscoveryDefinition = {
  windowId: 'trackers-v2-xp',
  maxVisible: 2,
  items: [
    { id: 'near-max', selector: '[data-tour="xp-near-max"]' },
    { id: 'time-chips', selector: '.qpm-xp-time-chips' },
  ],
};

export const turtleTimerDiscovery: DiscoveryDefinition = {
  windowId: 'trackers-v2-turtle',
  maxVisible: 2,
  items: [
    { id: 'focus', selector: '[data-tour="turtle-focus"]' },
    { id: 'tabs', selector: '[data-tour="turtle-tabs"]' },
    { id: 'contributions', selector: '[data-tour="turtle-contributions"]' },
  ],
};
