import type { SpriteSlotSemantic } from '../../../../mg-sprite-render/src';
import type { SpriteRef } from '../data/towerDefs';
import { getTextureAnchor } from '../../../sprite-v2/compat';
import { resolveSpriteRefAnchor, spriteRefToSceneKey } from '../render/towerAnchor';

export interface MountedSlot {
  slot: SpriteSlotSemantic;
  w: number;
  h: number;
}

// Interchange contract with MG-Sprite-Customiser-V2 serializeSceneAsQpmV1 (and
// hand-authored precreated scenes): a slot may carry `role: 'base'` marking it
// as the tower footing. Not yet in mg-sprite-render's SpriteSlotSemantic, so
// read structurally — scenes without it must keep working via the heuristic.
export function isBaseRoleSlot(slot: SpriteSlotSemantic): boolean {
  return (slot as unknown as { role?: unknown }).role === 'base';
}

function isUpright(rotation: number): boolean {
  const twoPi = Math.PI * 2;
  const r = ((rotation % twoPi) + twoPi) % twoPi;
  return Math.min(r, twoPi - r) < 0.05;
}

// Explicit role wins. Otherwise the vanilla base sprite may appear several times
// in a design (footing + "ammunition"/decoration copies); copies are almost
// always rotated and/or shrunk, so prefer upright, then largest, then lowest z.
export function pickBaseSlot(slots: readonly MountedSlot[], baseRef: SpriteRef): MountedSlot | null {
  const explicit = slots.find(m => isBaseRoleSlot(m.slot));
  if (explicit) return explicit;
  const key = spriteRefToSceneKey(baseRef);
  const matches = slots.filter(m => m.slot.spriteKey === key);
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const ua = isUpright(a.slot.transform.rotation) ? 0 : 1;
    const ub = isUpright(b.slot.transform.rotation) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    if (a.slot.transform.scale !== b.slot.transform.scale) return b.slot.transform.scale - a.slot.transform.scale;
    return a.slot.zIndex - b.slot.zIndex;
  });
  return matches[0] ?? null;
}

// Where the game would "stand" this slot: the tower's vanilla anchor if the slot
// IS the vanilla base sprite, else that sprite's own atlas anchor, else bottom-center.
function anchorFractionFor(m: MountedSlot, baseRef: SpriteRef): { x: number; y: number } {
  if (m.slot.spriteKey === spriteRefToSceneKey(baseRef)) return resolveSpriteRefAnchor(baseRef);
  return getTextureAnchor(m.slot.spriteKey) ?? { x: 0.5, y: 1.0 };
}

// Anchor point in scene units, honouring the slot's own scale/rotation.
export function baseSlotPivot(m: MountedSlot, baseRef: SpriteRef): { x: number; y: number } {
  const a = anchorFractionFor(m, baseRef);
  const t = m.slot.transform;
  const ax = (a.x - 0.5) * m.w * t.scale;
  const ay = (a.y - 0.5) * m.h * t.scale;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return { x: t.x + ax * cos - ay * sin, y: t.y + ax * sin + ay * cos };
}
