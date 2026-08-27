import { getAnySpriteDataUrl, getCropSpriteDataUrlWithMutations, getPetSpriteDataUrlWithMutations, isSpritesReady } from '../../../../sprite-v2/compat';
import { stitchPlantSpriteDataUrl } from '../../../../sprite-v2/stitcher';
import { getPetMaxScaleSafe } from '../../../../utils/game/catalogHelpers';
import type { PetSnap, TargetSnap } from '../../../../store/petActivity';

const cache = new Map<string, string>();
function memo(key: string, make: () => string): string {
  if (!isSpritesReady()) return '';
  const hit = cache.get(key); if (hit) return hit;
  const url = make(); if (url) cache.set(key, url); return url;
}
export function petSpriteUrl(pet: PetSnap): string {
  return memo(`pet|${pet.species}|${pet.mutations.join(',')}`, () => getPetSpriteDataUrlWithMutations(pet.species, pet.mutations));
}
export function petSizeRatio(pet: PetSnap): number {
  const max = getPetMaxScaleSafe(pet.species);
  if (!max || max <= 1) return 1;
  return Math.max(0, Math.min(1, (pet.targetScale - 1) / (max - 1)));
}
// Key prefixes: eggs live under sprite/pet/{EggId}, seeds under sprite/seed/, tools under sprite/item/.
export function targetSpriteUrl(t: TargetSnap): string {
  switch (t.kind) {
    case 'crop': return memo(`crop|${t.species}|${t.mutations.join(',')}`, () => getCropSpriteDataUrlWithMutations(t.species, t.mutations));
    case 'growSlot': return memo(`slot|${t.species}|${t.mutations.join(',')}|${t.targetScale.toFixed(2)}`, () => stitchPlantSpriteDataUrl({ species: t.species, slotMutations: t.mutations, slotScales: [t.targetScale] }));
    case 'pet': return petSpriteUrl(t.pet);
    case 'egg': return memo(`egg|${t.eggId}`, () => getAnySpriteDataUrl(`sprite/pet/${t.eggId}`));
    case 'seed': return memo(`seed|${t.species}`, () => getAnySpriteDataUrl(`sprite/seed/${t.species}`));
    case 'tool': return memo(`tool|${t.toolId}`, () => getAnySpriteDataUrl(`sprite/item/${t.toolId}`));
    case 'coin': return memo('coin', () => getAnySpriteDataUrl('sprite/ui/Coin'));
  }
}
