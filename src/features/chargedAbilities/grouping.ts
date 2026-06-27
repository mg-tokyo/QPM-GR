// src/features/chargedAbilities/grouping.ts
// Collapse identical pet snapshots into groups for display.
//
// Two Ostriches both ready with the same DawnCapture footprint render once
// as "Ostrich × 2" instead of two identical cards. The mount button on a
// grouped card mounts the first unmounted member.

import type { PetAbilityTargetSnapshot } from './types';

export interface SnapshotGroup {
  /** Representative snapshot — closest-to-ready, then highest qualifyingCount. */
  rep: PetAbilityTargetSnapshot;
  /** All snapshots that share this group's identity. */
  members: readonly PetAbilityTargetSnapshot[];
  /** How many pets share this group. */
  count: number;
  /** Pet slot IDs of unmounted members — for the mount button to pick from. */
  unmountedSlotIds: readonly string[];
}

function bucketKey(s: PetAbilityTargetSnapshot): string {
  return [
    s.petSpecies,
    s.abilityId,
    s.isMounted ? 'm' : 'u',
    s.ready ? 'r' : 'c',
  ].join('|');
}

export function groupSnapshots(
  snapshots: readonly PetAbilityTargetSnapshot[],
): SnapshotGroup[] {
  const buckets = new Map<string, PetAbilityTargetSnapshot[]>();
  for (const snap of snapshots) {
    const key = bucketKey(snap);
    const arr = buckets.get(key);
    if (arr) arr.push(snap);
    else buckets.set(key, [snap]);
  }

  const groups: SnapshotGroup[] = [];
  for (const members of buckets.values()) {
    // Representative = best member for the user to look at: ready first, then
    // closest to ready (lowest cooldown), then highest qualifyingCount.
    const sorted = [...members].sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      if (a.cdRemainingMs !== b.cdRemainingMs) return a.cdRemainingMs - b.cdRemainingMs;
      return b.qualifyingCount - a.qualifyingCount;
    });
    const rep = sorted[0]!;
    const unmountedSlotIds = members
      .filter((m) => !m.isMounted && m.petSlotId)
      .map((m) => m.petSlotId);
    groups.push({ rep, members, count: members.length, unmountedSlotIds });
  }

  // Group ordering mirrors selector.ts: mounted first, then ready+qualifying,
  // then ready, then by ascending cooldown.
  groups.sort((a, b) => {
    const ar = a.rep;
    const br = b.rep;
    if (ar.isMounted !== br.isMounted) return ar.isMounted ? -1 : 1;
    const aRanked = ar.ready && ar.qualifyingCount > 0;
    const bRanked = br.ready && br.qualifyingCount > 0;
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    if (ar.ready !== br.ready) return ar.ready ? -1 : 1;
    return ar.cdRemainingMs - br.cdRemainingMs;
  });

  return groups;
}
