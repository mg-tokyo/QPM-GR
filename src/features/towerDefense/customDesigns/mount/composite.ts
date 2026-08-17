import type { Tower, TowerId } from '../../types';
import type { DesignLibraryEntry } from '../types';
import { computeSlotBounds, type SlotBoundsInput } from '../bounds';
import { baseSlotPivot, pickBaseSlot, type MountedSlot } from '../anchor';
import { getEffectiveRenderScale } from '../../data/tierSlots';
import { resolveTowerSprite } from '../../render/towerAnchor';
import { applyMutations } from '../../../../../mg-sprite-render/src';
import { getRawSpriteCanvas } from '../../../../sprite-v2/compat';
import {
  getStageSpriteCtor,
  getStageTextureCtor,
  getStageContainerCtor,
  tileToPixel,
  TD_Z_TOWER,
} from '../../render/stage';
import { createNamedLogger } from '../../../../diagnostics/logger';

const log = createNamedLogger('td-custom-designs');

type PixiNode = Record<string, unknown>;
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
  position?: { set: (x: number, y: number) => void };
  scale?: { set: (x: number, y: number) => void };
  pivot?: { set: (x: number, y: number) => void };
  alpha?: number;
  zIndex?: number;
};

// Subset of Tower the mount actually reads — lets the placement ghost reuse
// this builder with a synthetic tower.
export type CustomTowerMountTarget = Pick<Tower, 'id' | 'kind' | 'tile' | 'upgradesA' | 'upgradesB'>;
type SpriteNode = PixiNode & {
  anchor?: { set: (x: number, y: number) => void };
  scale?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  rotation?: number;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

export interface SlotSprite {
  sprite: SpriteNode;
  spriteKey: string;
}

export interface CustomTowerSpriteRecord {
  container: ContainerNode;
  slots: SlotSprite[];
  kind: TowerId;
  upgradesA: number;
  upgradesB: number;
  designId: string;
  unmount: () => void;
}

// Dedupe (designId, spriteKey) warns so a missing atlas key logs once per session,
// not once per mount/rebuild — see codes/tdCustomDesigns.ts TDCDRND-001 devNotes.
const warnedMissingSprite = new Set<string>();

export function buildCustomTowerContainer(
  design: DesignLibraryEntry,
  tower: CustomTowerMountTarget,
  stageContainer: ContainerNode,
): CustomTowerSpriteRecord | null {
  const ContainerCtor = getStageContainerCtor();
  const SpriteCtor = getStageSpriteCtor();
  const TextureCtor = getStageTextureCtor();
  if (!ContainerCtor) {
    log.error('QPM-TDCDRND-004', { what: 'container', tower: tower.id, designId: design.id });
    return null;
  }
  if (!SpriteCtor) {
    log.error('QPM-TDCDRND-004', { what: 'sprite', tower: tower.id, designId: design.id });
    return null;
  }
  if (!TextureCtor) {
    log.error('QPM-TDCDRND-004', { what: 'texture', tower: tower.id, designId: design.id });
    return null;
  }

  const container = new ContainerCtor() as ContainerNode;
  const p = tileToPixel(tower.tile);
  container.position?.set?.(p.x, p.y);
  const towerScale = getEffectiveRenderScale(tower.kind, tower.upgradesA, tower.upgradesB);
  container.scale?.set?.(towerScale, towerScale);

  const slots: SlotSprite[] = [];
  const mounted: MountedSlot[] = [];
  const baseRef = resolveTowerSprite(tower.kind, tower.upgradesA, tower.upgradesB);
  const ordered = [...design.scene.slots].sort((a, b) => a.zIndex - b.zIndex);
  for (const slot of ordered) {
    if (!slot.visible) continue;
    const raw = getRawSpriteCanvas(slot.spriteKey);
    if (!raw) {
      const key = `${design.id}::${slot.spriteKey}`;
      if (!warnedMissingSprite.has(key)) {
        warnedMissingSprite.add(key);
        log.warn('QPM-TDCDRND-001', { designId: design.id, spriteKey: slot.spriteKey });
      }
      continue;
    }
    const composed = document.createElement('canvas');
    composed.width = raw.width;
    composed.height = raw.height;
    const ctx = composed.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(raw, 0, 0);
    applyMutations(composed, [...slot.mutations], false, slot.tint);

    let texture: unknown;
    try {
      texture = TextureCtor.from(composed);
    } catch {
      continue;
    }
    const sprite = new SpriteCtor(texture) as SpriteNode;

    // Scene convention: transform.x/y is customiser-canvas-CENTER relative and
    // each slot renders centered on that point (MG-Sprite-Customiser-V2 renderer).
    sprite.anchor?.set?.(0.5, 0.5);
    sprite.position?.set?.(slot.transform.x, slot.transform.y);
    sprite.scale?.set?.(slot.transform.scale, slot.transform.scale);
    sprite.rotation = slot.transform.rotation;

    container.addChild?.(sprite);
    slots.push({ sprite, spriteKey: slot.spriteKey });
    mounted.push({ slot, w: composed.width, h: composed.height });
  }

  // Container origin = tile center. Pivot on the footing slot's anchor point
  // (explicit role:'base' → heuristic vanilla-base match, see anchor.ts) so the
  // swapped base sits exactly where vanilla does; designs with no identifiable
  // footing fall back to content-bounds bottom-center (the plant convention).
  // Without a pivot the design hangs half its height below the tile.
  const base = pickBaseSlot(mounted, baseRef);
  if (base) {
    const pv = baseSlotPivot(base, baseRef);
    container.pivot?.set?.(pv.x, pv.y);
  } else {
    const boundsInput: SlotBoundsInput[] = mounted.map(m => ({
      w: m.w, h: m.h,
      x: m.slot.transform.x, y: m.slot.transform.y,
      scale: m.slot.transform.scale, rotation: m.slot.transform.rotation,
    }));
    const b = computeSlotBounds(boundsInput);
    if (b) container.pivot?.set?.(b.x + b.w / 2, b.y + b.h);
  }

  // Y-sort within the tower tier: mirrors the vanilla path in towerRender.ts
  // so custom-mounted towers share consistent front-to-back stacking with
  // vanilla ones when a plot mixes both.
  container.zIndex = TD_Z_TOWER + tower.tile.y * 0.001;
  stageContainer.addChild?.(container);

  const unmount = (): void => {
    try {
      stageContainer.removeChild?.(container);
    } catch {
      /* container may already be detached */
    }
    container.destroy?.({ children: true, texture: false });
    slots.length = 0;
  };

  return {
    container,
    slots,
    kind: tower.kind,
    upgradesA: tower.upgradesA,
    upgradesB: tower.upgradesB,
    designId: design.id,
    unmount,
  };
}
