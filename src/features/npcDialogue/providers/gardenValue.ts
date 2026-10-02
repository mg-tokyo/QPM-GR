import { getGardenSnapshot } from '../../garden/bridge';
import { calculatePlantValue } from '../../economy/valueCalculator';
import { isRecord } from '../../../utils/typeGuards';
import { coinsTag, fillTemplate } from '../bubbleTags';
import { cropSlot } from '../bubbleIcons';
import type { LineProvider, Voice } from '../types';
import { voiced } from './voiceText';

function bestUnpreserved(nowMs: number): { species: string; value: number } | null {
  const snap = getGardenSnapshot();
  let best: { species: string; value: number } | null = null;
  for (const tiles of [snap?.tileObjects, snap?.boardwalkTileObjects]) {
    if (!tiles) continue;
    for (const tile of Object.values(tiles)) {
      if (!isRecord(tile) || tile.objectType !== 'plant' || !Array.isArray(tile.slots)) continue;
      for (const slot of tile.slots) {
        if (!isRecord(slot) || slot.preserved === true || typeof slot.species !== 'string') continue;
        const end = Number(slot.endTime);
        if (!Number.isFinite(end) || end > nowMs) continue;
        const scale = typeof slot.targetScale === 'number' && Number.isFinite(slot.targetScale) ? slot.targetScale : 1;
        const value = calculatePlantValue(
          slot.species,
          scale,
          Array.isArray(slot.mutations) ? (slot.mutations as string[]) : [],
        );
        if (value > 0 && (!best || value > best.value)) best = { species: slot.species, value };
      }
    }
  }
  return best;
}

export const gardenValueProvider: LineProvider = {
  id: 'gardenValue',
  themes: ['preservationStation'],
  relevance(nowMs) { return bestUnpreserved(nowMs) ? 0.6 : null; },
  line(voice: Voice, nowMs) {
    const best = bestUnpreserved(nowMs);
    return best
      ? fillTemplate(voiced('feature.npcDialogue.line.gardenValue', voice), [cropSlot(best.species), coinsTag(best.value)])
      : null;
  },
};
