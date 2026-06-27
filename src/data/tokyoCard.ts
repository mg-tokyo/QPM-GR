// src/data/tokyoCard.ts
//
// Author's signature "TOKYO" card. Rendered via the native InventoryCardView
// when the user clicks the thumbnail in the About window.
//
// Every petSpecies / mutation / ability MUST be a real catalog key. Unknown
// IDs crash the renderer every draw tick.

import type { PhantomInventoryItem } from '../integrations/nativeCardView';

// VP9 WebM (~250 KB, animated, alpha-preserved, cropped to content bounds).
// PIXI v8 auto-detects HTMLVideoElement → VideoSource for loop playback.
export const TOKYO_CARD_VIDEO_URL =
  'https://raw.githubusercontent.com/mg-tokyo/QPM-GR/master/docs/product/tokyo-card.webm';

// Static PNG (~50 KB, single frame, cropped to content bounds).
// Used by the About-window thumbnail (HTML <img>) and as the in-game portrait fallback when video autoplay is blocked.
export const TOKYO_CARD_PREVIEW_URL =
  'https://raw.githubusercontent.com/mg-tokyo/QPM-GR/master/docs/product/tokyo-card.png';

export const TOKYO_CARD: PhantomInventoryItem = {
  id: 'qpm-phantom-tokyo-card',
  itemType: 'Pet',
  petSpecies: 'Capybara',
  name: 'TOKYO',
  xp: 999999,
  hunger: 350,
  mutations: ['Rainbow'],
  abilities: [
    'RainbowGranter',
    'AmberlitGranter',
    'DawnlitGranter',
    'GoldGranter',
  ],
  abilityCooldowns: {},
  sourceEggId: 'CommonEgg',
  targetScale: 2.5,
};
