import type { DiscoveryDefinition } from '../types';

export const petManagerDiscovery: DiscoveryDefinition = {
  windowId: 'qpm-pets-manager',
  maxVisible: 3,
  items: [
    { id: 'compare', selector: '[data-tour="mgr-compare"]' },
    { id: 'diet', selector: '[data-tour="mgr-diet"]' },
    { id: 'feed', selector: '[data-tour="mgr-feed"]' },
    { id: 'import', selector: '[data-tour="mgr-import"]' },
    { id: 'search', selector: '.qpm-mgr__search' },
  ],
};

export const petOptimizerDiscovery: DiscoveryDefinition = {
  windowId: 'qpm-pets-optimizer',
  maxVisible: 3,
  items: [
    { id: 'dislike-gold', selector: '[data-tour="optimizer-dislike-gold"]' },
    { id: 'sell-toggle', selector: '[data-tour="optimizer-sell-toggle"]' },
  ],
};
