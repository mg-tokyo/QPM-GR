import { getInventoryCapacityState } from '../../economy/inventoryCapacity';
import { fillTemplate } from '../bubbleTags';
import type { LineProvider, Voice } from '../types';
import { voiced } from './voiceText';

function fill(): { count: number; max: number; ratio: number } {
  const s = getInventoryCapacityState();
  return { count: s.count, max: s.max, ratio: s.max > 0 ? s.count / s.max : 0 };
}

export const inventoryFullProvider: LineProvider = {
  id: 'inventoryFull',
  themes: [],
  companionOnly: true,
  relevance() {
    const f = fill();
    return f.ratio >= 0.9 ? Math.min(1, 0.5 + (f.ratio - 0.9) * 5) : null;
  },
  line(voice: Voice) {
    const f = fill();
    return f.ratio >= 0.9
      ? fillTemplate(voiced('feature.npcDialogue.line.inventoryFull', voice, { count: f.count, max: f.max }), [])
      : null;
  },
};
