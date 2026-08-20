import type { TowerId } from '../types';

// Save-thumbnail minimap markers (canvas-2D fills, not CSS). Picked to stay
// distinguishable at ~5 px on the dirt/boardwalk ground of saves/thumbnail.ts.
export const TOWER_MAP_COLORS: Readonly<Record<TowerId, string>> = {
  sproutSlinger:  '#7ed957',
  witchsCauldron: '#b06cff',
  frostWizard:    '#7fd7ff',
  marbleKnight:   '#e6e6e6',
  strawScarecrow: '#f2c94c',
  bananaGrove:    '#ffe45c',
  owlPerch:       '#c68a4a',
  gnomeAlchemist: '#ff7ab6',
  stormLantern:   '#a5b4ff',
  fairyForge:     '#ff8c42',
  pineconeGrove:  '#8b6f47',
};
