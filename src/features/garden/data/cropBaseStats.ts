// Crop base statistics from Magic Garden Wiki
// Source: https://magicgarden.wiki/Crops
//
// getCropStats() overlays runtime catalog data when available, keeping
// hardcoded values as fallback for fields not in the catalog.

import { areCatalogsReady, getFloraBlueprint, getSeedPrice } from '../../../catalogs/gameCatalogs';

export interface CropStats {
  name: string;
  seedPrice: number;
  baseSellPrice: number;
  cropGrowTime: number; // in seconds
  regrow: string; // "No" or number of slots
  matureTime?: number; // in seconds, for multi-harvest
  baseWeight: number; // in kg
  maxWeight: number; // in kg
  exclusive?: string; // Exclusive unlock condition
  rarity?: number; // Credit price
}

// Convert time strings to seconds
const parseTime = (timeStr: string): number => {
  if (timeStr.includes('h')) {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0] || '0');
    const mins = parts[1] ? parseInt(parts[1].replace('min', '')) : 0;
    return hours * 3600 + mins * 60;
  }
  if (timeStr.includes('min')) {
    const parts = timeStr.split(':');
    const mins = parseInt(parts[0] || '0');
    const secs = parts[1] ? parseInt(parts[1]) : 0;
    return mins * 60 + secs;
  }
  return parseInt(timeStr.replace('s', ''));
};

export const CROP_BASE_STATS: Record<string, CropStats> = {
  carrot: {
    name: 'Carrot',
    seedPrice: 10,
    baseSellPrice: 20,
    cropGrowTime: 4,
    regrow: 'No',
    baseWeight: 0.1,
    maxWeight: 0.3,
  },
  strawberry: {
    name: 'Strawberry',
    seedPrice: 50,
    baseSellPrice: 14,
    cropGrowTime: 10,
    regrow: '5 Slots',
    matureTime: 70, // 1:10min
    baseWeight: 0.05,
    maxWeight: 0.1,
  },
  aloe: {
    name: 'Aloe',
    seedPrice: 135,
    baseSellPrice: 310,
    cropGrowTime: 45,
    regrow: 'No',
    baseWeight: 1.5,
    maxWeight: 3.75,
  },
  delphinium: {
    name: 'Delphinium',
    seedPrice: 0,
    baseSellPrice: 530,
    cropGrowTime: 25,
    regrow: 'No',
    baseWeight: 0.02,
    maxWeight: 0.06,
    exclusive: 'Carnival Stand',
  },
  blueberry: {
    name: 'Blueberry',
    seedPrice: 400,
    baseSellPrice: 23,
    cropGrowTime: 22,
    regrow: '5 Slots',
    matureTime: 105, // 1:45min
    baseWeight: 0.01,
    maxWeight: 0.02,
  },
  apple: {
    name: 'Apple',
    seedPrice: 500,
    baseSellPrice: 73,
    cropGrowTime: 5400, // 1:30h
    regrow: '7 Slots',
    matureTime: 21600, // 6h
    baseWeight: 0.18,
    maxWeight: 0.36,
  },
  tulip: {
    name: 'Tulip',
    seedPrice: 600,
    baseSellPrice: 767,
    cropGrowTime: 8,
    regrow: 'No',
    baseWeight: 0.01,
    maxWeight: 0.03,
  },
  tomato: {
    name: 'Tomato',
    seedPrice: 800,
    baseSellPrice: 27,
    cropGrowTime: 40,
    regrow: '2 Slots',
    matureTime: 1100, // 18:20min
    baseWeight: 0.3,
    maxWeight: 0.6,
  },
  daffodil: {
    name: 'Daffodil',
    seedPrice: 1000,
    baseSellPrice: 1090,
    cropGrowTime: 50,
    regrow: 'No',
    baseWeight: 0.01,
    maxWeight: 0.03,
  },
  corn: {
    name: 'Corn',
    seedPrice: 1300,
    baseSellPrice: 36,
    cropGrowTime: 30,
    regrow: '1 Slot',
    matureTime: 130, // 2:10min
    baseWeight: 1.2,
    maxWeight: 2.4,
  },
  watermelon: {
    name: 'Watermelon',
    seedPrice: 2500,
    baseSellPrice: 2708,
    cropGrowTime: 720, // 12min
    regrow: 'No',
    baseWeight: 4.5,
    maxWeight: 13.5,
  },
  pumpkin: {
    name: 'Pumpkin',
    seedPrice: 3000,
    baseSellPrice: 3700,
    cropGrowTime: 2100, // 35min
    regrow: 'No',
    baseWeight: 6.0,
    maxWeight: 18.0,
  },
  echeveria: {
    name: 'Echeveria',
    seedPrice: 4200,
    baseSellPrice: 5520,
    cropGrowTime: 120, // 2min
    regrow: 'No',
    baseWeight: 0.8,
    maxWeight: 2.2,
  },
  coconut: {
    name: 'Coconut',
    seedPrice: 6000,
    baseSellPrice: 302,
    cropGrowTime: 3600, // 1h
    regrow: '7 Slots',
    matureTime: 43200, // 12h
    baseWeight: 5.0,
    maxWeight: 15.0,
  },
  banana: {
    name: 'Banana',
    seedPrice: 7500,
    baseSellPrice: 1750,
    cropGrowTime: 4500, // 1:15h
    regrow: '5 Slots',
    matureTime: 14400, // 4h
    baseWeight: 0.12,
    maxWeight: 0.204,
    exclusive: 'Discord Server with even ID',
  },
  lily: {
    name: 'Lily',
    seedPrice: 20000,
    baseSellPrice: 20123,
    cropGrowTime: 240, // 4min
    regrow: 'No',
    baseWeight: 0.02,
    maxWeight: 0.055,
  },
  camellia: {
    name: 'Camellia',
    seedPrice: 55000,
    baseSellPrice: 4875,
    cropGrowTime: 10800, // 3h
    regrow: '8 Slots',
    matureTime: 86400, // 24h
    baseWeight: 0.3,
    maxWeight: 0.75,
  },
  squash: {
    name: 'Squash',
    seedPrice: 0,
    baseSellPrice: 3500,
    cropGrowTime: 200, // 3:20min
    regrow: '3 Slots',
    matureTime: 1500, // 25min
    baseWeight: 0.3,
    maxWeight: 0.75,
    exclusive: 'Carnival Stand',
  },
  burrostail: {
    name: "Burro's Tail",
    seedPrice: 93000,
    baseSellPrice: 6000,
    cropGrowTime: 100, // 1:40min
    regrow: '2 Slots',
    matureTime: 1800, // 30min
    baseWeight: 0.4,
    maxWeight: 1.0,
  },
  mushroom: {
    name: 'Mushroom',
    seedPrice: 150000,
    baseSellPrice: 160000,
    cropGrowTime: 86400, // 24h
    regrow: 'No',
    baseWeight: 25.0,
    maxWeight: 87.5,
  },
  cactus: {
    name: 'Cactus',
    seedPrice: 250000,
    baseSellPrice: 261000,
    cropGrowTime: 9000, // 2:30h
    regrow: 'No',
    baseWeight: 1500,
    maxWeight: 2700,
  },
  bamboo: {
    name: 'Bamboo',
    seedPrice: 400000,
    baseSellPrice: 500000,
    cropGrowTime: 43200, // 12h
    regrow: 'No',
    baseWeight: 1.0,
    maxWeight: 2.0,
  },
  chrysanthemum: {
    name: 'Chrysanthemum',
    seedPrice: 670000,
    baseSellPrice: 18000,
    cropGrowTime: 10800, // 3h
    regrow: '7 Slots',
    matureTime: 86400, // 24h
    baseWeight: 0.01,
    maxWeight: 0.0275,
  },
  grape: {
    name: 'Grape',
    seedPrice: 850000,
    baseSellPrice: 12500,
    cropGrowTime: 900, // 15min
    regrow: '1 Slot',
    matureTime: 86400, // 24h
    baseWeight: 3.0,
    maxWeight: 6.0,
    exclusive: 'Discord Server ID ending in 1',
  },
  pepper: {
    name: 'Pepper',
    seedPrice: 1000000,
    baseSellPrice: 7220,
    cropGrowTime: 600, // 10min
    regrow: '9 Slots',
    matureTime: 560, // 9:20min
    baseWeight: 0.5,
    maxWeight: 1.0,
  },
  lemon: {
    name: 'Lemon',
    seedPrice: 2000000,
    baseSellPrice: 10000,
    cropGrowTime: 3600, // 1h
    regrow: '6 Slots',
    matureTime: 43200, // 12h
    baseWeight: 0.5,
    maxWeight: 1.5,
    exclusive: 'Discord Server ID ending in 2',
  },
  passionfruit: {
    name: 'Passion Fruit',
    seedPrice: 2750000,
    baseSellPrice: 24500,
    cropGrowTime: 2700, // 45min
    regrow: '2 Slots',
    matureTime: 86400, // 24h
    baseWeight: 9.5,
    maxWeight: 19.0,
  },
  dragonfruit: {
    name: 'Dragon Fruit',
    seedPrice: 5000000,
    baseSellPrice: 24500,
    cropGrowTime: 900, // 15min
    regrow: '7 Slots',
    matureTime: 600, // 10min
    baseWeight: 8.4,
    maxWeight: 17.0,
  },
  lychee: {
    name: 'Lychee',
    seedPrice: 25000000,
    baseSellPrice: 50000,
    cropGrowTime: 1800, // 30min
    regrow: '6 Slots',
    matureTime: 86400, // 24h
    baseWeight: 9.0,
    maxWeight: 18.0,
    exclusive: 'Discord Server ID ending in 2',
  },
  sunflower: {
    name: 'Sunflower',
    seedPrice: 100000000,
    baseSellPrice: 750000,
    cropGrowTime: 18000, // 5h
    regrow: '1 Slot',
    matureTime: 86400, // 24h
    baseWeight: 10.0,
    maxWeight: 25.0,
  },
  starweaver: {
    name: 'Starweaver',
    seedPrice: 1000000000,
    baseSellPrice: 10000000,
    cropGrowTime: 86400, // 24h
    regrow: '1 Slot',
    matureTime: 216000, // 60h
    baseWeight: 10.0,
    maxWeight: 20.0,
  },
  dawnbinder: {
    name: 'Dawnbinder',
    seedPrice: 10000000000,
    baseSellPrice: 11000000,
    cropGrowTime: 86400, // 24h
    regrow: '1 Slot',
    matureTime: 86400, // 24h
    baseWeight: 6.0,
    maxWeight: 15.0,
  },
  moonbinder: {
    name: 'Moonbinder',
    seedPrice: 50000000000,
    baseSellPrice: 11000000,
    cropGrowTime: 86400, // 24h
    regrow: '3 Slots',
    matureTime: 86400, // 24h
    baseWeight: 2.0,
    maxWeight: 4.0,
  },
  favabean: {
    name: 'Fava Bean',
    seedPrice: 0, // TODO: Update with actual stats from wiki
    baseSellPrice: 0, // TODO: Update with actual stats from wiki
    cropGrowTime: 0, // TODO: Update with actual stats from wiki
    regrow: 'No', // TODO: Update with actual stats from wiki
    baseWeight: 0, // TODO: Update with actual stats from wiki
    maxWeight: 0, // TODO: Update with actual stats from wiki
    rarity: 0, // Common
  },
  cacaobean: {
    name: 'Cacao Bean',
    seedPrice: 0, // TODO: Update with actual stats from wiki
    baseSellPrice: 0, // TODO: Update with actual stats from wiki
    cropGrowTime: 0, // TODO: Update with actual stats from wiki
    regrow: 'No', // TODO: Update with actual stats from wiki
    baseWeight: 0, // TODO: Update with actual stats from wiki
    maxWeight: 0, // TODO: Update with actual stats from wiki
    exclusive: 'Divine', // Divine rarity
  },

  // Dawn content (PR-2644) — confirmed from beta floraSpeciesDex
  daisy: {
    name: 'Daisy',
    seedPrice: 100,
    baseSellPrice: 99,
    cropGrowTime: 0, // Single harvest, no secondsToMature
    regrow: '2-3 Slots',
    baseWeight: 0.01,
    maxWeight: 0.025, // baseWeight × maxScale(2.5)
  },
  purpledaisy: {
    name: 'Purple Daisy',
    seedPrice: 0, // Hidden — 1/250 chance from Daisy planting
    baseSellPrice: 9999,
    cropGrowTime: 0, // Single harvest
    regrow: 'No',
    baseWeight: 0.01,
    maxWeight: 0.025, // baseWeight × maxScale(2.5)
    exclusive: 'Daisy Variant',
  },
  lavender: {
    name: 'Lavender',
    seedPrice: 10000,
    baseSellPrice: 20000,
    cropGrowTime: 0, // Single harvest, no secondsToMature
    regrow: 'No',
    baseWeight: 0.02,
    maxWeight: 0.06, // baseWeight × maxScale(3.0)
  },
  ube: {
    name: 'Ube',
    seedPrice: 1000000,
    baseSellPrice: 2000000,
    cropGrowTime: 0, // Single harvest, no secondsToMature
    regrow: 'No',
    baseWeight: 3.5,
    maxWeight: 10.5, // baseWeight × maxScale(3.0)
  },
  dawnbreaker: {
    name: 'Dawnbreaker',
    seedPrice: 10000000,
    baseSellPrice: 12000000,
    cropGrowTime: 0, // Single harvest, no secondsToMature
    regrow: 'No',
    baseWeight: 3.5,
    maxWeight: 10.5, // baseWeight × maxScale(3.0)
  },
};

/**
 * Try multiple PascalCase name variations to find a catalog match.
 * Handles multi-word species like "Dragon Fruit" → "DragonFruit", "Dragonfruit", etc.
 */
function resolveSpeciesForCatalog(cropName: string, displayName: string): ReturnType<typeof getFloraBlueprint> {
  // Try exact display name first (e.g. "Carrot", "Strawberry")
  let bp = getFloraBlueprint(displayName);
  if (bp) return bp;

  // PascalCase join: "Dragon Fruit" → "DragonFruit"
  const pascalJoin = cropName
    .split(/[\s_-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
  bp = getFloraBlueprint(pascalJoin);
  if (bp) return bp;

  // First-char-upper join: "dragonfruit" → "Dragonfruit"
  const stripped = cropName.replace(/[^a-zA-Z]/g, '');
  const firstUpper = stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
  if (firstUpper !== pascalJoin) {
    bp = getFloraBlueprint(firstUpper);
    if (bp) return bp;
  }

  // Original input as-is (for PascalCase inputs like "DragonFruit")
  if (cropName !== displayName && cropName !== pascalJoin) {
    bp = getFloraBlueprint(cropName);
    if (bp) return bp;
  }

  return null;
}

/**
 * Get crop stats by name (case-insensitive).
 * Overlays runtime catalog data when available, keeping hardcoded values as fallback.
 */
export function getCropStats(cropName: string): CropStats | null {
  const normalized = cropName.toLowerCase().replace(/[^a-z]/g, '');
  const hardcoded = CROP_BASE_STATS[normalized] ?? null;

  if (hardcoded && areCatalogsReady()) {
    const blueprint = resolveSpeciesForCatalog(cropName, hardcoded.name);
    if (blueprint) {
      // Derive regrow string from catalog harvest data
      let regrow = hardcoded.regrow;
      if (blueprint.harvestType === 'Multiple') {
        const slots = blueprint.slotCount;
        regrow = `${slots} Slot${slots !== 1 ? 's' : ''}`;
      } else if (blueprint.harvestType === 'Single') {
        regrow = 'No';
      }

      // Compute maxWeight from catalog if possible
      const baseWeight = blueprint.cropBaseWeight ?? hardcoded.baseWeight;
      let maxWeight = hardcoded.maxWeight;
      if (blueprint.cropBaseWeight != null && blueprint.cropMaxScale != null) {
        maxWeight = blueprint.cropBaseWeight * blueprint.cropMaxScale;
      }

      const merged: CropStats = {
        ...hardcoded,
        seedPrice: getSeedPrice(blueprint.species)?.coins ?? hardcoded.seedPrice,
        baseSellPrice: blueprint.cropBaseSellPrice ?? hardcoded.baseSellPrice,
        cropGrowTime: blueprint.secondsToMature ?? hardcoded.cropGrowTime,
        regrow,
        baseWeight,
        maxWeight,
      };

      // matureTime = total plant maturation time (for multi-harvest)
      const matureTime = blueprint.plantSecondsToMature ?? hardcoded.matureTime;
      if (matureTime !== undefined) {
        merged.matureTime = matureTime;
      }

      return merged;
    }
  }

  return hardcoded;
}

/**
 * Get all crop names sorted by shop rarity order (common to rare)
 */
export function getAllCropNames(): string[] {
  // Define shop order based on rarity/unlock progression
  const shopOrder = [
    // Common crops (available early)
    'Carrot', 'Strawberry', 'Aloe', 'Blueberry', 'Apple', 'Tulip', 'Tomato', 'Daffodil',
    'Corn', 'Watermelon', 'Pumpkin', 'Coconut', 'Banana', 'Lily', 'Chrysanthemum',
    // Uncommon crops
    'Echeveria', 'Squash', 'Camellia', 'Grape', 'Pepper', 'Lemon', 'Mushroom',
    // Rare crops
    'Cactus', 'Bamboo', 'Passion Fruit', 'Dragon Fruit', 'Lychee', 'Sunflower',
    // Special/Event crops
    'Delphinium', 'Starweaver', 'Dawnbinder', 'Moonbinder', 'Fava Bean', 'Cacao Bean'
  ];
  
  const allCrops = Object.values(CROP_BASE_STATS).map(crop => crop.name);
  
  // Sort by shop order, then alphabetically for any not in the order list
  return allCrops.sort((a, b) => {
    const indexA = shopOrder.indexOf(a);
    const indexB = shopOrder.indexOf(b);
    
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    } else if (indexA !== -1) {
      return -1;
    } else if (indexB !== -1) {
      return 1;
    } else {
      return a.localeCompare(b);
    }
  });
}

export function calculateCropValue(cropName: string, scale: number): number {
  const stats = getCropStats(cropName);
  if (!stats) return 0;
  return stats.baseSellPrice * scale;
}
