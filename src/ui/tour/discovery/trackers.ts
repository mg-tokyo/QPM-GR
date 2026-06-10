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
