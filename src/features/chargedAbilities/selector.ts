// Reactive per-pet ability-target hub. Recomputes a debounced snapshot on
// pet/garden/position/mount changes and fans out to UI subscribers.

import { getActivePetInfos, onActivePetInfos } from '../../store/pets';
import { onGardenSnapshot } from '../garden/bridge';
import { subscribeAtomValue } from '../../core/atomRegistry';
import { getPlayerPosition } from '../../core/playerContext';
import { getRiddenPetId, onRiddenPetChange } from '../../store/mountState';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { getAbilityProjection } from './abilities';
import { getQualifyingCropsInFootprint, findBestPatchForAbility } from './footprintScan';
import { ABILITY_FOOTPRINT_RADIUS, SELECTOR_RECOMPUTE_DEBOUNCE_MS } from './constants';
import type { PetAbilityTargetSnapshot, OptimalityResult } from './types';
import type { TilePosition } from '../garden/tileRadius';

type Listener = (snapshots: readonly PetAbilityTargetSnapshot[]) => void;

const cleanups: Array<() => void> = [];
const listeners = new Set<Listener>();
let cached: readonly PetAbilityTargetSnapshot[] = [];
let recomputeTimer: number | null = null;
let initialized = false;
let cachedPlayerPos: TilePosition | null = null;

function scheduleRecompute(): void {
  if (recomputeTimer != null) return;
  recomputeTimer = window.setTimeout(() => {
    recomputeTimer = null;
    void recompute();
  }, SELECTOR_RECOMPUTE_DEBOUNCE_MS);
}

async function getPlayerTile(): Promise<TilePosition | null> {
  const pos = await getPlayerPosition();
  return pos ? { x: pos.x, y: pos.y } : null;
}

function summariseSpecies(slots: readonly { species: string }[]): string {
  if (!slots.length) return '';
  const counts = new Map<string, number>();
  for (const s of slots) counts.set(s.species, (counts.get(s.species) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return entries.map(([species, n]) => `${n} ${species}`).join(' + ');
}

async function recompute(): Promise<void> {
  const pets = getActivePetInfos();
  const playerPos = await getPlayerTile();
  cachedPlayerPos = playerPos;
  const ridden = getRiddenPetId();

  const next: PetAbilityTargetSnapshot[] = [];

  for (const pet of pets) {
    if (!pet.chargedAbilityId || !pet.slotId) continue;
    const ability = getAbilityProjection(pet.chargedAbilityId);
    if (!ability) continue;

    const cd = ability.getCooldownRemainingMs(pet.slotId);
    const footprint = playerPos
      ? getQualifyingCropsInFootprint(playerPos, ABILITY_FOOTPRINT_RADIUS, ability)
      : { slots: [], totalGain: { coin: 0, capsule: 0 } };

    const best = findBestPatchForAbility(ability, ABILITY_FOOTPRINT_RADIUS);
    const currentScore = ability.yieldKind === 'coin' ? footprint.totalGain.coin : footprint.totalGain.capsule;
    const bestScore = best
      ? (ability.yieldKind === 'coin' ? best.totalGain.coin : best.totalGain.capsule)
      : currentScore;

    const optimality: OptimalityResult = {
      currentGain: currentScore,
      bestGain: bestScore,
      pct: bestScore > 0 ? Math.min(100, Math.round((currentScore / bestScore) * 100)) : 100,
      bestPatch: best
        ? { center: best.center, slots: best.slots, gain: best.totalGain }
        : null,
    };

    next.push({
      petSlotId: pet.slotId,
      petName: pet.name ?? pet.species ?? 'Pet',
      petSpecies: pet.species ?? '',
      abilityId: pet.chargedAbilityId,
      ability,
      ready: cd <= 0,
      cdRemainingMs: cd,
      qualifyingSlots: footprint.slots,
      qualifyingCount: footprint.slots.length,
      qualifyingSpeciesSummary: summariseSpecies(footprint.slots),
      projectedGain: footprint.totalGain,
      optimality,
      isMounted: ridden === pet.slotId,
    });
  }

  next.sort((a, b) => {
    if (a.isMounted !== b.isMounted) return a.isMounted ? -1 : 1;
    const aRanked = a.ready && a.qualifyingCount > 0;
    const bRanked = b.ready && b.qualifyingCount > 0;
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    if (aRanked && bRanked) {
      const av = a.ability.yieldKind === 'coin' ? a.projectedGain.coin : a.projectedGain.capsule;
      const bv = b.ability.yieldKind === 'coin' ? b.projectedGain.coin : b.projectedGain.capsule;
      return bv - av;
    }
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return a.cdRemainingMs - b.cdRemainingMs;
  });

  cached = next;
  for (const cb of listeners) {
    try { cb(cached); } catch { /* ignore */ }
  }
}

export function startAbilityTargetingSelector(): void {
  if (initialized) return;
  initialized = true;

  cleanups.push(onActivePetInfos(() => scheduleRecompute()));
  cleanups.push(onGardenSnapshot(() => scheduleRecompute()));
  cleanups.push(onRiddenPetChange(() => scheduleRecompute()));

  void subscribeAtomValue('position', () => scheduleRecompute()).then((unsub) => {
    if (unsub) cleanups.push(unsub);
  });

  // 1Hz tick while at least one tracked pet is cooling, so the visible
  // countdown ticks down smoothly even between server atom pushes. The timer
  // pauses when the tab is hidden via timerManager.
  cleanups.push(visibleInterval('charged-abilities-cd', () => {
    if (cached.some((s) => !s.ready)) scheduleRecompute();
  }, 1000));

  scheduleRecompute();
}

export function stopAbilityTargetingSelector(): void {
  if (!initialized) return;
  initialized = false;
  if (recomputeTimer != null) { window.clearTimeout(recomputeTimer); recomputeTimer = null; }
  for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
  cleanups.length = 0;
  listeners.clear();
  cached = [];
  cachedPlayerPos = null;
}

export function subscribeAbilityTargets(cb: Listener): () => void {
  listeners.add(cb);
  try { cb(cached); } catch { /* ignore */ }
  return () => { listeners.delete(cb); };
}

export function getAbilityTargets(): readonly PetAbilityTargetSnapshot[] {
  return cached;
}

export function getCachedPlayerTile(): TilePosition | null {
  return cachedPlayerPos;
}
