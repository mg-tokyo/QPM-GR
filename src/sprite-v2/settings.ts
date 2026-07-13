import type { SpriteConfig, MutationMeta, MutationName } from './types';

export const DEFAULT_CFG: SpriteConfig = {
  origin: 'https://magicgarden.gg',
  jobOn: true,
  jobBudgetMs: 30,  // Reduced per-frame budget to throttle warmup and avoid spikes
  jobBurstMs: 80,   // Shorter bursts to keep FPS stable on low-end devices
  jobBurstWindowMs: 5000,
  jobCapPerTick: 2,  // Limit to a handful of sprite builds per tick (1–2 per frame typical)
  cacheOn: true,
  cacheMaxEntries: 2000,  // Increased from 1200 to reduce re-rendering
  cacheMaxCost: 8000,  // Increased from 5000 to cache more sprites
  keepCacheOnClose: true,
  srcCanvasMax: 450,
  debugLog: false,  // Disabled debug logging for production performance
  debugLimitDefault: 25,
};

export const MUT_META: Record<MutationName, MutationMeta> = {
  Gold: { overlayTall: null, tallIconOverride: null },
  Rainbow: { overlayTall: null, tallIconOverride: null, angle: 130, angleTall: 0 },
  Wet: { overlayTall: 'sprite/mutation-overlay/WetTallPlant', tallIconOverride: 'sprite/mutation/Puddle' },
  Chilled: { overlayTall: 'sprite/mutation-overlay/ChilledTallPlant', tallIconOverride: null },
  Frozen: { overlayTall: 'sprite/mutation-overlay/FrozenTallPlant', tallIconOverride: null },
  Dawnlit: { overlayTall: null, tallIconOverride: null },
  Ambershine: { overlayTall: null, tallIconOverride: 'sprite/mutation/Amberlit' },
  Dawncharged: { overlayTall: null, tallIconOverride: null },
  Ambercharged: { overlayTall: null, tallIconOverride: null },
  Thunderstruck: { overlayTall: null, tallIconOverride: null },
};

export const MUT_NAMES: MutationName[] = Object.keys(MUT_META) as MutationName[];

export const MUT_G1 = ['', 'Gold', 'Rainbow'].filter(Boolean) as MutationName[];
export const MUT_G2 = ['', 'Wet', 'Chilled', 'Frozen'].filter(Boolean) as MutationName[];
export const MUT_G3 = ['', 'Dawnlit', 'Ambershine', 'Dawncharged', 'Ambercharged'].filter(Boolean) as MutationName[];
export const MUT_G4 = ['', 'Thunderstruck'].filter(Boolean) as MutationName[];

// Mutation rendering constants
export const TILE_SIZE_WORLD = 256;
export const BASE_ICON_SCALE = 0.5;
export const TALL_PLANT_MUTATION_ICON_SCALE_BOOST = 2;

export const FLOATING_MUTATION_ICONS = new Set<MutationName>([
  'Dawnlit',
  'Ambershine',
  'Dawncharged',
  'Ambercharged',
]);

export const MUT_ICON_Y_EXCEPT: Record<string, number> = {
  Banana: 0.6,
  Carrot: 0.6,
  Sunflower: 0.5,
  Starweaver: 0.5,
  FavaBean: 0.25,
  BurrosTail: 0.2,
};

export const MUT_ICON_X_EXCEPT: Record<string, number> = {
  Pepper: 0.5,
  Banana: 0.6,
};

export const MUTATION_ORDER: MutationName[] = [
  'Gold',
  'Rainbow',
  'Wet',
  'Chilled',
  'Frozen',
  'Ambershine',
  'Dawnlit',
  'Dawncharged',
  'Ambercharged',
  'Thunderstruck',
];

export const MUTATION_INDEX = new Map(MUTATION_ORDER.map((m, idx) => [m, idx]));
