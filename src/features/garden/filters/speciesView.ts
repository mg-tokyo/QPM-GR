import { log } from '../../../utils/logger';
import { getAllPlantSpecies as getCatalogPlantSpecies, getEggCatalog } from '../../../catalogs/gameCatalogs';

// Species name to PIXI View label mapping (used ONLY by getAllPlantSpecies() as
// a UI fallback when catalogs aren't loaded yet, and by diagnostics).
// NOT used for filter matching — filters use tileData.species directly.
export const SPECIES_TO_VIEW: Record<string, string> = {
  'Carrot': 'Carrot Plant View',
  'Cabbage': 'Cabbage Plant View',
  'Strawberry': 'Strawberry Plant View',
  'Aloe': 'Aloe Plant View',
  'Beet': 'Beet Plant View',
  'Rose': 'Rose Plant View',
  'FavaBean': 'Fava Bean Plant View',
  'Delphinium': 'Delphinium Plant View',
  'Blueberry': 'Blueberry Plant View',
  'Apple': 'Apple Tree View',
  'OrangeTulip': 'Tulip Plant View',
  'Tomato': 'Tomato Plant View',
  'Daffodil': 'Daffodil Plant View',
  'Corn': 'Corn Plant View',
  'Watermelon': 'Watermelon Plant View',
  'Pumpkin': 'Pumpkin Plant View',
  'Echeveria': 'Echeveria Plant View',
  'Pear': 'Pear Tree View',
  'Gentian': 'Gentian Plant View',
  'Coconut': 'Coconut Tree View',
  'PineTree': 'Pine Tree View',
  'Banana': 'Banana Plant View',
  'Lily': 'Lily Plant View',
  'Camellia': 'Camellia Hedge View',
  'Squash': 'Squash Plant View',
  'Peach': 'Peach Tree View',
  'BurrosTail': "Burro's Tail Plant View",
  'Mushroom': 'Mushroom Plant View',
  'Cactus': 'Cactus Plant View',
  'Bamboo': 'Bamboo Plant View',
  'Poinsettia': 'Poinsettia Bush View',
  'VioletCort': 'Violet Cort Plant View',
  'Chrysanthemum': 'Chrysanthemum Bush View',
  'Date': 'Date Palm View',
  'Grape': 'Grape Plant View',
  'Pepper': 'Pepper Plant View',
  'Lemon': 'Lemon Tree View',
  'PassionFruit': 'Passion Fruit Plant View',
  'DragonFruit': 'Dragon Fruit Plant View',
  'Cacao': 'Cacao Plant View',
  'Lychee': 'Lychee Plant View',
  'Sunflower': 'Sunflower Plant View',
  'Starweaver': 'Starweaver Plant View',
  'DawnCelestial': 'Dawnbinder View',
  'MoonCelestial': 'Moonbinder View',
  'Saffron': 'Saffron Plant View',
  'Eggplant': 'Eggplant Plant View',
  'Leek': 'Leek Plant View',
  // Dawn content (plant.name from floraSpeciesDex)
  'Lavender': 'Lavender Plant View',
  'Ube': 'Ube Plant View',
  'Dawnbreaker': 'Dawnbreaker Plant View',
  // Special variants — plant.name has no 'Plant' suffix or uses an alternate word,
  // so PIXI label is plant.name + ' View', NOT plant.name + ' Plant View'.
  'Clover': 'Clover Patch View',
  'FourLeafClover': 'Four-Leaf Clover View',
  'Daisy': 'Daisy Patch View',
  'PurpleDaisy': 'Purple Daisy View',
  'Snowdrop': 'Snowdrop Patch View',
  'SnowdropDouble': 'Double Snowdrop View',
};

/**
 * Get list of all plant species (for UI).
 * Merges the live plant catalog (auto-updated with the game) with the static
 * SPECIES_TO_VIEW map so newly added crops appear automatically.
 */
export function getAllPlantSpecies(): string[] {
  const staticKeys = Object.keys(SPECIES_TO_VIEW);
  try {
    const catalogKeys = getCatalogPlantSpecies();
    if (catalogKeys.length === 0) return staticKeys;
    const merged = new Set([...staticKeys, ...catalogKeys]);
    return Array.from(merged).sort();
  } catch {
    return staticKeys;
  }
}

/**
 * Get list of all egg types from catalog (auto-updates with the game).
 */
export function getAllEggTypes(): string[] {
  try {
    const catalog = getEggCatalog();
    return catalog ? Object.keys(catalog) : [];
  } catch (error) {
    log('⚠️ Failed to load egg types from catalog', error);
    return [];
  }
}
