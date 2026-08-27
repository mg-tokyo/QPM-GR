// Pure — imported by scripts/check-pet-activity.mjs under node. Catalog lookups arrive via EnrichDeps.
import type { NormalizedServerEntry } from './normalize';
import type { PetActivityEvent, PetSnap, TargetSnap } from './types';

export interface EnrichDeps {
  strOf(pet: PetSnap): { str: number | null; maxStr: number | null; level: number | null };
  cropCoinValue(species: string, scale: number, mutations: string[]): number;
  hungerMax(species: string): number | null;
  potionXp(toolId: string): number;
  levelAt(species: string, xp: number): number | null;
  gardenSlots(): TargetSnap[];
}

export const CLUSTER_LIMIT = 4;

export function pickCluster(slots: TargetSnap[], limit = CLUSTER_LIMIT): TargetSnap[] {
  const score = (t: TargetSnap): number =>
    t.kind === 'growSlot' ? t.targetScale + t.mutations.length * 0.5 : t.kind === 'crop' ? t.scale + t.mutations.length * 0.5 : 0;
  return [...slots].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

function withStr(pet: PetSnap, deps: EnrichDeps): PetSnap {
  return { ...pet, ...deps.strOf(pet) };
}

export function enrichPure(entry: NormalizedServerEntry, deps: EnrichDeps): PetActivityEvent {
  const e = entry.event;
  const pet = withStr(e.pet, deps);
  const targets = e.targets.map((t) => (t.kind === 'pet' ? { kind: 'pet' as const, pet: withStr(t.pet, deps) } : t));
  const values = { ...e.values };
  const out: PetActivityEvent = { ...e, pet, targets, values };

  // Hunger % mirrors floatingCard/card.ts computeSelectedGainPct: coin value ÷ hungerMax per crop.
  if (e.kind === 'feed') {
    const max = deps.hungerMax(pet.species);
    if (max && max > 0) {
      let pct = 0;
      for (const t of targets) if (t.kind === 'crop') pct += Math.round((deps.cropCoinValue(t.species, t.scale, t.mutations) / max) * 100);
      values.hungerPct = Math.min(100, pct);
    }
  }
  if (e.kind === 'potion' && e.action === 'xpPotion') {
    const gained = deps.potionXp('XPPotion');
    const after = deps.levelAt(pet.species, pet.xp);
    const before = deps.levelAt(pet.species, Math.max(0, pet.xp - gained));
    if (after != null) values.levelAfter = after;
    if (before != null) values.levelBefore = before;
    values.xpGained = gained;
  }
  if (typeof values.numPlantsAffected === 'number') {
    const cluster = pickCluster(deps.gardenSlots());
    if (cluster.length) { out.cluster = cluster; out.clusterTotal = values.numPlantsAffected; }
  }
  return out;
}
