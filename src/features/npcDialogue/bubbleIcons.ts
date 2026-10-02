import { getEggSafe, getItemSafe, getMutationName, getPlantSafe, isValidMutation } from '../../utils/game/catalogHelpers';
import { isRecord } from '../../utils/typeGuards';
import type { Slot } from './types';
import { mutationTag } from './bubbleTags';

const str = (o: unknown, k: string): string | null => (isRecord(o) && typeof o[k] === 'string' && o[k] ? (o[k] as string) : null);
const thing = (name: string | null, sprite: string | null, fallback: string): Slot =>
  (name && sprite ? { gameThing: { name, sprite } } : name ?? fallback);

export const seedSlot = (species: string): Slot => { const s = getPlantSafe(species)?.seed; return thing(str(s, 'name'), str(s, 'sprite'), species); };
export const cropSlot = (species: string): Slot => { const c = getPlantSafe(species)?.crop; return thing(str(c, 'name'), str(c, 'sprite'), species); };
export const eggSlot = (eggId: string): Slot => { const e = getEggSafe(eggId); return thing(str(e, 'name'), str(e, 'sprite'), eggId); };
export const itemSlot = (itemId: string): Slot => { const i = getItemSafe(itemId); return thing(str(i, 'name'), str(i, 'sprite'), itemId); };
/** Mutation ids are the game's own (`Wet`, `Frozen`); an id the catalog does not know renders as its name in text. */
export const mutationSlot = (mutationId: string): Slot => (isValidMutation(mutationId) ? mutationTag(mutationId) : getMutationName(mutationId));
