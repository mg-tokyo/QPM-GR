import { getItemCatalogName, getItemCatalogSpriteKey } from '../../../catalogs/shopEligibility';
import {
  getAnySpriteDataUrl, getCropSpriteDataUrlWithMutations, getPetSpriteDataUrlWithMutations, isSpritesReady, onSpritesReady,
} from '../../../sprite-v2/compat';
import { stitchPlantSpriteDataUrl } from '../../../sprite-v2/stitcher';
import {
  areCatalogsReady, getAbilityName, getPetSafe, getPlantSafe, isValidAbility, onCatalogsReady,
} from '../../../utils/game/catalogHelpers';
import { getAbilityColor } from '../../../utils/rendering/petCardRenderer';
import type { CardCatalog } from './infoCard';

const name = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// stitchPlantSpriteDataUrl encodes a fresh PNG on every call (the pet and crop helpers cache theirs); the card asks
// again whenever the held item is redrawn, so the last one is kept.
let lastPlant: { key: string; url: string } | null = null;

/** The info card's names, sprites and ability colours, all from the runtime catalogs and sprite-v2. */
export const cardCatalog: CardCatalog = {
  itemName: (id) => getItemCatalogName(id),
  petName: (species) => name(getPetSafe(species)?.name),
  cropName: (species) => name(getPlantSafe(species)?.crop.name),
  plantName: (species) => name(getPlantSafe(species)?.plant.name),
  abilityName: (id) => (isValidAbility(id) ? getAbilityName(id) : null),
  hungerCap: (species) => {
    const cap = getPetSafe(species)?.coinsToFullyReplenishHunger;
    return typeof cap === 'number' && cap > 0 ? cap : null;
  },
  ready: () => isSpritesReady() && areCatalogsReady(),
  onReady: (cb) => {
    const offs = [onSpritesReady(cb), onCatalogsReady(() => { cb(); })];
    return () => { for (const off of offs) off(); };
  },
  petSprite: (species, mutations) => (isSpritesReady() ? getPetSpriteDataUrlWithMutations(species, [...mutations]) : ''),
  cropSprite: (species, mutations) => (isSpritesReady() ? getCropSpriteDataUrlWithMutations(species, [...mutations]) : ''),
  plantSprite: (species, slotMutations) => {
    if (!isSpritesReady()) return '';
    const key = JSON.stringify([species, slotMutations]);
    if (lastPlant?.key === key) return lastPlant.url;
    const url = stitchPlantSpriteDataUrl({ species, slotMutations: slotMutations.map((m) => [...m]), activeSlotCount: slotMutations.length });
    if (url) lastPlant = { key, url };
    return url;
  },
  itemSprite: (id) => (isSpritesReady() ? getAnySpriteDataUrl(getItemCatalogSpriteKey(id)) : ''),
  abilityColour: (id) => getAbilityColor(id).base,
};
