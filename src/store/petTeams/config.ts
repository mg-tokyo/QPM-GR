import { storage, getStorageRuntime } from '../../utils/storage';
import { log } from '../../utils/logger';
import { getActivePetInfos, onActivePetInfos } from '../pets';
import { onInventoryChange } from '../inventory';
import type { PetTeam, PetTeamsConfig, PetFeedPolicy } from '../../types/petTeams';
import {
  store,
  CONFIG_KEY,
  FEED_POLICY_KEY,
  createDefaultConfig,
  createDefaultFeedPolicy,
  saveConfig,
  notifyConfigListeners,
  resolveCurrentPlayerId,
  resolvePlayerKeyAndMigrate,
} from './state';
import { getAllPooledPetsWithStatus } from './pool';

export function initPetTeamsStore(): void {
  const rawLoaded = storage.get<PetTeamsConfig | null>(store.resolvedConfigKey, null);
  store.config = rawLoaded ?? createDefaultConfig();
  log(`[PetTeams:Init] key=${store.resolvedConfigKey} runtime=${getStorageRuntime()} loaded=${rawLoaded ? 'yes' : 'null'} teams=${store.config.teams.length}`);
  if (!Array.isArray(store.config.teams)) store.config.teams = [];
  if (typeof store.config.keybinds !== 'object' || store.config.keybinds === null) store.config.keybinds = {};
  if (store.config.activeTeamId === undefined) store.config.activeTeamId = null;
  if (typeof store.config.lastAppliedAt !== 'number') store.config.lastAppliedAt = 0;
  let teamsNormalized = false;
  for (const team of store.config.teams) {
    const rawSlots = Array.isArray(team.slots) ? team.slots : [];
    const normalizedSlots: [string | null, string | null, string | null] = [
      typeof rawSlots[0] === 'string' ? rawSlots[0] : null,
      typeof rawSlots[1] === 'string' ? rawSlots[1] : null,
      typeof rawSlots[2] === 'string' ? rawSlots[2] : null,
    ];
    if (
      !Array.isArray(team.slots) ||
      team.slots.length !== 3 ||
      team.slots[0] !== normalizedSlots[0] ||
      team.slots[1] !== normalizedSlots[1] ||
      team.slots[2] !== normalizedSlots[2]
    ) {
      team.slots = normalizedSlots;
      teamsNormalized = true;
    }
  }

  // Keybind migration: combo -> teamIndex (legacy) to combo -> teamId (current).
  // Also prune bindings that point to missing teams.
  const migratedKeybinds: Record<string, string> = {};
  let keybindsChanged = false;
  for (const [combo, target] of Object.entries(store.config.keybinds as Record<string, unknown>)) {
    if (typeof target === 'string') {
      const exists = store.config.teams.some((team) => team.id === target);
      if (exists) {
        migratedKeybinds[combo.toLowerCase()] = target;
      } else {
        keybindsChanged = true;
      }
      continue;
    }
    if (typeof target === 'number' && Number.isInteger(target) && target >= 0) {
      const migratedTeamId = store.config.teams[target]?.id ?? null;
      if (migratedTeamId) {
        migratedKeybinds[combo.toLowerCase()] = migratedTeamId;
      }
      keybindsChanged = true;
      continue;
    }
    keybindsChanged = true;
  }
  if (keybindsChanged || Object.keys(migratedKeybinds).length !== Object.keys(store.config.keybinds).length) {
    store.config.keybinds = migratedKeybinds;
    storage.set(store.resolvedConfigKey, store.config);
  } else if (teamsNormalized) {
    storage.set(store.resolvedConfigKey, store.config);
  }

  store.feedPolicy = storage.get<PetFeedPolicy | null>(store.resolvedFeedKey, null) ?? createDefaultFeedPolicy();
  if (typeof store.feedPolicy.petItemOverrides !== 'object' || store.feedPolicy.petItemOverrides === null) {
    store.feedPolicy.petItemOverrides = {};
  }

  store.activePetsUnsubscribe = onActivePetInfos(() => {
    const detectedId = detectCurrentTeam();
    if (detectedId !== store.config.activeTeamId) {
      store.config.activeTeamId = detectedId;
      notifyConfigListeners();
    }
  });

  // Debounced purge of stale pet refs; gated on purgeReady so it never fires before the player-scoped config resolves.
  function schedulePurge(): void {
    if (store.purgeTimer) clearTimeout(store.purgeTimer);
    store.purgeTimer = setTimeout(async () => {
      store.purgeTimer = null;
      if (!store.purgeReady) {
        return;
      }
      if (store.applyInProgress) {
        log('[PetTeams] Skipping purge — apply in progress');
        return;
      }
      try {
        const { pool, complete } = await getAllPooledPetsWithStatus();
        if (!complete) {
          log('[PetTeams] Skipping purge — atom data incomplete');
          return;
        }
        if (!store.hutchEverLoaded) {
          log('[PetTeams] Skipping purge — hutch data never loaded');
          return;
        }
        const validIds = new Set(pool.map(p => p.id));
        const currentId = await resolveCurrentPlayerId();
        if (store.initPlayerId !== null && currentId !== null && currentId !== store.initPlayerId) {
          log('[PetTeams] Skipping purge — account change detected');
          return;
        }
        // Allow small purges (1-2 pets) unconditionally; block large purges when pool coverage is low (indicates stale atom data, not real sells).
        const referencedIds = new Set<string>();
        for (const team of store.config.teams) {
          for (const s of team.slots) {
            if (s) referencedIds.add(s);
          }
        }
        if (referencedIds.size > 0) {
          let matched = 0;
          for (const id of referencedIds) {
            if (validIds.has(id)) matched++;
          }
          const wouldPurge = referencedIds.size - matched;
          if (wouldPurge > 2 && matched <= referencedIds.size * 0.5) {
            log(`[PetTeams] Skipping purge — pool covers ${matched}/${referencedIds.size} referenced pets, ${wouldPurge} would be cleared`);
            return;
          }
        }
        purgeGonePets(validIds);
      } catch { /* ignore */ }
    }, 3000);
  }
  store.purgeUnsubscribe = onActivePetInfos(() => schedulePurge(), false);
  store.purgeInvUnsubscribe = onInventoryChange(() => schedulePurge(), false);

  log(`[PetTeams] Store initialized - ${store.config.teams.length} teams`);
  resolvePlayerKeyAndMigrate()
    .catch(err => log('[PetTeams] Key resolution failed', err))
    .finally(() => {
      store.purgeReady = true;
      schedulePurge();
    });
}

export function stopPetTeamsStore(): void {
  store.activePetsUnsubscribe?.();
  store.activePetsUnsubscribe = null;
  store.purgeUnsubscribe?.();
  store.purgeUnsubscribe = null;
  store.purgeInvUnsubscribe?.();
  store.purgeInvUnsubscribe = null;
  if (store.purgeTimer) { clearTimeout(store.purgeTimer); store.purgeTimer = null; }
  store.configListeners.clear();
  store.resolvedConfigKey = CONFIG_KEY;
  store.resolvedFeedKey = FEED_POLICY_KEY;
  store.initPlayerId = null;
  store.hutchEverLoaded = false;
  store.applyInProgress = false;
  store.purgeReady = false;
}

export function getTeamsConfig(): PetTeamsConfig {
  return {
    ...store.config,
    teams: store.config.teams.map(t => ({ ...t, slots: [...t.slots] as PetTeam['slots'] })),
    keybinds: { ...store.config.keybinds },
  };
}

export function getTeamById(id: string): PetTeam | null {
  const team = store.config.teams.find(t => t.id === id);
  if (!team) return null;
  return { ...team, slots: [...team.slots] as PetTeam['slots'] };
}

export function onTeamsChange(cb: (config: PetTeamsConfig) => void): () => void {
  store.configListeners.add(cb);
  return () => store.configListeners.delete(cb);
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTeam(name: string): PetTeam {
  const team: PetTeam = {
    id: generateId(),
    name: name.trim() || `Team ${store.config.teams.length + 1}`,
    slots: [null, null, null],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const countBefore = store.config.teams.length;
  store.config.teams.push(team);
  log(`[PetTeams:Create] "${team.name}" id=${team.id} teamsBefore=${countBefore} teamsAfter=${store.config.teams.length}`);
  saveConfig();
  return team;
}

export function renameTeam(id: string, name: string): void {
  const team = store.config.teams.find(t => t.id === id);
  if (!team) return;
  team.name = name.trim() || team.name;
  team.updatedAt = Date.now();
  saveConfig();
}

export function deleteTeam(id: string): void {
  store.config.teams = store.config.teams.filter(t => t.id !== id);
  if (store.config.activeTeamId === id) store.config.activeTeamId = null;
  for (const [key, teamId] of Object.entries(store.config.keybinds)) {
    if (teamId === id) {
      delete store.config.keybinds[key];
    }
  }
  saveConfig();
}

export function reorderTeams(fromIndex: number, toIndex: number): void {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= store.config.teams.length || toIndex >= store.config.teams.length) return;
  const [moved] = store.config.teams.splice(fromIndex, 1);
  if (!moved) return;
  // After the splice, indices >= fromIndex shifted left by 1 — adjust when moving down.
  const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
  store.config.teams.splice(adjustedTo, 0, moved);
  saveConfig();
}

export function saveCurrentTeamSlots(teamId: string): void {
  const team = store.config.teams.find(t => t.id === teamId);
  if (!team) return;
  const active = getActivePetInfos();
  const newSlots: [string | null, string | null, string | null] = [null, null, null];
  for (let i = 0; i < 3; i++) {
    newSlots[i] = active[i]?.slotId ?? null;
  }
  team.slots = newSlots;
  team.updatedAt = Date.now();
  saveConfig();
}

export function setTeamSlot(teamId: string, slotIndex: 0 | 1 | 2, petItemId: string | null): void {
  const team = store.config.teams.find(t => t.id === teamId);
  if (!team) return;
  team.slots[slotIndex] = petItemId;
  team.updatedAt = Date.now();
  saveConfig();
}

export function clearTeamSlot(teamId: string, slotIndex: 0 | 1 | 2): void {
  setTeamSlot(teamId, slotIndex, null);
}

export function purgeGonePets(validIds: Set<string>): number {
  let cleared = 0;
  const details: string[] = [];
  for (const team of store.config.teams) {
    for (let i = 0; i < 3; i++) {
      const slotId = team.slots[i];
      if (slotId && !validIds.has(slotId)) {
        details.push(`"${team.name}"[${i}]=${slotId}`);
        team.slots[i] = null;
        cleared++;
      }
    }
  }
  if (cleared > 0) {
    log(`[PetTeams:Purge] Cleared ${cleared} slot(s): ${details.join(', ')} (pool size=${validIds.size})`);
    saveConfig();
  }
  return cleared;
}

export function detectCurrentTeam(): string | null {
  const activePets = getActivePetInfos();
  const activeSet = new Set(activePets.map(p => p.slotId).filter((id): id is string => id !== null));
  if (activeSet.size === 0) return null;

  for (const team of store.config.teams) {
    const teamSet = new Set(team.slots.filter((s): s is string => s !== null));
    if (teamSet.size === 0) continue;
    if ([...teamSet].every(id => activeSet.has(id))) {
      return team.id;
    }
  }
  return null;
}

export function setKeybind(key: string, teamId: string): void {
  const normalized = key.toLowerCase();
  if (!store.config.teams.some((team) => team.id === teamId)) return;
  store.config.keybinds[normalized] = teamId;
  saveConfig();
}

export function clearKeybind(key: string): void {
  delete store.config.keybinds[key.toLowerCase()];
  saveConfig();
}

export function getKeybinds(): Record<string, string> {
  return { ...store.config.keybinds };
}
