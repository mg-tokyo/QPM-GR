export interface MaxStrReading {
  petId: string;
  strength: number;
  maxStr: number;
  /** Minutes to max STR at the team's planning rate; null when unknown. */
  minutes: number | null;
}

export interface MaxStrPetState {
  fired: boolean;
  atMax: boolean;
}

export type MaxStrEdge = { kind: 'fire' | 'max' | 'left'; petId: string };

/**
 * One team snapshot. A pet fires once per stay when its ETA is within the lead, including on first sight
 * (PD1); a pet first seen at max stays silent. An empty team is a gap in the feed, not every pet leaving.
 */
export function stepMaxStr(state: Map<string, MaxStrPetState>, readings: readonly MaxStrReading[], leadMinutes: number): MaxStrEdge[] {
  if (readings.length === 0) return [];
  const edges: MaxStrEdge[] = [];
  const seen = new Set<string>();
  for (const r of readings) {
    seen.add(r.petId);
    const atMax = r.strength >= r.maxStr;
    const prev = state.get(r.petId);
    if (atMax) {
      if (prev && !prev.atMax) edges.push({ kind: 'max', petId: r.petId });
      state.set(r.petId, { fired: prev?.fired ?? false, atMax: true });
      continue;
    }
    const due = r.minutes !== null && r.minutes <= leadMinutes;
    const fired = prev?.fired ?? false;
    if (due && !fired) edges.push({ kind: 'fire', petId: r.petId });
    state.set(r.petId, { fired: fired || due, atMax: false });
  }
  for (const id of [...state.keys()]) {
    if (seen.has(id)) continue;
    state.delete(id);
    edges.push({ kind: 'left', petId: id });
  }
  return edges;
}
