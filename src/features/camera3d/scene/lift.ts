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

// Scratch matrices and points, reused by every scan and lift (A PF4: ~6 matrices per lifted unit per frame, and a
// clone per node per re-scan, before). Remade if the Matrix class changes (a new capture).
interface Scratch { M: MatCtor; rel: Mat; depth: Mat[]; E: Mat; W: Mat; S: Mat; inp: XY; pt: XY; bottom: XY }
let scratch: Scratch | null = null;
const scratchFor = (M: MatCtor): Scratch =>
  scratch && scratch.M === M ? scratch : (scratch = { M, rel: new M(), depth: [], E: new M(), W: new M(), S: new M(), inp: { x: 0, y: 0 }, pt: { x: 0, y: 0 }, bottom: { x: 0, y: 0 } });

function relChainInto(chain: readonly Node3[], m: Mat): Mat {
  m.set(1, 0, 0, 1, 0, 0);
  for (const n of chain) { n.updateLocalTransform(); m.append(n.localTransform); }
  return m;
}

const shown = (n: Node3): boolean => n.visible && n.alpha > 0;

// The visible bottom: trimmed atlas frames carry transparent rows under the art (Trellis: 13 px). Into sc.pt.
function leafBottom(n: Node3, m: Mat, sc: Scratch): XY | null {
  if (!n.texture || !n.anchor) return null;
  const t = n.texture, trim = (t as Trimmed).trim;
  sc.inp.x = (0.5 - n.anchor.x) * t.orig.width;
  sc.inp.y = (trim ? trim.y + trim.height : t.orig.height) - n.anchor.y * t.orig.height;
  return m.apply(sc.inp, sc.pt);
}

function artBottom(n: Node3, m: Mat, sc: Scratch, depth: number): void {
  if (!shown(n)) return;
  const p = leafBottom(n, m, sc);
  if (p && p.y > sc.bottom.y) { sc.bottom.y = p.y; sc.bottom.x = p.x; }
  for (const c of n.children) {
    c.updateLocalTransform();
    artBottom(c, (sc.depth[depth] ??= new sc.M()).copyFrom(m).append(c.localTransform), sc, depth + 1);
  }
}

/**
 * Positioned sub-containers or leaves are lift candidates (produce slots); sprites on the (0,0) chain are the base.
 * The game hangs every crop from its slot origin (CropVisual pivot, live 2026-10-03), so `attach` is that origin.
 */
export function scanEntity(entity: Node3, M: MatCtor, isLayerNode: (n: Node3) => boolean, maxNodes = 400): EntityScan {
  const sc = scratchFor(M);
  const cands: LiftCand[] = [];
  let base: number | null = null, baseNode: Node3 | null = null, baseArea = 0, seen = 0;
  // The (0,0) chain from the entity down to the node being looked at; a candidate keeps a copy.
  const stack: Node3[] = [];
  const relWith = (c: Node3): Mat => { stack.push(c); relChainInto(stack, sc.rel); stack.pop(); return sc.rel; };
  const walk = (n: Node3): void => {
    for (const c of n.children) {
      if (++seen > maxNodes || isLayerNode(c) || !shown(c)) continue;
      if (c.x !== 0 || c.y !== 0) {
        if (!c.texture && c.children.length === 0) continue;
        const m = relWith(c);
        sc.bottom.x = 0; sc.bottom.y = -Infinity;
        artBottom(c, m, sc, 0);
        if (sc.bottom.y > -Infinity) cands.push({ node: c, chain: stack.slice(), foot: { x: sc.bottom.x, y: sc.bottom.y }, attach: m.apply(c.pivot, sc.pt).y });
        continue;
      }
      // A Graphics owns a `texture()` draw method, not a Texture: sprites are texture + anchor (TramRoot masks).
      if (c.texture && c.anchor) {
        const m = relWith(c);
        const area = c.texture.orig.width * c.texture.orig.height * Math.abs(m.a * m.d - m.b * m.c);
        const p = leafBottom(c, m, sc);
        if (p && area > baseArea) { baseArea = area; base = p.y; baseNode = c; }
      }
      stack.push(c);
      walk(c);
      stack.pop();
    }
  };
  walk(entity);
  return { base, baseNode, cands };
}

/** D9 amended (2026-10-03): only a candidate attached at or below the stand row whose art hangs > liftPx below it. */
export function liftUnits(scan: EntityScan, standLocal: number, liftPx: number): LiftUnit[] {
  return scan.cands.filter((c) => c.attach >= standLocal && c.foot.y > standLocal + liftPx);
}

/** Re-parents nothing: rewrites each unit's local transform so it stands on its own ground point. Returns the max key. */
export function applyLift(ctx: FrameCtx, entity: Node3, lp: Placement, units: readonly LiftUnit[]): number {
  const sc = scratchFor(ctx.caps.classes.Matrix as unknown as MatCtor);
  const osx = entity.scale.x / lp.mm, osy = entity.scale.y / lp.mm;
  let kMax = lp.key;
  for (const u of units) {
    if (u.node.destroyed || !u.node.parent) continue;
    // Recomputed per frame, not cached: a chain container's transform can change (a crop's growth scale).
    const Cp = relChainInto(u.chain, sc.rel);
    u.node.updateLocalTransform();
    const fwx = lp.x2d + u.foot.x * osx, fwy = lp.fy2d + u.foot.y * osy;
    project(ctx.basis, fwx, 0, fwy + lp.gdy, ctx.out);
    const lsx = ctx.out[0]!, lsy = ctx.out[1]!, lcz = ctx.out[2]!;
    ctx.saves.save(u.node);
    // mm 0 marks it not drawn: through its card map picking would hit where it would sit unlifted.
    if (lcz < ctx.params.near) { u.node.scale.set(0, 0); ctx.drawn.pushLift(entity, u.node, fwx, fwy, 0, 0, 0); continue; }
    const lmm = ctx.basis.fpx / lcz;
    // node local = (E · Cp)⁻¹ · su, su = the unit's 2D world map (w2d) scaled about its ground point.
    const w2d = sc.W.set(osx, 0, 0, osy, lp.x2d, lp.fy2d).append(Cp).append(u.node.localTransform);
    const su = sc.S.set(lmm, 0, 0, lmm, lsx - lmm * fwx, lsy - lmm * fwy).append(w2d);
    u.node.setFromMatrix(sc.E.set(entity.scale.x, 0, 0, entity.scale.y, entity.x, entity.y).append(Cp).invert().append(su));
    // Picking reads the unit through this map: through its card's map it would hit where the unit would sit unlifted.
    ctx.drawn.pushLift(entity, u.node, fwx, fwy, lsx, lsy, lmm);
    kMax = Math.max(kMax, depthKey(fwx, fwy + lp.gdy, ctx.dx, ctx.dz, 0));
  }
  return kMax;
}

/** `checked`: the frame the entry was last validated (standRow and afterPlace ask in the same frame); ct, vt: the base
 * sprite's change ticks at its last full check. */
interface Entry { scan: EntityScan; baseTex: unknown; frame: number; checked: number; units: LiftUnit[] | null; unitsFor: number; ct: unknown; vt: unknown }
interface Ticked { _didContainerChangeTick?: unknown; _didViewChangeTick?: unknown }

export interface Lifter {
  /** Stand row (2D world y): the base sprite's art bottom, else the sort y. */
  standRow(ctx: FrameCtx, node: Node3, sortY: number): number;
  /** The scan the stand row comes from, validated as standRow does: a new one means the stand row may have moved. */
  scanOf(ctx: FrameCtx, node: Node3): EntityScan;
  afterPlace(ctx: FrameCtx, node: Node3, lp: Placement, standY: number): void;
  /** Forget every cached scan (3D left). */
  reset(): void;
}

export function createLifter(isLayerNode: (n: Node3) => boolean, isAvatar: (n: Node3) => boolean): Lifter {
  let cache = new WeakMap<Node3, Entry>();
  let budgetFrame = -1, budget = 0;
  // PIXI 8 (live v1431): visible and alpha writes bump the base sprite's _didContainerChangeTick, a texture or anchor
  // change its _didViewChangeTick. Both unchanged since the last full check: nothing that check reads changed (perf
  // Task 4: its getter reads were 0.29 ms a frame over ~1,100 tiles).
  const baseChanged = (e: Entry): boolean => {
    const b = e.scan.baseNode;
    if (b === null) return false;
    if (b.destroyed === true || !b.parent) return true;
    const ct = (b as Ticked)._didContainerChangeTick, vt = (b as Ticked)._didViewChangeTick;
    if (ct === e.ct && vt === e.vt && typeof ct === 'number' && typeof vt === 'number') return false;
    if (b.texture !== e.baseTex || !shown(b)) return true;
    e.ct = ct; e.vt = vt;
    return false;
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
    const b = scan.baseNode as (Node3 & Ticked) | null;
    const e: Entry = {
      scan, baseTex: b?.texture ?? null, frame: ctx.frameNo, checked: ctx.frameNo, units: null, unitsFor: NaN,
      ct: b?._didContainerChangeTick ?? NaN, vt: b?._didViewChangeTick ?? NaN,
    };
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
    scanOf: (ctx, node) => entryFor(ctx, node).scan,
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
