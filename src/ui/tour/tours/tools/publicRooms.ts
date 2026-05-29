import type { TourDefinition } from '../../types';

export const publicRoomsTour: TourDefinition = {
  windowId: 'public-rooms',
  label: 'Public Rooms',
  category: 'tools',
  version: 1,
  steps: [
    {
      id: 'stats',
      selector: '[data-tour="pr-stats"]',
      title: 'Live room counts',
      body: 'See how many rooms are online, how many match your filters, and when data was last refreshed.',
      placement: 'bottom',
    },
    {
      id: 'controls',
      selector: '[data-tour="pr-controls"]',
      title: 'Search and filter rooms',
      body: 'Search by name, filter by player count, or change the sort order to find the room you want.',
      placement: 'bottom',
    },
    {
      id: 'rooms-grid',
      selector: '[data-tour="pr-rooms-grid"]',
      title: 'Browse available rooms',
      body: 'Each card shows the room code, player count, and who is inside. Hit Join to jump in.',
      placement: 'top',
    },
    {
      id: 'refresh',
      selector: '#pr-refresh-btn',
      title: 'Refresh room data',
      body: 'Rooms update automatically, but you can force a refresh anytime.',
      placement: 'bottom',
    },
    {
      id: 'avatar-stack',
      resolve: (body) => body.querySelector('[data-tour="pr-avatar-stack"]'),
      title: 'Tap an avatar to inspect',
      body: "Click any player's avatar to open the inspector and browse their garden, inventory, and activity.",
      placement: 'top',
    },
  ],
};
