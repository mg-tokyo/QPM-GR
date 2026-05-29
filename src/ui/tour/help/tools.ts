import type { HelpPanelDefinition } from '../types';

export const publicRoomsHelp: HelpPanelDefinition = {
  windowId: 'public-rooms',
  groups: [
    {
      id: 'rooms',
      label: 'Rooms',
      cards: [
        {
          id: 'search',
          icon: { kind: 'emoji', value: '\uD83D\uDD0E' },
          title: 'Search rooms',
          body: 'Type a room code or player name to filter the list.',
          showMeSelector: '#pr-search-input',
        },
        {
          id: 'player-filter',
          icon: { kind: 'emoji', value: '\uD83D\uDC65' },
          title: 'Player count filter',
          body: 'Show only rooms with few, some, or many players.',
          showMeSelector: '#pr-player-filter',
        },
        {
          id: 'sort',
          icon: { kind: 'emoji', value: '\uD83D\uDCCA' },
          title: 'Sort order',
          body: 'Sort rooms by code, most players, or least players.',
          showMeSelector: '#pr-sort-by',
        },
        {
          id: 'join',
          icon: { kind: 'emoji', value: '\uD83C\uDFAE' },
          title: 'Joining a room',
          body: 'Hit the Join button on any card to jump into that room.',
        },
      ],
    },
    {
      id: 'inspector',
      label: 'Inspector',
      cards: [
        {
          id: 'avatar-click',
          icon: { kind: 'emoji', value: '\uD83D\uDC64' },
          title: 'Inspect a player',
          body: "Click any player's avatar on a room card to open their profile inspector.",
        },
        {
          id: 'garden-view',
          icon: { kind: 'emoji', value: '\uD83C\uDF31' },
          title: 'Garden view',
          body: 'See the player\'s garden layout with crop sprites, mutations, and growth timers.',
        },
        {
          id: 'inventory',
          icon: { kind: 'emoji', value: '\uD83C\uDF92' },
          title: 'Inventory & pets',
          body: 'Browse their items, pets with abilities, and hutch contents.',
        },
        {
          id: 'compare',
          icon: { kind: 'emoji', value: '\u2696\uFE0F' },
          title: 'Compare tab',
          body: 'Switch to Compare in the inspector to see how your stats match up.',
        },
      ],
    },
  ],
};

export const statsHubHelp: HelpPanelDefinition = {
  windowId: 'stats-hub',
  groups: [
    {
      id: 'garden',
      label: 'Garden',
      cards: [
        {
          id: 'mutation-tracking',
          icon: { kind: 'emoji', value: '\uD83E\uDDEC' },
          title: 'Mutation tracking',
          body: 'Select mutations to see remaining vs complete plants and projected value gains.',
          showMeSelector: '[data-tour="stats-mutation-filters"]',
        },
        {
          id: 'plant-filter',
          icon: { kind: 'emoji', value: '\uD83D\uDD0D' },
          title: 'Plant filter',
          body: 'Dropdown to focus on specific species in your garden.',
          showMeSelector: '[data-tour="stats-plant-filter"]',
        },
        {
          id: 'tile-interaction',
          icon: { kind: 'emoji', value: '\uD83D\uDC49' },
          title: 'Tile interaction',
          body: 'Click cards to highlight plants, tap multi-harvest for slot details.',
          showMeSelector: '[data-tour="stats-tile-grid"]',
        },
        {
          id: 'max-size',
          icon: { kind: 'emoji', value: '\uD83D\uDCCF' },
          title: 'Max size tracking',
          body: 'Filter out plants still growing to full size.',
          showMeSelector: '[data-tour="stats-max-size"]',
        },
      ],
    },
    {
      id: 'economy',
      label: 'Economy',
      cards: [
        {
          id: 'balance-chips',
          icon: { kind: 'emoji', value: '\uD83D\uDCB0' },
          title: 'Balance chips',
          body: 'Live coin, credit, and dust balances with earn rate.',
          showMeSelector: '[data-tour="stats-balance-chips"]',
        },
        {
          id: 'pop-out',
          icon: { kind: 'emoji', value: '\u2197' },
          title: 'Pop-out cards',
          body: 'Use the arrow button to pin a value tracker as a floating overlay.',
        },
        {
          id: 'player-compare',
          icon: { kind: 'emoji', value: '\uD83D\uDC65' },
          title: 'Player comparison',
          body: 'Compare your economy with other players in the room.',
        },
      ],
    },
  ],
};
