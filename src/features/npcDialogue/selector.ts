import type { LineId, Speaker } from './types';

export const ASK_AGAIN_MS = 8000;
export const RELEVANCE_FLOOR = 0.5;

export interface Candidate {
  id: LineId;
  themes: readonly string[];
  companionOnly: boolean;
  relevance: number;
}

export interface SelectorState {
  talks: Record<string, number>;
  lastTalkAt: Record<string, number>;
  lastServedAt: Partial<Record<LineId, number>>;
}

export interface SelectInput {
  speaker: Speaker;
  companionActive: boolean;
  candidates: readonly Candidate[];
  enabled: ReadonlySet<LineId>;
  state: SelectorState;
  nowMs: number;
}

export interface SelectResult {
  lineId: LineId | null;
  /** The eligible pool in serve order; `lineId` is its head. */
  ranked: LineId[];
  state: SelectorState;
}

export const initialSelectorState = (): SelectorState => ({ talks: {}, lastTalkAt: {}, lastServedAt: {} });

export function markServed(state: SelectorState, lineId: LineId, nowMs: number): SelectorState {
  return { ...state, lastServedAt: { ...state.lastServedAt, [lineId]: nowMs } };
}

export function selectLine(input: SelectInput): SelectResult {
  const { speaker, companionActive, candidates, enabled, nowMs } = input;
  const id = speaker.npcId;
  const priorTalks = input.state.talks[id] ?? 0;
  const lastAt = input.state.lastTalkAt[id];
  const state: SelectorState = {
    talks: { ...input.state.talks, [id]: priorTalks + 1 },
    lastTalkAt: { ...input.state.lastTalkAt, [id]: nowMs },
    lastServedAt: { ...input.state.lastServedAt },
  };
  // First Talk per NPC per session is the game's self-introduction (npcGreetings.ts:498-508).
  if (priorTalks === 0) return { lineId: null, ranked: [], state };

  const themed = (c: Candidate): boolean => speaker.locationKey !== null && c.themes.includes(speaker.locationKey);
  const askAgain = lastAt !== undefined && nowMs - lastAt < ASK_AGAIN_MS;
  const pool = candidates.filter((c) => {
    if (!enabled.has(c.id)) return false;
    if (speaker.role === 'companion') return true;
    if (c.companionOnly) return false;
    // A normal Talk answers with the NPC's own speciality only; a quick re-Talk opens every line unless the Companion is the main voice.
    return companionActive || !askAgain ? themed(c) : true;
  }).filter((c) => askAgain || c.relevance >= RELEVANCE_FLOOR);

  // Least-recently-served first so QPM lines cycle like the game's own NPC rotation; themed and relevance break ties.
  pool.sort((a, b) => {
    const aServed = state.lastServedAt[a.id] ?? 0;
    const bServed = state.lastServedAt[b.id] ?? 0;
    if (aServed !== bServed) return aServed - bServed;
    if (speaker.role === 'native') {
      const themedDelta = Number(themed(b)) - Number(themed(a));
      if (themedDelta !== 0) return themedDelta;
    }
    return b.relevance - a.relevance;
  });
  const ranked = pool.map((c) => c.id);
  return { lineId: ranked[0] ?? null, ranked, state };
}
