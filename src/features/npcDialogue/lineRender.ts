import { PROVIDERS } from './providers';
import type { Candidate } from './selector';
import type { BubbleLine, LineId, Voice } from './types';

export function collectCandidates(nowMs: number): Candidate[] {
  const out: Candidate[] = [];
  for (const p of PROVIDERS) {
    let relevance: number | null = null;
    try { relevance = p.relevance(nowMs); } catch { relevance = null; }
    if (relevance !== null) out.push({ id: p.id, themes: p.themes, companionOnly: p.companionOnly === true, relevance });
  }
  return out;
}

// A provider's relevance and line can disagree (pet left the team, data changed between calls);
// walk the ranked pool so one empty line never silences the rest.
export function renderFirst(ranked: readonly LineId[], voice: Voice, nowMs: number): { lineId: LineId; line: BubbleLine } | null {
  for (const id of ranked) {
    const provider = PROVIDERS.find((p) => p.id === id);
    let line: BubbleLine | null = null;
    try { line = provider ? provider.line(voice, nowMs) : null; } catch { line = null; }
    if (line) return { lineId: id, line };
  }
  return null;
}
