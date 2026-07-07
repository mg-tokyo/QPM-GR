// One-time import of pet teams from Aries Mod's localStorage (keyed under qws:pets:teams:v1 and fallbacks) into QPM's pet teams config.

import { readTeamsFromLocalStorage } from '../integrations/ariesBridge';
import { getTeamsConfig, createTeam, setTeamSlot } from '../store/petTeams';
import type { PetTeam } from '../types/petTeams';

export interface AriesImportResult {
  imported: number;
  skipped: number;
  available: boolean;
}

function slotsFingerprint(slots: (string | null)[]): string {
  return slots.slice(0, 3).map(s => s ?? '').join('|');
}

/** Imports Aries Mod pet teams into QPM's config, deduplicating by name + slot fingerprint. */
export function importAriesTeams(): AriesImportResult {
  const ariesTeams = readTeamsFromLocalStorage();

  const realTeams = ariesTeams.filter(t => t.source !== 'activePets');

  if (realTeams.length === 0) {
    return { imported: 0, skipped: 0, available: false };
  }

  const config = getTeamsConfig();

  const existingFingerprints = new Set<string>(
    config.teams.map(t => `${t.name}::${slotsFingerprint(t.slots)}`),
  );

  let imported = 0;
  let skipped = 0;

  for (const raw of realTeams) {
    const slots: PetTeam['slots'] = [
      raw.slotIds[0] ?? null,
      raw.slotIds[1] ?? null,
      raw.slotIds[2] ?? null,
    ];

    const fingerprint = `${raw.name}::${slotsFingerprint(slots)}`;
    if (existingFingerprints.has(fingerprint)) {
      skipped++;
      continue;
    }

    const newTeam = createTeam(raw.name);
    for (let i = 0; i < 3; i++) {
      if (slots[i]) {
        setTeamSlot(newTeam.id, i as 0 | 1 | 2, slots[i] ?? null);
      }
    }

    existingFingerprints.add(fingerprint);
    imported++;
  }

  return { imported, skipped, available: true };
}
