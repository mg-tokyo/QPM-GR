// Native pet-team schema shapes (V24). Kept minimal — we don't validate
// server data locally, we just read what we need.

export type NativePetTeamEmblem =
  | { type: 'number'; number: number }
  | { type: 'pet'; petSpecies: string }
  | { type: 'icon'; icon: string };

export interface NativePetTeamMember {
  petId: string;
  petSpecies: string;
  name: string | null;
}

export interface NativePetTeam {
  id: string;
  name: string;
  members: NativePetTeamMember[];
  emblem: NativePetTeamEmblem;
}

/** qpmTeamId → nativeTeamId. Server assigns nativeTeamId; we learn it. */
export type IdMap = Record<string, string>;

/** Signature that identifies an in-flight optimistic create by content. */
export interface PendingCreate {
  qpmTeamId: string;
  nameTrim: string;
  petIdsSorted: string[];
  sentAt: number;
}

export interface SyncState {
  enabled: boolean;
  idMap: IdMap;
}

export interface SyncStateChangeEvent {
  enabled: boolean;
  mirroredCount: number;
  nativeCount: number;
  effectiveCap: number;
}
