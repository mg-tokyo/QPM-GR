import { getPlantCatalog, areCatalogsReady } from '../catalogs/gameCatalogs';

export function getCropCategory(species: string): string | null {
  if (!species) return null;

  const normalized = species.toLowerCase();

  if (/seed|grain|wheat|corn|rice|barley|oat/.test(normalized)) return 'Seed';
  if (/fruit|berry|apple|banana|grape|melon|lemon/.test(normalized)) return 'Fruit';
  if (/vegetable|carrot|tomato|pepper|mushroom|bamboo/.test(normalized)) return 'Vegetable';
  if (/flower|lily|tulip|rose|daisy|chrysanthemum|daffodil|lavender/.test(normalized)) return 'Flower';
  if (/succulent|cactus|aloe|echeveria/.test(normalized)) return 'Succulent';

  if (areCatalogsReady()) {
    const plantCatalog = getPlantCatalog();
    if (plantCatalog && plantCatalog[species]) {
      const entry = plantCatalog[species];

      if (entry.seed?.rarity === 'Mythical') return 'Special';
      if (entry.seed?.rarity === 'Legendary') return 'Special';

      const seedPrice = entry.seed?.coinPrice || 0;
      if (seedPrice > 100000) return 'Rare Plant';
    }
  }

  return 'Other';
}

export function getAllCropCategories(): string[] {
  const categories = new Set<string>();

  if (areCatalogsReady()) {
    const plantCatalog = getPlantCatalog();
    if (plantCatalog) {
      for (const species of Object.keys(plantCatalog)) {
        const category = getCropCategory(species);
        if (category) categories.add(category);
      }
    }
  }

  return Array.from(categories).sort();
}
