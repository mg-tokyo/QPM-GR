import type { AbilityProjection } from './types';
import { deriveAllChargedAbilityProjections } from './derive';
import { onPetAbilitiesCaptured, onCatalogsReady } from '../../../catalogs/gameCatalogs';

let cache: readonly AbilityProjection[] = [];
let cacheDirty = true;
const cleanups: Array<() => void> = [];

function rebuild(): void {
  cache = deriveAllChargedAbilityProjections();
  cacheDirty = false;
}

function ensureFresh(): void {
  if (cacheDirty) rebuild();
}

export function startChargedAbilityProjections(): void {
  if (cleanups.length > 0) return;
  cleanups.push(onPetAbilitiesCaptured(() => { cacheDirty = true; rebuild(); }));
  cleanups.push(onCatalogsReady(() => { cacheDirty = true; rebuild(); }));
  rebuild();
}

export function stopChargedAbilityProjections(): void {
  for (const fn of cleanups) { try { fn(); } catch { /* teardown best-effort */ } }
  cleanups.length = 0;
  cache = [];
  cacheDirty = true;
}

export function getAbilityProjection(abilityId: string): AbilityProjection | null {
  ensureFresh();
  for (const p of cache) if (p.abilityId === abilityId) return p;
  return null;
}

export function getAllAbilityProjections(): readonly AbilityProjection[] {
  ensureFresh();
  return cache;
}

export type { AbilityProjection, PlantSlotMinimal, ProjectedGain } from './types';
