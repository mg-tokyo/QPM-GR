// src/store/petXpTracker.ts
// Observes pet XP/level changes to build species-specific progression tables.

import { startPetInfoStore, onActivePetInfos, type ActivePetInfo } from './pets';
import { storage } from '../utils/storage';
import { log } from '../utils/logger';
import { debounce } from '../utils/scheduling/debounce';
import { normalizeSpeciesKey } from '../utils/helpers';

const STORAGE_KEY = 'qpm.petXpObservations.v1';
const STORAGE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 2500;

export type PetXpObservationSource = 'snapshot' | 'level-up';

export interface PetXpObservation {
  level: number;
  xp: number;
  strength: number | null;
  samples: number;
  lastObservedAt: number;
  source: PetXpObservationSource;
}

export interface PetXpSpeciesSnapshot {
  key: string;
  displayName: string;
  lastUpdated: number;
  levels: PetXpObservation[];
}

interface PersistedObservation {
  level: number;
  xp: number;
  strength: number | null;
  samples: number;
  lastObservedAt: number;
  source: PetXpObservationSource;
}

interface PersistedSpeciesTable {
  key: string;
  displayName: string;
  lastUpdated: number;
  levels: PersistedObservation[];
}

interface PersistedPayload {
  version: number;
  savedAt: number;
  species: PersistedSpeciesTable[];
}

interface SlotSnapshot {
  species: string | null;
  level: number | null;
  xp: number | null;
  strength: number | null;
}

const snapshots = new Map<string, SlotSnapshot>();
const speciesDisplayNames = new Map<string, string>();
const speciesLastUpdated = new Map<string, number>();
const tables = new Map<string, Map<number, PetXpObservation>>();

let initialized = false;
let unsubscribe: (() => void) | null = null;

const scheduleSave = debounce(() => {
  try {
    storage.set(STORAGE_KEY, serializeSnapshot());
  } catch (error) {
    log('⚠️ Failed to persist pet XP observations', error);
  }
}, SAVE_DEBOUNCE_MS);

function serializeSnapshot(): PersistedPayload {
  const species: PersistedSpeciesTable[] = [];
  for (const [key, table] of tables) {
    const levels = Array.from(table.values())
      .sort((a, b) => a.level - b.level)
      .map((entry) => ({ ...entry }));
    species.push({
      key,
      displayName: speciesDisplayNames.get(key) ?? key,
      lastUpdated: speciesLastUpdated.get(key) ?? 0,
      levels,
    });
  }

  return {
    version: STORAGE_VERSION,
    savedAt: Date.now(),
    species,
  };
}

function restoreSnapshot(payload: PersistedPayload | null | undefined): void {
  if (!payload || payload.version !== STORAGE_VERSION) {
    return;
  }
  tables.clear();
  speciesDisplayNames.clear();
  speciesLastUpdated.clear();

  payload.species.forEach((entry) => {
    const levelMap = new Map<number, PetXpObservation>();
    entry.levels.forEach((levelInfo) => {
      const level = Math.max(0, Math.round(levelInfo.level));
      const xp = Number.isFinite(levelInfo.xp) ? Math.max(0, Math.round(levelInfo.xp)) : null;
      if (xp == null) {
        return;
      }
      levelMap.set(level, {
        level,
        xp,
        strength: levelInfo.strength ?? null,
        samples: Math.max(1, Math.round(levelInfo.samples ?? 1)),
        lastObservedAt: levelInfo.lastObservedAt ?? 0,
        source: levelInfo.source === 'level-up' ? 'level-up' : 'snapshot',
      });
    });
    if (levelMap.size === 0) {
      return;
    }
    tables.set(entry.key, levelMap);
    speciesDisplayNames.set(entry.key, entry.displayName ?? entry.key);
    speciesLastUpdated.set(entry.key, entry.lastUpdated ?? Date.now());
  });
}

function ensureSpeciesTable(key: string): Map<number, PetXpObservation> {
  if (!tables.has(key)) {
    tables.set(key, new Map());
  }
  return tables.get(key)!;
}

function recordObservation(
  rawSpecies: string,
  level: number,
  xp: number,
  strength: number | null,
  source: PetXpObservationSource,
  observedAt: number,
): void {
  const speciesKey = normalizeSpeciesKey(rawSpecies);
  if (!speciesKey) {
    return;
  }

  const normalizedLevel = Math.max(0, Math.round(level));
  if (!Number.isFinite(normalizedLevel)) {
    return;
  }

  const normalizedXp = Math.max(0, Math.round(xp));
  if (!Number.isFinite(normalizedXp)) {
    return;
  }

  const table = ensureSpeciesTable(speciesKey);
  const existing = table.get(normalizedLevel);

  if (!existing) {
    table.set(normalizedLevel, {
      level: normalizedLevel,
      xp: normalizedXp,
      strength: strength ?? null,
      samples: 1,
      lastObservedAt: observedAt,
      source,
    });
  } else {
    const shouldReplace =
      normalizedXp > existing.xp ||
      (normalizedXp === existing.xp && source === 'level-up' && existing.source !== 'level-up');

    if (shouldReplace) {
      existing.xp = normalizedXp;
      existing.strength = strength ?? existing.strength ?? null;
      existing.source = source;
    }

    existing.samples += 1;
    existing.lastObservedAt = observedAt;
  }

  speciesDisplayNames.set(speciesKey, rawSpecies);
  speciesLastUpdated.set(speciesKey, observedAt);
  scheduleSave();
}

function snapshotKey(info: ActivePetInfo, fallbackIndex: number): string {
  if (info.slotId && info.slotId.trim().length > 0) {
    return `slot:${info.slotId}`;
  }
  if (info.petId && info.petId.trim().length > 0) {
    return `pet:${info.petId}`;
  }
  return `index:${fallbackIndex}`;
}

function handlePetInfoUpdate(infos: ActivePetInfo[]): void {
  const now = Date.now();
  const seenKeys = new Set<string>();

  infos.forEach((info, index) => {
    const key = snapshotKey(info, index);
    seenKeys.add(key);
    const previous = snapshots.get(key);

    const species = info.species ?? previous?.species ?? null;
    const level = typeof info.level === 'number' && Number.isFinite(info.level) ? info.level : null;
    const xp = typeof info.xp === 'number' && Number.isFinite(info.xp) ? info.xp : null;
    const strength = typeof info.strength === 'number' && Number.isFinite(info.strength) ? info.strength : null;

    if (previous && species && previous.species === species) {
      const prevLevel = previous.level;
      const prevXp = previous.xp;
      const prevStrength = previous.strength;

      if (
        prevLevel != null &&
        level != null &&
        level > prevLevel &&
        prevXp != null &&
        prevXp > 0
      ) {
        recordObservation(species, prevLevel, prevXp, prevStrength, 'level-up', now);
      }
    }

    if (species && level != null && xp != null) {
      const prevXp = previous?.xp;
      const prevLevel = previous?.level;
      const xpChanged = prevXp == null || Math.round(prevXp) !== Math.round(xp);
      const levelChanged = prevLevel == null || prevLevel !== level;

      if (xpChanged || levelChanged) {
        recordObservation(species, level, xp, strength, 'snapshot', now);
      }
    }

    snapshots.set(key, {
      species,
      level,
      xp,
      strength,
    });
  });

  // Drop stale entries to avoid unbounded growth.
  for (const key of snapshots.keys()) {
    if (!seenKeys.has(key)) {
      snapshots.delete(key);
    }
  }
}

export interface PetXpEstimate {
  value: number;
  level: number;
  confidence: PetXpObservationSource;
  samples: number;
  observedAt: number;
  displayName: string;
}

function pickBestObservation(observations: PetXpObservation[]): PetXpObservation | null {
  if (observations.length === 0) {
    return null;
  }
  const preferred = observations.filter((obs) => obs.source === 'level-up');
  const pool = preferred.length > 0 ? preferred : observations;
  const sorted = [...pool].sort((a, b) => b.xp - a.xp || b.lastObservedAt - a.lastObservedAt);
  return sorted[0] ?? null;
}

export function estimatePetXpTarget(
  species: string | null,
  level: number | null,
  mode: 'nextLevel' | 'maxLevel',
): PetXpEstimate | null {
  if (!species) {
    return null;
  }
  const speciesKey = normalizeSpeciesKey(species);
  if (!speciesKey) {
    return null;
  }
  const table = tables.get(speciesKey);
  if (!table || table.size === 0) {
    return null;
  }

  const displayName = speciesDisplayNames.get(speciesKey) ?? species;
  const observations = Array.from(table.values()).sort((a, b) => a.level - b.level);

  if (level == null || !Number.isFinite(level)) {
    const best = pickBestObservation(observations);
    if (!best) {
      return null;
    }
    return {
      value: best.xp,
      level: best.level,
      confidence: best.source,
      samples: best.samples,
      observedAt: best.lastObservedAt,
      displayName,
    };
  }

  const normalizedLevel = Math.max(0, Math.round(level));

  if (mode === 'nextLevel') {
    const entry = table.get(normalizedLevel);
    if (!entry) {
      return null;
    }
    return {
      value: entry.xp,
      level: entry.level,
      confidence: entry.source,
      samples: entry.samples,
      observedAt: entry.lastObservedAt,
      displayName,
    };
  }

  const eligible = observations.filter((obs) => obs.level >= normalizedLevel);
  const best = pickBestObservation(eligible.length > 0 ? eligible : observations);
  if (!best) {
    return null;
  }

  return {
    value: best.xp,
    level: best.level,
    confidence: best.source,
    samples: best.samples,
    observedAt: best.lastObservedAt,
    displayName,
  };
}

export function getPetXpSnapshots(): PetXpSpeciesSnapshot[] {
  const species: PetXpSpeciesSnapshot[] = [];
  for (const [key, table] of tables) {
    const levels = Array.from(table.values()).sort((a, b) => a.level - b.level);
    species.push({
      key,
      displayName: speciesDisplayNames.get(key) ?? key,
      lastUpdated: speciesLastUpdated.get(key) ?? 0,
      levels,
    });
  }
  return species.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function exportPetXpSnapshot(): PersistedPayload {
  return serializeSnapshot();
}

export function clearPetXpSnapshots(): void {
  tables.clear();
  speciesDisplayNames.clear();
  speciesLastUpdated.clear();
  storage.set(STORAGE_KEY, serializeSnapshot());
}

export function initializePetXpTracker(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    const persisted = storage.get<PersistedPayload | null>(STORAGE_KEY, null);
    restoreSnapshot(persisted ?? null);
  } catch (error) {
    log('⚠️ Failed to restore pet XP observations', error);
  }

  void startPetInfoStore();
  unsubscribe = onActivePetInfos(handlePetInfoUpdate);
}

export function disposePetXpTracker(): void {
  unsubscribe?.();
  unsubscribe = null;
  initialized = false;
}
