import { getAbilityHistorySnapshot, type AbilityHistory } from '../../../store/abilityLogs';
import { getActivePetInfos } from '../../../store/pets';
import { getAbilityName } from '../../../utils/game/catalogHelpers';
import { formatTimeEstimate } from '../../pets/cropBoostTracker';
import { fillTemplate } from '../bubbleTags';
import type { LineProvider, Voice } from '../types';
import { voiced } from './voiceText';

const WINDOW_MS = 5 * 60000;
const RARE_MAX_EVENTS = 3;

function latest(nowMs: number): AbilityHistory | null {
  let best: AbilityHistory | null = null;
  // One history is registered under several lookup keys; a Set dedupes by identity.
  for (const h of new Set(getAbilityHistorySnapshot().values())) {
    if (nowMs - h.lastPerformedAt > WINDOW_MS) continue;
    if (!best || h.lastPerformedAt > best.lastPerformedAt) best = h;
  }
  return best;
}

export const abilityProcProvider: LineProvider = {
  id: 'abilityProc',
  themes: [],
  relevance(nowMs) {
    const h = latest(nowMs);
    return h ? (h.events.length <= RARE_MAX_EVENTS ? 0.6 : 0.3) : null;
  },
  line(voice: Voice, nowMs) {
    const h = latest(nowMs);
    if (!h) return null;
    const info = getActivePetInfos().find((p) => p.petId !== null && p.petId === h.petId);
    const pet = info?.name ?? info?.species;
    if (!pet) return null;
    const ago = formatTimeEstimate((nowMs - h.lastPerformedAt) / 60000);
    return fillTemplate(
      voiced('feature.npcDialogue.line.abilityProc', voice, { pet, ability: getAbilityName(h.abilityId), ago }),
      [],
    );
  },
};
