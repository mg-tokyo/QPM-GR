import { chainMatrix, type DrawnEntry } from '../frame/drawn';
import { groundRay } from '../math/camera';
import { sortYOf } from '../math/depth';
import type { Runtime } from '../runtime';
import type { Floor } from '../scene/floor';
import type { Mat, Node3, TexLike, XY } from '../types';
import { createAlphaProbe, PROBE_W, type Texel } from './alphaProbe';

const BATCH = 8;
const ALPHA_MIN = 0.1;
// Hover prefilter: each drawn node's local bounds, re-measured when older than BOUNDS_FRAMES or its child count
// changed, at most BOUNDS_PER_PICK per pick (a node with no usable bounds gets the full walk).
const BOUNDS_FRAMES = 120;
const BOUNDS_PER_PICK = 48;
const BOUNDS_PAD = 8;

export interface PickResult { kind: 'billboard' | 'ground' | 'sky'; global: XY; label: string | null; probes: number; ms: number }
/** picks/avgMs/p95Ms: hover work per frame that did any (the spec §14 gate); tap*: synchronous picks. */
export interface PickStats {
  picks: number; avgMs: number; p95Ms: number; taps: number; tapAvgMs: number; tapP95Ms: number; asyncReads: number;
  /** Hover totals since install: picks `n` (`probed` drew a probe), read `resolves`, phase ms, counts. */
  parts: Record<string, number>;
}
export interface Picker {
  /** Synchronous pick on the last drawn frame (taps, debug). */
  pick(cx: number, cy: number, fresh: boolean): PickResult;
  /** Last settled hover result (a ground hit is re-cast at this point); (cx, cy) is picked after the next 3D frame. */
  hover(cx: number, cy: number): PickResult;
  stats(): PickStats;
  destroy(): void;
}

interface Cand { e: DrawnEntry; leaves: Node3[]; key: [number, number, number]; wx: number; wy: number }
interface Pair { c: Cand; leaf: Node3 }
// A billboard outcome in World space, copied at pick time (DrawnTable entries are reused); 2D global when used.
interface Hit { world: XY; label: string | null }
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
  let cache: { key: string; res: PickResult } | null = null;
  const hoverRing = new Ring(), tapRing = new Ring();
  let asyncReads = 0;
  let pendingPt: XY | null = null;
  let settled: Hit | null = null;
  // Hover cost split (totals): ms per phase and counts, for the spec §14 pick gate.
  const parts = { n: 0, gather: 0, bounds: 0, texel: 0, probed: 0, probe: 0, resolves: 0, resolve: 0, entries: 0, walked: 0, measured: 0, texels: 0 };

  const relMatrix = (leaf: Node3): Mat => {
    leaf.updateLocalTransform();
    const m = leaf.localTransform.clone();
    for (let p = leaf.parent; p && p !== world; p = p.parent) { p.updateLocalTransform(); m.prepend(p.localTransform); }
    return m;
  };

  // Top-down: the point in each node's own space via its local transform (toLocal per leaf walks up to the stage;
  // live: 2.2 ms per pick over ~500 drawn entries). `p` is in n's parent space.
  const hitLeaves = (n: Node3, p: XY, acc: Node3[], depth: number): void => {
    if (!n.visible || n.alpha <= 0 || n.renderable === false || skipLeaf(n)) return;
    n.updateLocalTransform();
    const lp = (n.localTransform as InvMat).applyInverse(p, pool[depth] ??= { x: 0, y: 0 });
    if (n.children.length === 0) {
      if (n.containsPoint && (n.texture || n.geometry || n.context) && n.containsPoint(lp)) acc.push(n);
      return;
    }
    for (let i = n.children.length - 1; i >= 0; i--) hitLeaves(n.children[i]!, lp, acc, depth + 1);
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

  // Leaves under the cursor on the last drawn frame, topmost first.
  function gather(cx: number, cy: number, frameNo: number, prefilter: boolean): Pair[] {
    const table = rt.frame.published();
    const cands: Cand[] = [];
    const at: XY = { x: 0, y: 0 };
    budget = BOUNDS_PER_PICK;
    for (let i = 0; i < table.len; i++) {
      const e = table.entries[i]!;
      if (e.node.destroyed || !e.node.parent || !(e.mm > 0)) continue;
      at.x = e.x + (cx - e.px) / e.mm;
      at.y = e.y + (cy - e.py) / e.mm;
      if (prefilter && outside(e.node, at, frameNo)) continue;
      if (prefilter) parts.walked++;
      const leaves: Node3[] = [];
      hitLeaves(e.node, at, leaves, 0);
      if (leaves.length) cands.push({ e, leaves, key: drawKey(e.node), wx: at.x, wy: at.y });
    }
    cands.sort(cmp);
    if (prefilter) { parts.entries += table.len; parts.measured += BOUNDS_PER_PICK - budget; }
    return cands.flatMap((c) => c.leaves.map((leaf) => ({ c, leaf })));
  }

  // The cursor's source texel on a leaf as drawn this frame. Display (u, v) goes through the texture's own uvs, so
  // trims, mirrors and rotations hold (the Rive atlas frames are mirrored, rotate 8). 'opaque': nothing to sample.
  const texelAt = ({ c, leaf }: Pair, cx: number, cy: number): Texel | null | 'opaque' => {
    const t = leaf.texture as TexFull | null | undefined, anc = leaf.anchor;
    if (!t || !anc || !t.uvs) return 'opaque';
    const m = relMatrix(leaf);
    m.translate(-c.e.x, -c.e.y).scale(c.e.mm, c.e.mm).translate(c.e.px, c.e.py);
    const L = m.invert().apply({ x: cx, y: cy });
    const tr = t.trim, dw = tr ? tr.width : t.orig.width, dh = tr ? tr.height : t.orig.height;
    const u = (L.x + anc.x * t.orig.width - (tr ? tr.x : 0)) / dw, v = (L.y + anc.y * t.orig.height - (tr ? tr.y : 0)) / dh;
    if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return null;
    const U = t.uvs, sw = t.source.width, sh = t.source.height;
    const sx = (U.x0 + u * (U.x1 - U.x0) + v * (U.x3 - U.x0)) * sw, sy = (U.y0 + u * (U.y1 - U.y0) + v * (U.y3 - U.y0)) * sh;
    return { source: t.source, x: Math.min(sw - 1, Math.max(0, Math.floor(sx))), y: Math.min(sh - 1, Math.max(0, Math.floor(sy))) };
  };

  // Buildings resolve their tap claims from the sprite point; anything else taps its own foot, the game's sort line
  // (an avatar's origin is 0.75 tile north of its ground). Building containers sit at World (0,0) with an identity
  // transform (live 2026-10-03), so part space is World space.
  const hitOf = (c: Cand): Hit => {
    const n = c.e.node;
    const isBuilding = n.parent !== world && (n.parent?.label ?? '').startsWith('Building');
    return { world: isBuilding ? { x: c.wx, y: c.wy } : { x: c.e.x, y: sortYOf(rt.ov.gameValue<number>('zIndex', n), c.e.y) }, label: n.label ?? null };
  };

  const billboard = (h: Hit, w2g: Mat, probes: number): PickResult => {
    const g = w2g.apply(h.world);
    return { kind: 'billboard', global: { x: g.x, y: g.y }, label: h.label, probes, ms: 0 };
  };
  const groundAt = (cx: number, cy: number, w2g: Mat | null, probes: number): PickResult => {
    const ctx = rt.frame.ctx();
    const gp = ctx && w2g ? groundRay(ctx.basis, cx, cy) : null;
    if (!gp || !w2g) return { kind: 'sky', global: { x: -1e6, y: -1e6 }, label: null, probes, ms: 0 };
    const g = w2g.apply(gp);
    return { kind: 'ground', global: { x: g.x, y: g.y }, label: null, probes, ms: 0 };
  };

  function pick(cx: number, cy: number, fresh: boolean): PickResult {
    const t0 = performance.now();
    const ctx = rt.frame.ctx();
    const key = `${ctx?.frameNo ?? -1}:${Math.round(cx)}:${Math.round(cy)}`;
    if (!fresh && cache?.key === key) return cache.res;
    const w2g = chainMatrix(world);
    let best: Hit | null = null;
    let probes = 0;
    if (ctx && w2g) {
      const pairs = gather(cx, cy, ctx.frameNo, false);
      for (let k = 0; k < pairs.length && !best; k += BATCH) {
        const batch = pairs.slice(k, k + BATCH);
        const tex = batch.map((p) => texelAt(p, cx, cy));
        const req: Texel[] = [];
        for (const t of tex) if (t && t !== 'opaque') req.push(t);
        const got = req.length ? probe.readNow(req) : [];
        let j = 0;
        const hit = tex.findIndex((t) => (t === 'opaque' ? true : t ? got[j++]! >= ALPHA_MIN : false));
        probes += batch.length;
        if (hit >= 0) best = hitOf(batch[hit]!.c);
      }
    }
    const res = best && w2g ? billboard(best, w2g, probes) : groundAt(cx, cy, w2g, probes);
    res.ms = performance.now() - t0;
    tapRing.add(res.ms);
    cache = { key, res };
    return res;
  }

  // Hover, at most once per frame on the latest point: texels in draw order up to the first untextured leaf, one
  // async read for all of them. The first texel at ALPHA_MIN wins, else that leaf, else the ground.
  function hoverPick(cx: number, cy: number): void {
    const ctx = rt.frame.ctx();
    if (!ctx) { settled = null; return; }
    const texels: Texel[] = [], hits: Hit[] = [];
    let fallback: Hit | null = null;
    let lastC: Cand | null = null, lastHit: Hit | null = null;
    const hitFor = (c: Cand): Hit => { if (c !== lastC) { lastC = c; lastHit = hitOf(c); } return lastHit!; };
    const t0 = performance.now();
    const pairs = gather(cx, cy, ctx.frameNo, true);
    const t1 = performance.now();
    for (const p of pairs) {
      if (texels.length >= PROBE_W) break;
      const t = texelAt(p, cx, cy);
      if (t === 'opaque') { fallback = hitFor(p.c); break; }
      if (t) { texels.push(t); hits.push(hitFor(p.c)); }
    }
    const t2 = performance.now();
    parts.n++; parts.gather += t1 - t0; parts.texel += t2 - t1; parts.texels += texels.length;
    if (!texels.length) { settled = fallback; return; }
    const settle = (a: number[]): void => { const i = a.findIndex((v) => v >= ALPHA_MIN); settled = i >= 0 ? hits[i]! : fallback; };
    if (!probe.readLater(texels, (a) => { asyncReads++; settle(a); })) settle(probe.readNow(texels));
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
    hover(cx, cy) {
      if (pendingPt) { pendingPt.x = cx; pendingPt.y = cy; } else pendingPt = { x: cx, y: cy };
      const w2g = chainMatrix(world);
      return settled && w2g ? billboard(settled, w2g, 0) : groundAt(cx, cy, w2g, 0);
    },
    stats: () => ({
      picks: hoverRing.n, avgMs: hoverRing.avg(), p95Ms: hoverRing.p95(),
      taps: tapRing.n, tapAvgMs: tapRing.avg(), tapP95Ms: tapRing.p95(), asyncReads, parts: { ...parts },
    }),
    destroy() { offPost(); offExit(); probe.destroy(); },
  };
}
