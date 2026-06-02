import {
  getPetSpriteCanvas,
  getPetSpriteWithMutations,
} from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/dom/canvasHelpers';
import {
  normalizeSpeciesName,
  PET_LAYOUT_INDEX,
  COLOR_PETS,
  GRADIENT_PETS,
} from './constants';
import { buildSpeciesCard, type VariantInfo } from './speciesCard';

export function renderPetsTab(
  petsData: Array<{ species: string; variants: VariantInfo[] }>,
  showMissingOnly: boolean,
  container: HTMLElement,
): void {
  const ordered = petsData.slice().sort((a, b) => {
    const aKey = a.species.toLowerCase().replace(/[^a-z0-9]/g, '');
    const bKey = b.species.toLowerCase().replace(/[^a-z0-9]/g, '');
    const aIdx = PET_LAYOUT_INDEX.get(aKey) ?? Number.MAX_SAFE_INTEGER;
    const bIdx = PET_LAYOUT_INDEX.get(bKey) ?? Number.MAX_SAFE_INTEGER;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.species.localeCompare(b.species);
  });

  for (const entry of ordered) {
    const variants = showMissingOnly
      ? entry.variants.filter(v => !v.collected)
      : entry.variants;
    if (variants.length === 0) continue;

    const collectedCount = entry.variants.filter(v => v.collected).length;
    const totalCount = entry.variants.length;
    const percentage = (collectedCount / totalCount) * 100;
    const isComplete = percentage === 100;

    const normalizedName = normalizeSpeciesName(entry.species);
    let spriteDataUrl: string | null = null;

    if (isComplete) {
      spriteDataUrl =
        canvasToDataUrl(getPetSpriteWithMutations(normalizedName, ['Rainbow'])) ||
        canvasToDataUrl(getPetSpriteWithMutations(entry.species, ['Rainbow'])) ||
        canvasToDataUrl(getPetSpriteCanvas(normalizedName)) ||
        canvasToDataUrl(getPetSpriteCanvas(entry.species.toLowerCase()));
    } else {
      spriteDataUrl =
        canvasToDataUrl(getPetSpriteCanvas(normalizedName)) ||
        canvasToDataUrl(getPetSpriteCanvas(entry.species.toLowerCase()));
    }

    container.appendChild(buildSpeciesCard({
      species: entry.species,
      variants,
      spriteDataUrl,
      color: COLOR_PETS,
      gradient: GRADIENT_PETS,
      percentage,
      collectedCount,
      totalCount,
      isComplete,
      notesKey: `pet:${entry.species}`,
    }));
  }
}
