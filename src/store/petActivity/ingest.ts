import { subscribe as stateTreeSubscribe } from '../../core/stateTree';
import { findSlotIdxByOwner, getPlayerIdSync } from '../../core/playerContext';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';
import { getAbilityFamilyKey } from '../../features/pets/compare/families';
import { getAbilityDef } from '../../catalogs/gameCatalogs';
import { enrichEvent } from './enrichLive';
import { entrySignature, normalizeServerEntry, serverEntryKey, type NormalizeDeps } from './normalize';
import type { PetActivityEvent } from './types';

export const ACTIVITY_LOG_STATE_PATH = '/child/data/userSlots/{myIdx}/data/activityLogs';

const deps: NormalizeDeps = {
  familyOf: (action) => getAbilityFamilyKey(action),
  isAbilityAction: (action) => getAbilityDef(action) != null,
};

export function selectMyActivityLogs(snapshot: QuinoaStateSnapshot): unknown[] | null {
  const playerId = getPlayerIdSync();
  if (!playerId) return null;
  const slots = snapshot.child?.data?.userSlots;
  if (!Array.isArray(slots)) return null;
  const idx = findSlotIdxByOwner(slots, playerId);
  const logs = idx >= 0 ? slots[idx]?.data?.activityLogs : null;
  return Array.isArray(logs) ? logs : null;
}

export interface IngestResult { added: PetActivityEvent[]; updated: PetActivityEvent[] }

export class ServerLogIngester {
  private lastSeen = new Map<string, string>();
  constructor(private readonly known: (key: string) => PetActivityEvent | undefined) {}

  /** Diffs by key + parameter signature; array index is never used (25-slot shift buffer). */
  ingest(raw: unknown[]): IngestResult {
    const result: IngestResult = { added: [], updated: [] };
    const next = new Map<string, string>();
    for (const entry of raw) {
      const key = serverEntryKey(entry); if (!key) continue;
      const sig = entrySignature(entry);
      next.set(key, sig);
      const prevSig = this.lastSeen.get(key);
      const existing = this.known(key);
      if (prevSig === sig && existing) continue;
      const normalized = normalizeServerEntry(entry, deps); if (!normalized) continue;
      const event = enrichEvent(normalized);
      if (!existing) { result.added.push(event); continue; }
      // Known event whose parameters grew (server stacking). Keep the original
      // garden cluster — the garden has moved on since the proc happened.
      if (prevSig !== undefined && prevSig !== sig) {
        const upd: PetActivityEvent = { ...event, updatedAt: Date.now() };
        if (existing.cluster) { upd.cluster = existing.cluster; upd.clusterTotal = existing.clusterTotal ?? 0; }
        result.updated.push(upd);
      }
    }
    this.lastSeen = next;
    return result;
  }
}

export function subscribeServerLog(cb: (raw: unknown[]) => void): () => void {
  return stateTreeSubscribe(selectMyActivityLogs, (value) => { if (value) cb(value); }, 'petActivity', ACTIVITY_LOG_STATE_PATH);
}
