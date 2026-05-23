import { storage } from '../../utils/storage';

// ── Species name normalization ──────────────────────────────────────────────

const SPECIES_NAME_MAP: Record<string, string> = {
  orangetulip: 'Tulip',
  tulip: 'Tulip',
  dawncelestial: 'Dawnbinder',
  dawnbinder: 'Dawnbinder',
  mooncelestial: 'Moonbinder',
  moonbinder: 'Moonbinder',
  starweaver: 'Starweaver',
  mythicalegg: 'Mythical',
  mythical: 'Mythical',
};

export function normalizeSpeciesName(species: string): string {
  const key = species.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SPECIES_NAME_MAP[key] || species;
}

// ── Display name overrides ──────────────────────────────────────────────────

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  Cacao: 'Cacao Bean',
  DawnCelestial: 'Dawnbinder',
  MoonCelestial: 'Moonbinder',
  OrangeTulip: 'Orange Tulip',
  BurrosTail: "Burro's Tail",
  FavaBean: 'Fava Bean',
  FourLeafClover: 'Four-Leaf Clover',
  PurpleDaisy: 'Purple Daisy',
  PassionFruit: 'Passion Fruit',
  DragonFruit: 'Dragon Fruit',
  PineTree: 'Pine Tree',
  VioletCort: 'Violet Cort',
  FireHorse: 'Fire Horse',
  SnowFox: 'Snow Fox',
  WhiteCaribou: 'White Caribou',
};

export function formatSpeciesDisplayName(key: string): string {
  if (DISPLAY_NAME_OVERRIDES[key]) return DISPLAY_NAME_OVERRIDES[key];
  return key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

// ── Mutation prefixes ───────────────────────────────────────────────────────

export const CROP_MUTATION_PREFIXES = [
  'Gold', 'Rainbow', 'Frozen', 'Wet', 'Amber', 'Chilled',
  'Dawnlit', 'Amberlit', 'Dawnbound', 'Amberbound',
];

// ── Layout orders (rarity-tier sorting) ─────────────────────────────────────

export const SHOP_LAYOUT_ORDER = [
  'Carrot', 'Cabbage', 'Strawberry', 'Aloe',
  'Clover', 'Beet', 'Rose', 'Fava Bean', 'Delphinium', 'Blueberry', 'Apple', 'Orange Tulip', 'Tomato', 'Daisy',
  'Daffodil', 'Corn', 'Watermelon', 'Pumpkin', 'Echeveria', 'Pear', 'Gentian', 'Lavender',
  'Coconut', 'Pine Tree', 'Banana', 'Lily', 'Camellia', 'Squash', 'Peach', "Burro's Tail", 'Saffron', 'Four Leaf Clover', 'Purple Daisy',
  'Mushroom', 'Cactus', 'Bamboo', 'Poinsettia', 'Violet Cort', 'Chrysanthemum', 'Date', 'Grape', 'Eggplant',
  'Pepper', 'Lemon', 'Passion Fruit', 'Dragon Fruit', 'Cacao', 'Lychee', 'Ube', 'Sunflower',
  'Dawnbreaker', 'Starweaver', 'Dawn Celestial', 'Moon Celestial',
];

export const SHOP_LAYOUT_INDEX = new Map(
  SHOP_LAYOUT_ORDER.map((name, idx) => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), idx]),
);

export const PET_LAYOUT_ORDER = [
  'Worm', 'Snail', 'Bee',
  'Chicken', 'Bunny', 'Dragonfly',
  'Pig', 'Cow', 'Turkey',
  'Squirrel', 'Turtle', 'Goat', 'Snow Fox', 'Stoat', 'White Caribou', 'Pony', 'Sheep', 'Horse',
  'Hedgehog', 'Fire Horse', 'Butterfly', 'Peacock', 'Capybara', 'Ostrich',
];

export const PET_LAYOUT_INDEX = new Map(
  PET_LAYOUT_ORDER.map((name, idx) => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), idx]),
);

export const TALL_SPECIES = new Set(['cactus', 'bamboo']);

// ── Feature palette ─────────────────────────────────────────────────────────

export const COLOR_PRODUCE = '#8BC34A';
export const COLOR_PETS = '#42A5F5';
export const COLOR_TIPS = '#9C27B0';
export const COLOR_MISSING = '#FF9800';

export const GRADIENT_PRODUCE = 'linear-gradient(90deg, #8BC34A, #66BB6A)';
export const GRADIENT_PETS = 'linear-gradient(90deg, #42A5F5, #64B5F6)';
export const GRADIENT_RAINBOW = 'linear-gradient(90deg, #FF1744, #FF9100, #FFEA00, #00E676, #2979FF, #D500F9, #FF1744)';

// ── Notes storage ───────────────────────────────────────────────────────────

export function getSpeciesNotes(species: string): string {
  const notes = storage.get<Record<string, string>>('journal:notes', {});
  return notes[species] || '';
}

export function saveSpeciesNotes(species: string, notes: string): void {
  const allNotes = storage.get<Record<string, string>>('journal:notes', {});
  allNotes[species] = notes;
  storage.set('journal:notes', allNotes);
}
