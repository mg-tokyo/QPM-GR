// Mutation ETA (ALR-5 spec §3): fruit that can still take a granted mutation over the summed
// granter rate of fed active pets. Day-average rate, live rate until the day cycle parses.

import { getGardenSnapshot, onGardenSnapshot } from './bridge';
import { countActionableFruits, extractTiles } from './gardenTiles';
import { getActivePetInfos, onActivePetInfos, type ActivePetInfo } from '../../store/pets';
import { onWeatherSnapshot } from '../../store/weatherHub';
import { getAbilityDef } from '../../catalogs/gameCatalogs';
import { onMutationRulesChange } from '../../catalogs/logic/mutationRulesCatalog';
import { onDayCycleChange, onDayStageChange } from '../../catalogs/logic/dayCycleCatalog';
import { computeAbilityStats, getAbilityDefinition, getAbilityRateContext } from '../pets/data/petAbilities';
import { isRequiredWeatherActive } from '../pets/abilityWeatherGate';

export interface MutationEtaGranter {
  petId: string | null;
  slotIndex: number;
  abilityId: string;
  procsPerHour: number;
}

export interface MutationEtaEntry {
  mutation: string;
  remaining: number;
  procsPerHour: number;
  etaHours: number | null;   // null while no fed granter runs; 0 when nothing is left
  granters: MutationEtaGranter[];
}

export interface MutationEtaSnapshot {
  computedAt: number;
  entries: MutationEtaEntry[];
}

function grantedMutations(abilityId: string): string[] {
  const raw = getAbilityDef(abilityId)?.baseParameters?.['grantedMutations'];
  return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string' && m.length > 0) : [];
}

// F4: a pet at 0 hunger does not proc. Unknown hunger (null) counts as fed.
function isFed(pet: ActivePetInfo): boolean {
  return !(typeof pet.hungerValue === 'number' && pet.hungerValue <= 0);
}

export function computeMutationEta(
  pets: readonly ActivePetInfo[],
  remainingFor: (mutation: string) => number,
): MutationEtaEntry[] {
  const byMutation = new Map<string, MutationEtaGranter[]>();
  for (const pet of pets) {
    if (!pet.abilities?.length || !isFed(pet)) continue;
    const context = getAbilityRateContext(pet.species);
    for (const raw of pet.abilities) {
      if (!raw) continue;
      const def = getAbilityDefinition(raw);
      if (!def || def.trigger !== 'continuous' || (def.baseProbability ?? 0) <= 0) continue;
      if (!isRequiredWeatherActive(def.requiredWeather ?? null)) continue;
      const mutations = grantedMutations(def.id);
      if (mutations.length === 0) continue;
      const stats = computeAbilityStats(def, pet.strength, context);
      const procsPerHour = stats.dayAverage?.procsPerHour ?? stats.procsPerHour;
      for (const mutation of mutations) {
        const list = byMutation.get(mutation) ?? [];
        list.push({ petId: pet.petId, slotIndex: pet.slotIndex, abilityId: def.id, procsPerHour });
        byMutation.set(mutation, list);
      }
    }
  }

  const entries: MutationEtaEntry[] = [];
  for (const [mutation, granters] of byMutation) {
    const procsPerHour = granters.reduce((sum, g) => sum + g.procsPerHour, 0);
    const remaining = remainingFor(mutation);
    const etaHours = remaining === 0 ? 0 : procsPerHour > 0 ? remaining / procsPerHour : null;
    entries.push({ mutation, remaining, procsPerHour, etaHours, granters });
  }
  return entries;
}

const EMPTY: MutationEtaSnapshot = { computedAt: 0, entries: [] };
const listeners = new Set<(snapshot: MutationEtaSnapshot) => void>();
let cleanups: Array<() => void> = [];
let running = false;
let scheduled = false;
let latest: MutationEtaSnapshot = EMPTY;

function recompute(): void {
  const tiles = extractTiles(getGardenSnapshot());
  latest = {
    computedAt: Date.now(),
    entries: computeMutationEta(getActivePetInfos(), (m) => countActionableFruits(tiles, [m])),
  };
  for (const cb of listeners) {
    try { cb(latest); } catch { /* one bad listener must not stop the rest */ }
  }
}

function schedule(): void {
  if (!running || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (running) recompute();
  });
}

export function startMutationEta(): void {
  if (running) return;
  running = true;
  cleanups = [
    onGardenSnapshot(schedule, false),
    onActivePetInfos(schedule, false),
    onWeatherSnapshot(schedule, false),
    onMutationRulesChange(schedule),
    onDayCycleChange(schedule),
    onDayStageChange(schedule),
  ];
  schedule();
}

export function stopMutationEta(): void {
  if (!running) return;
  running = false;
  for (const off of cleanups.splice(0)) off();
  latest = EMPTY;
}

export function subscribeMutationEta(cb: (snapshot: MutationEtaSnapshot) => void, fireImmediately = true): () => void {
  listeners.add(cb);
  if (fireImmediately && running) cb(latest);
  return () => { listeners.delete(cb); };
}

export function getMutationEtaSnapshot(): MutationEtaSnapshot {
  return latest;
}
