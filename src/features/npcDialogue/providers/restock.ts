import { getRestockDataSync } from '../../../utils/restock/dataService';
import type { RestockItem } from '../../../utils/restock/types';
import { isTrackedItem, loadTrackedSet } from '../../../store/restockTracked';
import { isWeatherGatedShop } from '../../../store/shopRegistry';
import { formatTimeEstimate } from '../../pets/cropBoostTracker';
import { fillTemplate } from '../bubbleTags';
import { eggSlot, itemSlot, seedSlot } from '../bubbleIcons';
import type { LineProvider, Slot, Voice } from '../types';
import { voiced } from './voiceText';

const WINDOW_MS = 15 * 60000;
export const restockUrgency = (msUntil: number): number =>
  msUntil > WINDOW_MS ? 0.2 : 1 - 0.5 * (Math.max(0, msUntil) / WINDOW_MS);

function nextTracked(nowMs: number, weatherShopsOnly: boolean): RestockItem | null {
  const data = getRestockDataSync();
  if (!data) return null;
  const tracked = loadTrackedSet();
  if (tracked.size === 0) return null;
  let best: RestockItem | null = null;
  for (const item of data) {
    const ts = item.estimated_next_timestamp ?? 0;
    if (ts <= nowMs || (item.total_occurrences ?? 0) < 2) continue;
    if (weatherShopsOnly && !isWeatherGatedShop(item.shop_type)) continue;
    if (!isTrackedItem(tracked, item.shop_type, item.item_id)) continue;
    if (!best || ts < (best.estimated_next_timestamp ?? Infinity)) best = item;
  }
  return best;
}

// shop_type is the restock feed's own shop id; the slot factory that finds a sprite wins, else plain text.
function slotFor(item: RestockItem): Slot {
  for (const make of [seedSlot, eggSlot, itemSlot]) {
    const s = make(item.item_id);
    if (typeof s !== 'string') return s;
  }
  return itemSlot(item.item_id);
}

export const restockProvider: LineProvider = {
  id: 'restock',
  themes: ['weatherShop'],
  relevance(nowMs) {
    const i = nextTracked(nowMs, false);
    return i ? restockUrgency((i.estimated_next_timestamp ?? nowMs) - nowMs) : null;
  },
  line(voice: Voice, nowMs) {
    const item = nextTracked(nowMs, voice === 'trader') ?? nextTracked(nowMs, false);
    if (!item) return null;
    const msUntil = (item.estimated_next_timestamp ?? nowMs) - nowMs;
    const eta = formatTimeEstimate(msUntil / 60000);
    return fillTemplate(voiced('feature.npcDialogue.line.restock', voice, { eta }), [slotFor(item)]);
  },
};
