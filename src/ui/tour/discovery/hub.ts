import type { DiscoveryDefinition } from '../types';

export const hubDiscovery: DiscoveryDefinition = {
  windowId: 'qpm-hub',
  maxVisible: 2,
  items: [
    { id: 'visibility', selector: '[data-tour="hub-visibility"]' },
    { id: 'home-btn', selector: '[data-tour="hub-home-btn"]' },
  ],
};
