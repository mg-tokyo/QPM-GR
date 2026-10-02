import { estimatePityCount, getPityOutcomes, parsePityCounterKey, type PityKind } from '../../../catalogs/pityThresholds';
import { getPityAccountCreatedAt, getPitySnapshot, isPityKindEnabled } from '../../../store/pityTracker';
import { getMutationName, getPetSafe, getPlantSafe } from '../../../utils/game/catalogHelpers';
import { fillTemplate } from '../bubbleTags';
import { eggSlot, itemSlot, seedSlot } from '../bubbleIcons';
import type { LineProvider, Slot, Voice } from '../types';
import { voiced } from './voiceText';

const RECENT_MS = 24 * 3600000;
// ratio >= 1 short-circuit avoids IEEE-754 drift where 0.5 + (1 - 0.8) * 2.5 = 0.9999999999999999.
export const pityUrgency = (ratio: number): number =>
  ratio >= 1 ? 1 : ratio < 0.8 ? 0.2 : 0.5 + (ratio - 0.8) * 2.5;

interface Closest { kind: PityKind; itemId: string; outcomeId: string; remaining: number; ratio: number }

function closest(nowMs: number): Closest | null {
  const snap = getPitySnapshot();
  const created = getPityAccountCreatedAt();
  let best: Closest | null = null;
  for (const [key, counter] of Object.entries(snap.counters)) {
    if ((counter.lastPullAt ?? 0) < nowMs - RECENT_MS) continue;
    const parsed = parsePityCounterKey(key);
    if (!parsed || !isPityKindEnabled(parsed.kind)) continue;
    const outcome = getPityOutcomes({ kind: parsed.kind, id: parsed.itemId }).find((o) => o.outcomeId === parsed.outcomeId);
    if (!outcome || outcome.thresholdPulls <= 0) continue;
    const estimate = estimatePityCount(counter, outcome.thresholdPulls, created);
    const ratio = (estimate + 1) / outcome.thresholdPulls;
    if (!best || ratio > best.ratio) best = { ...parsed, remaining: Math.max(0, outcome.thresholdPulls - 1 - estimate), ratio };
  }
  return best;
}

const sourceSlot = (c: Closest): Slot =>
  c.kind === 'egg' ? eggSlot(c.itemId) : c.kind === 'seed' ? seedSlot(c.itemId) : itemSlot(c.itemId);

function outcomeName(id: string): string {
  const pet = getPetSafe(id);
  if (pet?.name) return pet.name;
  const plant = getPlantSafe(id);
  if (plant?.name) return plant.name;
  return getMutationName(id);
}

export const pityProvider: LineProvider = {
  id: 'pity',
  themes: ['weatherShop'],
  relevance(nowMs) { const c = closest(nowMs); return c ? pityUrgency(c.ratio) : null; },
  line(voice: Voice, nowMs) {
    const c = closest(nowMs);
    return c
      ? fillTemplate(
          voiced('feature.npcDialogue.line.pity', voice, { remaining: c.remaining, outcome: outcomeName(c.outcomeId) }),
          [sourceSlot(c)],
        )
      : null;
  },
};
