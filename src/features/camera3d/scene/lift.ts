import { project } from '../math/camera';
import { depthKey } from '../math/depth';
import type { FrameCtx } from '../frame/frame';
import type { Mat, Node3, XY } from '../types';
import type { Placement } from './entities';

export const LIFT_PX = 32;
type MatCtor = new (...args: unknown[]) => Mat;
type Trimmed = { trim?: { y: number; height: number } | null };

export interface LiftUnit { node: Node3; chain: Node3[]; foot: XY }
/** A positioned sub-container or leaf (a produce slot), entity-local: `attach` is where its origin sits. */
export interface LiftCand extends LiftUnit { attach: number }
/** `base`: art bottom of the entity's largest (0,0)-chain sprite (bush, trellis, decor, single crop); null: none. */
export interface EntityScan { base: number | null; baseNode: Node3 | null; cands: LiftCand[] }

// A scan older than RESCAN_FRAMES is redone, at most RESCAN_PER_FRAME per frame (live 2026-10-03: re-scanning every
// entity on each reCull cost 16.6 ms per reCull frame). A swapped, hidden or detached base sprite re-scans at once.
export const RESCAN_FRAMES = 90;
export const RESCAN_PER_FRAME = 24;

function relChain(chain: readonly Node3[], M: MatCtor): Mat {
  const m = new M();
  for (const n of chain) { n.updateLocalTransform(); m.append(n.localTransform); }
  return m;
}

const shown = (n: Node3): boolean => n.visible && n.alpha > 0;

// The visible bottom: trimmed atlas frames carry transparent rows under the art (Trellis: 13 px).
function leafBottom(n: Node3, m: Mat): XY | null {
  if (!n.texture || !n.anchor) return null;
  const t = n.texture, trim = (t as Trimmed).trim;
  return m.apply({ x: (0.5 - n.anchor.x) * t.orig.width, y: (trim ? trim.y + trim.height : t.orig.height) - n.anchor.y * t.orig.height });
}

function artBottom(n: Node3, m: Mat, out: { x: number; y: number }): void {
  if (!shown(n)) return;
  const p = leafBottom(n, m);
  if (p && p.y > out.y) { out.y = p.y; out.x = p.x; }
  for (const c of n.children) {
    c.updateLocalTransform();
    artBottom(c, m.clone().append(c.localTransform), out);
  }
}

/**
 * Positioned sub-containers or leaves are lift candidates (produce slots); sprites on the (0,0) chain are the base.
 * The game hangs every crop from its slot origin (CropVisual pivot, live 2026-10-03), so `attach` is that origin.
 */
export function scanEntity(entity: Node3, M: MatCtor, isLayerNode: (n: Node3) => boolean, maxNodes = 400): EntityScan {
  const cands: LiftCand[] = [];
  let base: number | null = null, baseNode: Node3 | null = null, baseArea = 0, seen = 0;
  const walk = (n: Node3, chain: Node3[]): void => {
    for (const c of n.children) {
      if (++seen > maxNodes || isLayerNode(c) || !shown(c)) continue;
      const ch = [...chain, c];
      if (c.x !== 0 || c.y !== 0) {
        if (!c.texture && c.children.length === 0) continue;
        const m = relChain(ch, M);
        const b = { x: 0, y: -Infinity };
        artBottom(c, m, b);
        if (b.y > -Infinity) cands.push({ node: c, chain, foot: { x: b.x, y: b.y }, attach: m.apply(c.pivot).y });
        continue;
      }
      // A Graphics owns a `texture()` draw method, not a Texture: sprites are texture + anchor (TramRoot masks).
      if (c.texture && c.anchor) {
        const m = relChain(ch, M);
        const area = c.texture.orig.width * c.texture.orig.height * Math.abs(m.a * m.d - m.b * m.c);
        const p = leafBottom(c, m);
        if (p && area > baseArea) { baseArea = area; base = p.y; baseNode = c; }
      }
      walk(c, ch);
    }
  };
  walk(entity, []);
  return { base, baseNode, cands };
}

/** D9 amended (2026-10-03): only a candidate attached at or below the stand row whose art hangs > liftPx below it. */
export function liftUnits(scan: EntityScan, standLocal: number, liftPx: number): LiftUnit[] {
  return scan.cands.filter((c) => c.attach >= standLocal && c.foot.y > standLocal + liftPx);
}

/** Re-parents nothing: rewrites each unit's local transform so it stands on its own ground point. Returns the max key. */
export function applyLift(ctx: FrameCtx, entity: Node3, lp: Placement, units: readonly LiftUnit[]): number {
  const M = ctx.caps.classes.Matrix as unknown as MatCtor;
  const osx = entity.scale.x / lp.mm, osy = entity.scale.y / lp.mm;
  const E = new M(entity.scale.x, 0, 0, entity.scale.y, entity.x, entity.y);
  let kMax = lp.key;
  for (const u of units) {
    if (u.node.destroyed || !u.node.parent) continue;
    const Cp = relChain(u.chain, M);
    u.node.updateLocalTransform();
    const Lu = u.node.localTransform.clone();
    const fwx = lp.x2d + u.foot.x * osx, fwy = lp.fy2d + u.foot.y * osy;
    project(ctx.basis, fwx, 0, fwy + lp.gdy, ctx.out);
    const lsx = ctx.out[0]!, lsy = ctx.out[1]!, lcz = ctx.out[2]!;
    ctx.saves.save(u.node);
    if (lcz < ctx.params.near) { u.node.scale.set(0, 0); continue; }
    const lmm = ctx.basis.fpx / lcz;
    const w2d = new M(osx, 0, 0, osy, lp.x2d, lp.fy2d).append(Cp).append(Lu);
    const su = new M(lmm, 0, 0, lmm, lsx - lmm * fwx, lsy - lmm * fwy).append(w2d);
    u.node.setFromMatrix(E.clone().append(Cp).invert().append(su));
    kMax = Math.max(kMax, depthKey(fwx, fwy + lp.gdy, ctx.dx, ctx.dz, 0));
  }
  return kMax;
}

/** `checked`: the frame the entry was last validated (standRow and afterPlace ask in the same frame). */
interface Entry { scan: EntityScan; baseTex: unknown; frame: number; checked: number; units: LiftUnit[] | null; unitsFor: number }

export interface Lifter {
  /** Stand row (2D world y): the base sprite's art bottom, else the sort y. */
  standRow(ctx: FrameCtx, node: Node3, sortY: number): number;
  afterPlace(ctx: FrameCtx, node: Node3, lp: Placement, standY: number): void;
  /** Forget every cached scan (3D left). */
  reset(): void;
}

export function createLifter(isLayerNode: (n: Node3) => boolean, isAvatar: (n: Node3) => boolean): Lifter {
  let cache = new WeakMap<Node3, Entry>();
  let budgetFrame = -1, budget = 0;
  const baseChanged = (e: Entry): boolean => {
    const b = e.scan.baseNode;
    return b !== null && (b.destroyed === true || !b.parent || b.texture !== e.baseTex || !shown(b));
  };
  let lastNode: Node3 | null = null, lastEntry: Entry | null = null;
  const validated = (ctx: FrameCtx, node: Node3): Entry => {
    const old = cache.get(node);
    if (old && old.checked === ctx.frameNo) return old;
    if (old && !baseChanged(old)) {
      old.checked = ctx.frameNo;
      if (ctx.frameNo - old.frame <= RESCAN_FRAMES) return old;
      if (budgetFrame !== ctx.frameNo) { budgetFrame = ctx.frameNo; budget = RESCAN_PER_FRAME; }
      if (budget <= 0) return old;
      budget--;
    }
    const scan = scanEntity(node, ctx.caps.classes.Matrix as unknown as MatCtor, isLayerNode);
    const e: Entry = { scan, baseTex: scan.baseNode?.texture ?? null, frame: ctx.frameNo, checked: ctx.frameNo, units: null, unitsFor: NaN };
    cache.set(node, e);
    return e;
  };
  const entryFor = (ctx: FrameCtx, node: Node3): Entry => {
    if (node === lastNode && lastEntry && lastEntry.checked === ctx.frameNo) return lastEntry;
    lastEntry = validated(ctx, node);
    lastNode = node;
    return lastEntry;
  };
  return {
    standRow(ctx, node, sortY) {
      const base = entryFor(ctx, node).scan.base;
      return base === null ? sortY : node.y + base * node.scale.y;
    },
    afterPlace(ctx, node, lp, standY) {
      // An avatar stands on its ground point via the art row; its Rive box has transparent padding under the feet.
      if (isAvatar(node)) return;
      const e = entryFor(ctx, node);
      // The node is billboarded already (scale × mm): stand row and threshold in entity-local px.
      const osy = node.scale.y / lp.mm;
      const local = (standY - lp.fy2d) / osy;
      if (!e.units || e.unitsFor !== local) { e.units = liftUnits(e.scan, local, LIFT_PX / osy); e.unitsFor = local; }
      if (e.units.length === 0) return;
      const k = applyLift(ctx, node, lp, e.units);
      // Exact keys near top-down keep the game's 2D order (spec §6.2), so s = 0 matches 2D.
      if (k > lp.key && !ctx.exactKeys) ctx.ov.put('zIndex', node, k);
    },
    reset() { cache = new WeakMap(); budgetFrame = -1; lastNode = null; lastEntry = null; },
  };
}
