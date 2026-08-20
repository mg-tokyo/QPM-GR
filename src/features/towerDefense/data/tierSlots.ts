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
  stormLantern:    ALL_SLOTS,
  fairyForge:      ALL_SLOTS,
  pineconeGrove:   ALL_SLOTS,
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
  if (kind === 'stormLantern') return stormLanternSprite(slot);
  if (kind === 'gnomeAlchemist') return gnomeAlchemistSprite(slot);
  if (kind === 'owlPerch') return owlPerchSprite(slot);
  if (kind === 'fairyForge') return fairyForgeSprite(slot);
  if (slot === 't3a') {
    if (kind === 'sproutSlinger') return { kind: 'plant', key: 'Pumpkin' };
    if (kind === 'bananaGrove') return { kind: 'plant', key: 'DragonFruit' };
  }
  if (slot === 't3b' && kind === 'sproutSlinger') return { kind: 'plant', key: 'Sunflower' };
  return getTowerDef(kind).baseSprite;
}

function stormLanternSprite(slot: UpgradeSlot): SpriteRef {
  if (slot.startsWith('t4')) return { kind: 'decor', key: 'sprite/decor/MarbleLampPost' };
  if (slot.startsWith('t3')) return { kind: 'decor', key: 'sprite/decor/StoneLampPost' };
  return getTowerDef('stormLantern').baseSprite;
}

// Path A already swaps the base sprite to StoneGnomess at t3a in the previous
// design; extend the swap to every slot from t2b onward so the pair reads as
// the aura/elder progression. Overlays: Amberlit at t3-tier for the alchemy
// aesthetic; charged/dawn variants for t4; Rainbow lives on the crosspath
// max (t4b2a) — the "fully invested Cosmic Sage" slot that requires paying
// through the t3 lock on both sides.
function gnomeAlchemistSprite(slot: UpgradeSlot): SpriteRef {
  const GNOME = 'sprite/decor/StoneGnome';
  const GNOMESS = 'sprite/decor/StoneGnomess';
  switch (slot) {
    case 'base':
    case 't2a':
      return { kind: 'decor', key: GNOME };
    case 't2b':
    case 't2a2b':
    case 't3b':
      return { kind: 'decor', key: GNOMESS };
    case 't3a':
    case 't3a2b':
    case 't3b2a':
      return { kind: 'decor', key: GNOMESS, mutations: ['Amberlit'] };
    case 't4a':
      return { kind: 'decor', key: GNOMESS, mutations: ['Ambercharged'] };
    case 't4a2b':
      return { kind: 'decor', key: GNOMESS, mutations: ['Dawncharged'] };
    case 't4b':
      return { kind: 'decor', key: GNOMESS, mutations: ['Dawnlit'] };
    case 't4b2a':
      return { kind: 'decor', key: GNOMESS, mutations: ['Rainbow'] };
  }
}

// Only one owl atlas key exists, so all progression is mutation overlays.
// t3a Night Hunter → Thunderstruck; t3b Eagle Talons → Gold; t4 mirrors the
// upgrade flavour (Frozen for Moonlit Terror, Amberlit for Phoenix Owl) and
// Rainbow lives on t4a2b — the "moonlit terror + phoenix damage" crosspath.
function owlPerchSprite(slot: UpgradeSlot): SpriteRef {
  const OWL = 'sprite/decor/WoodOwl';
  switch (slot) {
    case 'base':
    case 't2a':
    case 't2b':
    case 't2a2b':
      return { kind: 'decor', key: OWL };
    case 't3a':
    case 't3a2b':
      return { kind: 'decor', key: OWL, mutations: ['Thunderstruck'] };
    case 't3b':
    case 't3b2a':
      return { kind: 'decor', key: OWL, mutations: ['Gold'] };
    case 't4a':
      return { kind: 'decor', key: OWL, mutations: ['Frozen'] };
    case 't4a2b':
      return { kind: 'decor', key: OWL, mutations: ['Rainbow'] };
    case 't4b':
      return { kind: 'decor', key: OWL, mutations: ['Amberlit'] };
    case 't4b2a':
      return { kind: 'decor', key: OWL, mutations: ['Ambercharged'] };
  }
}

// The MiniFairy* decor family provides a natural material ladder
// (Forge → Cottage → Keep → Castle → CastleLit) that matches the
// scaling forge → solar-crucible arc. Overlays layer heat on top:
// Amberlit at low fire tiers, Ambercharged/Dawnlit/Dawncharged as it climbs,
// Rainbow reserved for t4b2a Star-Forge crosspath.
function fairyForgeSprite(slot: UpgradeSlot): SpriteRef {
  const FORGE = 'sprite/decor/MiniFairyForge';
  const COTTAGE = 'sprite/decor/MiniFairyCottage';
  const KEEP = 'sprite/decor/MiniFairyKeep';
  const CASTLE = 'sprite/decor/MiniFairyCastle';
  const CASTLE_LIT = 'sprite/decor/MiniFairyCastleLit';
  switch (slot) {
    case 'base':
      return { kind: 'decor', key: FORGE };
    case 't2a':
    case 't2a2b':
      return { kind: 'decor', key: COTTAGE, mutations: ['Amberlit'] };
    case 't2b':
      return { kind: 'decor', key: FORGE, mutations: ['Gold'] };
    case 't3a':
      return { kind: 'decor', key: COTTAGE, mutations: ['Ambercharged'] };
    case 't3a2b':
    case 't3b2a':
      return { kind: 'decor', key: KEEP, mutations: ['Ambercharged'] };
    case 't3b':
      return { kind: 'decor', key: KEEP, mutations: ['Amberlit'] };
    case 't4a':
      return { kind: 'decor', key: CASTLE, mutations: ['Dawnlit'] };
    case 't4a2b':
      return { kind: 'decor', key: CASTLE_LIT, mutations: ['Dawncharged'] };
    case 't4b':
      return { kind: 'decor', key: CASTLE_LIT, mutations: ['Ambercharged'] };
    case 't4b2a':
      return { kind: 'decor', key: CASTLE_LIT, mutations: ['Rainbow'] };
  }
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

// Same walk-down semantics as resolveTowerSprite (towerAnchor.ts): primary
// (higher-tier, ties → A) then other; falls through to the slot-based curve.
function resolveFromRenderScaleByTier(
  kind: TowerId,
  upgA: UpgradeTier,
  upgB: UpgradeTier,
): number | null {
  const map = getTowerDef(kind).renderScaleByTier;
  if (!map) return null;
  const primary: 'a' | 'b' = upgA >= upgB ? 'a' : 'b';
  const other: 'a' | 'b' = primary === 'a' ? 'b' : 'a';
  const primaryTier = primary === 'a' ? upgA : upgB;
  const otherTier = other === 'a' ? upgA : upgB;
  for (let tier = primaryTier; tier >= 1; tier--) {
    const s = (primary === 'a' ? map.pathA : map.pathB)?.[tier as UpgradeTier];
    if (s !== undefined) return s;
  }
  for (let tier = otherTier; tier >= 1; tier--) {
    const s = (other === 'a' ? map.pathA : map.pathB)?.[tier as UpgradeTier];
    if (s !== undefined) return s;
  }
  return null;
}

export function getEffectiveRenderScale(
  kind: TowerId,
  upgA: UpgradeTier,
  upgB: UpgradeTier,
): number {
  const def = getTowerDef(kind);
  const tierScale = resolveFromRenderScaleByTier(kind, upgA, upgB);
  if (tierScale !== null) return tierScale;
  const base = def.renderScale ?? 1;
  const slot = resolveUpgradeSlot(upgA, upgB);
  return base * TIER_SCALE_MULT[slot];
}
