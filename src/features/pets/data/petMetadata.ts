import scrapedPets from '../../../../scraped-data/pets.json';

interface RawScrapedPet {
  name: string;
  hungerCost?: number;
  baseTileScale?: number;
  maxScale?: number;
  sellPrice?: number;
  weight?: number;
  moveProb?: number;
  hoursToMature?: number;
  rarity?: string;
}

interface ScrapedPetsFile {
  pets: Record<string, RawScrapedPet>;
}

export interface PetMetadata {
  weight: number | null;
  maturityHours: number | null;
  hungerCost: number | null;
  sellPrice: number | null;
  rarity: string | null;
}

const METADATA_BY_SPECIES = new Map<string, PetMetadata>();

function normalizeSpeciesName(name: string): string {
  return name.trim().toLowerCase();
}

(function buildMetadataCache() {
  const payload = scrapedPets as ScrapedPetsFile;
  if (!payload?.pets) return;

  for (const [species, entry] of Object.entries(payload.pets)) {
    if (!entry) continue;
    METADATA_BY_SPECIES.set(normalizeSpeciesName(species), {
      weight: typeof entry.weight === 'number' ? entry.weight : null,
      maturityHours: typeof entry.hoursToMature === 'number' ? entry.hoursToMature : null,
      hungerCost: typeof entry.hungerCost === 'number' ? entry.hungerCost : null,
      sellPrice: typeof entry.sellPrice === 'number' ? entry.sellPrice : null,
      rarity: entry.rarity ?? null,
    });
  }
})();

export function getPetMetadata(species: string | null | undefined): PetMetadata | null {
  if (!species) return null;
  const direct = METADATA_BY_SPECIES.get(normalizeSpeciesName(species));
  return direct ?? null;
}
