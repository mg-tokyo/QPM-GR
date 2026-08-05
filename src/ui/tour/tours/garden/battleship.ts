import type { TourDefinition } from '../../types';

export const battleshipTour: TourDefinition = {
  windowId: 'battleship',
  label: 'Garden Battleship',
  category: 'garden',
  version: 2,
  steps: [
    {
      id: 'modes',
      selector: '[data-tour="battleship-modes"]',
      title: 'Turn your garden into a battlefield',
      body: 'Play vs the AI, or challenge a player in your room. Pick which of your two plots hosts your hidden fleet — the other side becomes the enemy grid.',
      placement: 'bottom',
    },
    {
      id: 'picker',
      selector: '[data-tour="battleship-picker"]',
      title: 'Challenge another player',
      body: 'Anyone else in this room shows up here. Send a challenge; if they have QPM their panel pops up automatically.',
      placement: 'bottom',
    },
    {
      id: 'howto',
      selector: '[data-tour="battleship-modes"]',
      title: 'How a match plays',
      body: 'Walk onto a tile on your plot and press SPACE to place the highlighted crop row; R rotates. Then take turns firing — hits keep your turn, misses pass it back. First to harvest all 5 enemy rows wins.',
      placement: 'bottom',
    },
    {
      id: 'chat',
      selector: '[data-tour="battleship-picker"]',
      title: 'Spectators can follow along',
      body: 'Every shot and verdict is posted in the room chat with an anchor prefix — friends in the room can watch the play-by-play even without QPM.',
      placement: 'bottom',
    },
    {
      id: 'safety',
      selector: '[data-tour="battleship-safety"]',
      title: 'Your real garden is safe',
      body: 'While the match runs, real garden actions (harvest, water, sell) are blocked and your plot is hidden. When the match ends, everything comes back exactly as it was.',
      placement: 'top',
    },
  ],
};
