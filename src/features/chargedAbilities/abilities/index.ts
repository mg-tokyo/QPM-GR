import type { AbilityProjection } from './types';
import { deriveAllChargedAbilityProjections } from './derive';
import { onPetAbilitiesCaptured, onCatalogsReady } from '../../../catalogs/gameCatalogs';
import { onChargedAbilityRulesChange } from '../../../catalogs/logic/chargedAbilityRulesCatalog';

export { areChargedAbilityRulesUnreadable } from '../../../catalogs/logic/chargedAbilityRulesCatalog';

let cache: readonly AbilityProjection[] = [];
let cacheDirty = true;
const cleanups: Array<() => void> = [];
const rebuildListeners = new Set<() => void>();

function rebuild(): void {
  cache = deriveAllChargedAbilityProjections();
  cacheDirty = false;
  for (const cb of rebuildListeners) {
    try { cb(); } catch { /* one listener must not stop the others */ }
  }
}

/** Fires after the cache is rebuilt from a fresh catalog or a rules load, so listeners read the new projections. */
export function onAbilityProjectionsRebuilt(cb: () => void): () => void {
  rebuildListeners.add(cb);
  return () => { rebuildListeners.delete(cb); };
}

function ensureFresh(): void {
  if (cacheDirty) rebuild();
}

export function startChargedAbilityProjections(): void {
  if (cleanups.length > 0) return;
  cleanups.push(onPetAbilitiesCaptured(() => { cacheDirty = true; rebuild(); }));
  cleanups.push(onCatalogsReady(() => { cacheDirty = true; rebuild(); }));
  cleanups.push(onChargedAbilityRulesChange(() => { cacheDirty = true; rebuild(); }));
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
