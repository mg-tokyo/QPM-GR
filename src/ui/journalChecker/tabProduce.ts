import {
  getCropSpriteCanvas,
  getCropSpriteWithMutations,
} from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/dom/canvasHelpers';
import {
  normalizeSpeciesName,
  SHOP_LAYOUT_INDEX,
  TALL_SPECIES,
  COLOR_PRODUCE,
  GRADIENT_PRODUCE,
} from './constants';
import { buildSpeciesCard, type VariantInfo } from './speciesCard';

export function renderProduceTab(
  produceData: Array<{ species: string; variants: VariantInfo[] }>,
  showMissingOnly: boolean,
  container: HTMLElement,
): void {
  const ordered = produceData.slice().sort((a, b) => {
    const aKey = a.species.toLowerCase().replace(/[^a-z0-9]/g, '');
    const bKey = b.species.toLowerCase().replace(/[^a-z0-9]/g, '');
    const aIdx = SHOP_LAYOUT_INDEX.get(aKey) ?? Number.MAX_SAFE_INTEGER;
    const bIdx = SHOP_LAYOUT_INDEX.get(bKey) ?? Number.MAX_SAFE_INTEGER;
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

    const speciesKey = entry.species.toLowerCase().replace(/\s+/g, '');
    const normalizedName = normalizeSpeciesName(entry.species);
    let spriteDataUrl: string | null = null;

    if (isComplete) {
      spriteDataUrl =
        canvasToDataUrl(getCropSpriteWithMutations(normalizedName, ['Rainbow'])) ||
        canvasToDataUrl(getCropSpriteWithMutations(speciesKey, ['Rainbow'])) ||
        canvasToDataUrl(getCropSpriteWithMutations(entry.species, ['Rainbow'])) ||
        canvasToDataUrl(getCropSpriteCanvas(normalizedName));
    } else {
      spriteDataUrl =
        canvasToDataUrl(getCropSpriteCanvas(normalizedName)) ||
        canvasToDataUrl(getCropSpriteCanvas(speciesKey)) ||
        canvasToDataUrl(getCropSpriteCanvas(entry.species.toLowerCase()));
    }

    const isTall = TALL_SPECIES.has(speciesKey.replace(/[^a-z0-9]/g, ''));

    container.appendChild(buildSpeciesCard({
      species: entry.species,
      variants,
      spriteDataUrl,
      isTall,
      color: COLOR_PRODUCE,
      gradient: GRADIENT_PRODUCE,
      percentage,
      collectedCount,
      totalCount,
      isComplete,
      notesKey: entry.species,
    }));
  }
}
