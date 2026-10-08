import { readSync } from '../../../core/gameState';
import { chainMatrix, type DrawnEntry, type DrawnTable, type LiftEntry } from '../frame/drawn';
import { groundRay } from '../math/camera';
import { sortYOf } from '../math/depth';
import type { Runtime } from '../runtime';
import type { Floor } from '../scene/floor';
import type { Mat, Node3, TexLike, XY } from '../types';
import { createAlphaProbe, PROBE_W, type Texel } from './alphaProbe';
import { collectLeafHits, relMatrix, type LeafHit } from './leafHits';
import { chooseTapPoint, type TapHit } from './tapPoint';

const BATCH = 8;
const ALPHA_MIN = 0.1;
// Hover prefilter: each drawn node's local bounds, re-measured when older than BOUNDS_FRAMES or its child count
// changed, at most BOUNDS_PER_PICK per pick (a node with no usable bounds gets the full walk).
const BOUNDS_FRAMES = 120;
const BOUNDS_PER_PICK = 48;
const BOUNDS_PAD = 8;

/** `world`: the 2D World point the pick acts at (null for the sky); `global` is it on the 2D screen at pick time. */
export interface PickResult { kind: 'billboard' | 'ground' | 'sky'; global: XY; world: XY | null; label: string | null; probes: number; ms: number }
/** picks/avgMs/p95Ms: hover work per frame that did any (the spec §14 gate); tap*: synchronous picks. */
export interface PickStats {
  picks: number; avgMs: number; p95Ms: number; taps: number; tapAvgMs: number; tapP95Ms: number; asyncReads: number;
  /** Hover totals since install: picks `n` (`probed` drew a probe), read `resolves`, phase ms, counts. */
  parts: Record<string, number>;
}
export interface Picker {
  /** Synchronous pick on the last drawn frame (taps, debug). */
  pick(cx: number, cy: number): PickResult;
  /** An earlier pick at its World point, mapped through the current 2D view (the pointerup of a click). */
  repick(prev: PickResult): PickResult;
  /** Last settled hover result (a ground hit is re-cast at this point); (cx, cy) is picked after the next 3D frame. */
  hover(cx: number, cy: number): PickResult;
  stats(): PickStats;
  destroy(): void;
}

interface Cand { e: DrawnEntry; hits: LeafHit[]; key: [number, number, number] }
interface Pair { c: Cand; h: LeafHit }
// A billboard outcome in World space, copied at pick time (DrawnTable entries are reused). `world` is the tap point,
// chosen once (tapPoint.ts) and turned into a 2D global point when used.
interface Hit extends TapHit { label: string | null; world: XY | null }
const newHit = (): Hit => ({ building: false, sprite: { x: 0, y: 0 }, foot: { x: 0, y: 0 }, label: null, world: null });
function copyHit(dst: Hit, src: Hit): Hit {
  dst.building = src.building; dst.sprite.x = src.sprite.x; dst.sprite.y = src.sprite.y;
  dst.foot.x = src.foot.x; dst.foot.y = src.foot.y; dst.label = src.label; dst.world = null;
  return dst;
}
const MISS = 0, HIT = 1, OPAQUE = 2;
type TexelRes = typeof MISS | typeof HIT | typeof OPAQUE;
interface Bounds { x0: number; y0: number; x1: number; y1: number; frame: number; kids: number }
type InvMat = Mat & { applyInverse(p: XY, out?: XY): XY };
type Measurable = Node3 & { getLocalBounds?(): { minX: number; minY: number; maxX: number; maxY: number } };
interface Rect4 { x: number; y: number; width: number; height: number }
type TexFull = TexLike & { trim?: Rect4 | null; uvs: { x0: number; y0: number; x1: number; y1: number; x3: number; y3: number }; source: TexLike['source'] & { width: number; height: number } };

class Ring {
  private readonly a = new Float64Array(256);
  n = 0;
  add(v: number): void { this.a[this.n % this.a.length] = v; this.n++; }
  avg(): number { const k = Math.min(this.n, this.a.length); let s = 0; for (let i = 0; i < k; i++) s += this.a[i]!; return k ? s / k : 0; }
  p95(): number { const k = Math.min(this.n, this.a.length); const s = Array.from(this.a.subarray(0, k)).sort((x, y) => x - y); return k ? s[Math.floor(k * 0.95)]! : 0; }
}

/** skipLeaf: leaves drawn flat on the floor, not in their entity's card (the game's area indicator tiles). */
export function createPicker(rt: Runtime, floor: Floor, skipLeaf: (n: Node3) => boolean = () => false): Picker {
  const { classes: C, scene } = rt.caps;
  const world = scene.world;
  const probe = createAlphaProbe(scene.renderer, C, () => floor.renderTextureClass());
  const pool: XY[] = [];
  const bounds = new WeakMap<Node3, Bounds>();
  const tmp: XY = { x: 0, y: 0 };
  let budget = 0;
  const hoverRing = new Ring(), tapRing = new Ring();
  let asyncReads = 0;
  let pendingPt: XY | null = null;
  let settled: Hit | null = null;
  // Reused per pick (A PF4). A hover's read resolves before the next hover pick starts (onPostRender below), so the
  // candidate pools are never overwritten under a read in flight; the winner is copied out to `settledHit`.
  const M = C.Matrix as unknown as new () => Mat;
  const w2gM = new M(), texM = new M();
  const at: XY = { x: 0, y: 0 }, cpt: XY = { x: 0, y: 0 }, lpt: XY = { x: 0, y: 0 };
  const hitBuf: LeafHit[] = [];
  const texPool: Texel[] = [], hitPool: Hit[] = [];
  const texels: Texel[] = [], hits: Hit[] = [];
  const settledHit = newHit();
  // Hover cost split (totals): ms per phase and counts, for the spec §14 pick gate.
  const parts = { n: 0, gather: 0, bounds: 0, texel: 0, probed: 0, probe: 0, resolves: 0, resolve: 0, entries: 0, walked: 0, measured: 0, texels: 0 };

  // Optional (game drift degrades to the foot point): the router's own claim resolution, side-effect free.
  const claims = rt.caps.systems.tapRouter;
  const playerTile = (): XY | null => {
    try { return readSync('position'); } catch { return null; }
  };

  // True only when `p` (parent space) is outside n's padded local bounds; unknown bounds never reject.
  const outside = (n: Measurable, p: XY, frameNo: number): boolean => {
    let b = bounds.get(n);
    const kids = n.children.length;
    if ((!b || b.kids !== kids || frameNo - b.frame > BOUNDS_FRAMES) && budget > 0 && n.getLocalBounds) {
      budget--;
      const tb = performance.now();
      const lb = n.getLocalBounds();
      parts.bounds += performance.now() - tb;
      b = { x0: lb.minX - BOUNDS_PAD, y0: lb.minY - BOUNDS_PAD, x1: lb.maxX + BOUNDS_PAD, y1: lb.maxY + BOUNDS_PAD, frame: frameNo, kids };
      bounds.set(n, b);
    }
    if (!b || b.kids !== kids) return false;
    n.updateLocalTransform();
    const lp = (n.localTransform as InvMat).applyInverse(p, tmp);
    return lp.x < b.x0 || lp.x > b.x1 || lp.y < b.y0 || lp.y > b.y1;
  };

  const drawKey = (n: Node3): [number, number, number] => {
    const top = n.parent === world ? n : (n.parent ?? n);
    return [rt.ov.raw<number>('zIndex', top), world.children.indexOf(top), top === n ? 0 : top.children.indexOf(n)];
  };
  const cmp = (a: Cand, b: Cand): number => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2];

  // Leaves under the cursor on the last drawn frame, topmost first. An entity with lifted units skips the bounds
  // prefilter: its produce is drawn off its card (A I6).
  function gather(cx: number, cy: number, frameNo: number, prefilter: boolean): Pair[] {
    const table: DrawnTable = rt.frame.published();
    const liftOf = (n: Node3): LiftEntry | null => table.liftFor(n);
    const cands: Cand[] = [];
    budget = BOUNDS_PER_PICK;
    for (let i = 0; i < table.len; i++) {
      const e = table.entries[i]!;
      if (e.node.destroyed || !e.node.parent || !(e.mm > 0)) continue;
      at.x = e.x + (cx - e.px) / e.mm;
      at.y = e.y + (cy - e.py) / e.mm;
      if (prefilter && !table.hasLifts(e.node) && outside(e.node, at, frameNo)) continue;
      if (prefilter) parts.walked++;
      hitBuf.length = 0;
      collectLeafHits(e.node, e, cx, cy, world, liftOf, skipLeaf, hitBuf, pool);
      if (hitBuf.length) cands.push({ e, hits: hitBuf.slice(), key: drawKey(e.node) });
    }
    cands.sort(cmp);
    if (prefilter) { parts.entries += table.len; parts.measured += BOUNDS_PER_PICK - budget; }
    return cands.flatMap((c) => c.hits.map((h) => ({ c, h })));
  }

  // The cursor's source texel on a leaf as drawn this frame, into `out`. Display (u, v) goes through the texture's own
  // uvs, so trims, mirrors and rotations hold (the Rive atlas frames are mirrored, rotate 8). OPAQUE: nothing to sample.
  const texelAt = ({ h }: Pair, cx: number, cy: number, out: Texel): TexelRes => {
    const leaf = h.leaf, map = h.map;
    const t = leaf.texture as TexFull | null | undefined, anc = leaf.anchor;
    if (!t || !anc || !t.uvs) return OPAQUE;
    const m = relMatrix(leaf, world, texM);
    m.translate(-map.x, -map.y).scale(map.mm, map.mm).translate(map.px, map.py);
    cpt.x = cx; cpt.y = cy;
    const L = m.invert().apply(cpt, lpt);
    const tr = t.trim, dw = tr ? tr.width : t.orig.width, dh = tr ? tr.height : t.orig.height;
    const u = (L.x + anc.x * t.orig.width - (tr ? tr.x : 0)) / dw, v = (L.y + anc.y * t.orig.height - (tr ? tr.y : 0)) / dh;
    if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return MISS;
    const U = t.uvs, sw = t.source.width, sh = t.source.height;
    const sx = (U.x0 + u * (U.x1 - U.x0) + v * (U.x3 - U.x0)) * sw, sy = (U.y0 + u * (U.y1 - U.y0) + v * (U.y3 - U.y0)) * sh;
    out.source = t.source;
    out.x = Math.min(sw - 1, Math.max(0, Math.floor(sx)));
    out.y = Math.min(sh - 1, Math.max(0, Math.floor(sy)));
    return HIT;
  };
  const newTexel = (): Texel => ({ source: C.Texture.EMPTY.source, x: 0, y: 0 });

  // `sprite`: the cursor's pixel on the leaf in 2D; `foot`: its entity's sort line, the game's (an avatar's origin is
  // 0.75 tile north of its ground). Building containers sit at World (0,0) with an identity transform (live
  // 2026-10-03), so part space is World space.
  const hitOf = ({ c, h }: Pair, out: Hit = newHit()): Hit => {
    const n = c.e.node;
    out.building = n.parent !== world && (n.parent?.label ?? '').startsWith('Building');
    out.sprite.x = h.wx; out.sprite.y = h.wy;
    out.foot.x = c.e.x; out.foot.y = sortYOf(rt.ov.gameValue<number>('zIndex', n), c.e.y);
    out.label = n.label ?? null; out.world = null;
    return out;
  };

  const tapPoint = (h: Hit, w2g: Mat): XY => {
    if (h.world) return h.world;
    const claimed = claims
      ? (p: XY): boolean => { try { return claims.resolveClaimAt(w2g.apply(p)) != null; } catch { return false; } }
      : null;
    h.world = chooseTapPoint(h, playerTile(), claimed);
    return h.world;
  };

  // `world` is copied: chooseTapPoint may hand back the hit's own (reused) sprite or foot point.
  const billboard = (h: Hit, w2g: Mat, probes: number): PickResult => {
    const w = tapPoint(h, w2g), g = w2g.apply(w);
    return { kind: 'billboard', global: { x: g.x, y: g.y }, world: { x: w.x, y: w.y }, label: h.label, probes, ms: 0 };
  };
  const groundAt = (cx: number, cy: number, w2g: Mat | null, probes: number): PickResult => {
    const ctx = rt.frame.ctx();
    const gp = ctx && w2g ? groundRay(ctx.basis, cx, cy) : null;
    if (!gp || !w2g) return { kind: 'sky', global: { x: -1e6, y: -1e6 }, world: null, label: null, probes, ms: 0 };
    const g = w2g.apply(gp);
    return { kind: 'ground', global: { x: g.x, y: g.y }, world: gp, label: null, probes, ms: 0 };
  };

  function pick(cx: number, cy: number): PickResult {
    const t0 = performance.now();
    const ctx = rt.frame.ctx();
    const w2g = chainMatrix(world, w2gM);
    let best: Hit | null = null;
    let probes = 0;
    if (ctx && w2g) {
      const pairs = gather(cx, cy, ctx.frameNo, false);
      for (let k = 0; k < pairs.length && !best; k += BATCH) {
        const batch = pairs.slice(k, k + BATCH);
        const outs = batch.map(newTexel);
        const kinds = batch.map((p, i) => texelAt(p, cx, cy, outs[i]!));
        const req: Texel[] = [];
        for (let i = 0; i < kinds.length; i++) if (kinds[i] === HIT) req.push(outs[i]!);
        const got = req.length ? probe.readNow(req) : [];
        let j = 0;
        const hit = kinds.findIndex((r) => (r === OPAQUE ? true : r === HIT ? got[j++]! >= ALPHA_MIN : false));
        probes += batch.length;
        if (hit >= 0) best = hitOf(batch[hit]!);
      }
    }
    const res = best && w2g ? billboard(best, w2g, probes) : groundAt(cx, cy, w2g, probes);
    res.ms = performance.now() - t0;
    tapRing.add(res.ms);
    return res;
  }

  // The same World point, so a camera that moved between pointerdown and pointerup still acts where the press picked.
  function repick(prev: PickResult): PickResult {
    if (!prev.world) return prev;
    const w2g = chainMatrix(world, w2gM);
    if (!w2g) return prev;
    const g = w2g.apply(prev.world);
    return { ...prev, global: { x: g.x, y: g.y }, ms: 0 };
  }

  // Hover, at most once per frame on the latest point: texels in draw order up to the first untextured leaf, one
  // async read for all of them. The first texel at ALPHA_MIN wins, else that leaf, else the ground.
  function hoverPick(cx: number, cy: number): void {
    const ctx = rt.frame.ctx();
    if (!ctx) { settled = null; return; }
    texels.length = 0; hits.length = 0;
    let fallback: Hit | null = null;
    const t0 = performance.now();
    const pairs = gather(cx, cy, ctx.frameNo, true);
    const t1 = performance.now();
    for (const p of pairs) {
      const i = texels.length;
      if (i >= PROBE_W) break;
      const out = (texPool[i] ??= newTexel());
      const r = texelAt(p, cx, cy, out);
      if (r === OPAQUE) { fallback = hitOf(p, (hitPool[PROBE_W] ??= newHit())); break; }
      if (r === HIT) { texels.push(out); hits.push(hitOf(p, (hitPool[i] ??= newHit()))); }
    }
    const t2 = performance.now();
    parts.n++; parts.gather += t1 - t0; parts.texel += t2 - t1; parts.texels += texels.length;
    const settle = (h: Hit | null): void => { settled = h ? copyHit(settledHit, h) : null; };
    if (!texels.length) { settle(fallback); return; }
    const done = (a: number[]): void => { const i = a.findIndex((v) => v >= ALPHA_MIN); settle(i >= 0 ? hits[i]! : fallback); };
    if (!probe.readLater(texels, (a) => { asyncReads++; done(a); })) done(probe.readNow(texels));
    parts.probed++;
    parts.probe += performance.now() - t2;
  }

  // After each live frame (2D restored, this frame's table published): finish the read in flight or start the next
  // pick, never both. getBufferSubData is a synchronous GPU-process round trip in Chrome (live: 0.48 ms here, 0.88
  // before the stage render). A sample is a frame that did either.
  const offPost = rt.onPostRender(() => {
    const t0 = performance.now();
    if (probe.busy()) {
      const reads = asyncReads;
      probe.poll();
      if (asyncReads === reads) return;
      const ms = performance.now() - t0;
      parts.resolves++; parts.resolve += ms;
      hoverRing.add(ms);
      return;
    }
    if (!pendingPt) return;
    const p = pendingPt;
    pendingPt = null;
    hoverPick(p.x, p.y);
    hoverRing.add(performance.now() - t0);
  });
  const offExit = rt.onExit(() => { pendingPt = null; settled = null; probe.cancel(); });

  return {
    pick,
    repick,
    hover(cx, cy) {
      if (pendingPt) { pendingPt.x = cx; pendingPt.y = cy; } else pendingPt = { x: cx, y: cy };
      const w2g = chainMatrix(world, w2gM);
      return settled && w2g ? billboard(settled, w2g, 0) : groundAt(cx, cy, w2g, 0);
    },
    stats: () => ({
      picks: hoverRing.n, avgMs: hoverRing.avg(), p95Ms: hoverRing.p95(),
      taps: tapRing.n, tapAvgMs: tapRing.avg(), tapP95Ms: tapRing.p95(), asyncReads, parts: { ...parts },
    }),
    destroy() { offPost(); offExit(); probe.destroy(); },
  };
}
