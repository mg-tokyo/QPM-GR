// src/types/petTeams.ts
// Types for the QPM Pet Teams feature

// ---------------------------------------------------------------------------
// Team configuration
// ---------------------------------------------------------------------------

export interface PetTeam {
  id: string;                                              // UUID
  name: string;                                            // User-defined name
  slots: [string | null, string | null, string | null];   // pet item UUIDs (ActivePetInfo.slotId)
  createdAt: number;
  updatedAt: number;
}

export interface PetTeamsConfig {
  teams: PetTeam[];                        // Soft limit: 100
  keybinds: Record<string, string>;        // e.g. { "1": "team-id" } — key → team id
  activeTeamId: string | null;             // Currently matched team
  lastAppliedAt: number;
}

// ---------------------------------------------------------------------------
// Per-pet-item feed policy (extends existing SpeciesOverride model)
// ---------------------------------------------------------------------------

export interface PetItemFeedOverride {
  petItemId: string;       // pet item UUID (ActivePetInfo.slotId)
  displayLabel?: string;   // human-readable label shown in UI (e.g. "Gold Turtle Lv.42")
  allowed?: string[];      // allowed food species (overrides species diet)
  forbidden?: string[];    // forbidden food species
  preferred?: string;      // preferred food species (try first)
}

export interface PetFeedPolicy {
  petItemOverrides: Record<string, PetItemFeedOverride>; // keyed by petItemId
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Unified pet pool (active + hutch + inventory)
// ---------------------------------------------------------------------------

export interface PooledPet {
  id: string;              // pet item UUID (matches ActivePetInfo.slotId)
  petId: string | null;    // entity UUID — used for ability tracker lookups
  name: string;
  species: string;
  level: number | null;    // XP-based level estimate (internal use; display uses STR only)
  strength: number | null;
  mutations: string[];
  abilities: string[];     // ability IDs/names
  xp: number | null;
  targetScale: number | null;
  hunger: number | null;   // hunger % (active, hutch, and inventory pets)
  location: 'active' | 'hutch' | 'inventory';
  slotIndex?: number;      // only for active pets (0-based)
}
