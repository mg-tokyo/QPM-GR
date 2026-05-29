import type { DiscoveryDefinition } from '../types';

export const statsHubDiscovery: DiscoveryDefinition = {
  windowId: 'stats-hub',
  maxVisible: 2,
  items: [
    { id: 'plant-filter', selector: '[data-tour="stats-plant-filter"]' },
    { id: 'max-size', selector: '[data-tour="stats-max-size"]' },
    { id: 'balance-chips', selector: '[data-tour="stats-balance-chips"]' },
  ],
};

export const publicRoomsDiscovery: DiscoveryDefinition = {
  windowId: 'public-rooms',
  maxVisible: 2,
  items: [
    { id: 'player-filter', selector: '#pr-player-filter' },
    { id: 'sort-by', selector: '#pr-sort-by' },
    { id: 'avatar-stack', selector: '[data-tour="pr-avatar-stack"]' },
  ],
};
