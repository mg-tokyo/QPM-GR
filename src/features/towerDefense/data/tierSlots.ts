import type { TowerId, UpgradeTier } from '../types';
import type { SpriteRef } from './towerDefs';
import { getTowerDef } from './towerDefs';

export type UpgradeSlot =
  | 'base'
  | 't2a' | 't2b' | 't2a2b'
  | 't3a' | 't3a2b'
  | 't3b' | 't3b2a'
  | 't4a' | 't4a2b'
  | 't4b' | 't4b2a';

const ALL_SLOTS: readonly UpgradeSlot[] = [
  'base',
  't2a', 't2b', 't2a2b',
  't3a', 't3a2b',
  't3b', 't3b2a',
  't4a', 't4a2b',
  't4b', 't4b2a',
];

// Every tower supports every crosspath slot. The bindings/preset system fills
// in what art exists per (kind, slot); anything unbound falls back to the tower
// baseSprite via getTierSlotSprite below.
export const TIER_SLOTS: Readonly<Record<TowerId, readonly UpgradeSlot[]>> = {
  sproutSlinger:   ALL_SLOTS,
  witchsCauldron:  ALL_SLOTS,
  frostWizard:     ALL_SLOTS,
  marbleKnight:    ALL_SLOTS,
  strawScarecrow:  ALL_SLOTS,
  bananaGrove:     ALL_SLOTS,
  owlPerch:        ALL_SLOTS,
  gnomeAlchemist:  ALL_SLOTS,
};

// (upgA, upgB) → slot. T1 collapses to base (no art distinction). Higher-tier
// path wins the pure slot name; when both paths have tier ≥ 2 we emit the
// combined slot for the higher path (e.g. (3,2) → t3a2b, (2,4) → t4b2a).
export function resolveUpgradeSlot(upgA: UpgradeTier, upgB: UpgradeTier): UpgradeSlot {
  const a = upgA >= 2 ? upgA : 0;
  const b = upgB >= 2 ? upgB : 0;
  if (a >= 4) return b >= 2 ? 't4a2b' : 't4a';
  if (b >= 4) return a >= 2 ? 't4b2a' : 't4b';
  if (a >= 3) return b >= 2 ? 't3a2b' : 't3a';
  if (b >= 3) return a >= 2 ? 't3b2a' : 't3b';
  if (a >= 2 && b >= 2) return 't2a2b';
  if (a >= 2) return 't2a';
  if (b >= 2) return 't2b';
  return 'base';
}

// Hardcoded vanilla-sprite overrides for specific (kind, slot) combos. Anything
// not listed here falls back to baseSprite — preset/user-bound designs are then
// resolved separately by the customDesigns store.
export function getTierSlotSprite(kind: TowerId, slot: UpgradeSlot): SpriteRef {
  if (slot === 't3a') {
    if (kind === 'sproutSlinger') return { kind: 'plant', key: 'Pumpkin' };
    if (kind === 'bananaGrove') return { kind: 'plant', key: 'DragonFruit' };
    if (kind === 'gnomeAlchemist') return { kind: 'decor', key: 'sprite/decor/StoneGnomess' };
  }
  if (slot === 't3b' && kind === 'sproutSlinger') return { kind: 'plant', key: 'Sunflower' };
  return getTowerDef(kind).baseSprite;
}

// Per-slot scale multiplier stacked on top of a tower's own `renderScale`.
// The visual "tier bump" tracks the higher upgrade path so a T4A2B tower reads
// the same size as a T4A. Adjust here to tune the curve globally.
const TIER_SCALE_MULT: Readonly<Record<UpgradeSlot, number>> = {
  base:   1.00,
  t2a:    1.00,
  t2b:    1.00,
  t2a2b:  1.00,
  t3a:    1.15,
  t3a2b:  1.15,
  t3b:    1.15,
  t3b2a:  1.15,
  t4a:    1.30,
  t4a2b:  1.30,
  t4b:    1.30,
  t4b2a:  1.30,
};

export function getEffectiveRenderScale(
  kind: TowerId,
  upgA: UpgradeTier,
  upgB: UpgradeTier,
): number {
  const base = getTowerDef(kind).renderScale ?? 1;
  const slot = resolveUpgradeSlot(upgA, upgB);
  return base * TIER_SCALE_MULT[slot];
}
