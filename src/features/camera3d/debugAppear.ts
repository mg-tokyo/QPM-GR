import { nearCamera, type FrameCtx } from './frame/frame';
import { groundRay, project, type Basis, type XY } from './math/camera';
import type { Runtime } from './runtime';
import { WALL_COLS, WALL_ROWS } from './scene/wallGeom';
import type { Node3 } from './types';

export type AppearKind = 'tile' | 'card' | 'other';
export interface AppearSample { kind: AppearKind; label: string; px: number; py: number; frame: number }
/** count: QPM-culled items (game tiles, QPM decor cards and fence strips) that became drawn with their point on screen
 * this frame and the frame before (late). entered: the point only came onto the screen this frame (a cull against the
 * exact screen shows an item the frame it reaches it). others: late entities the game also hides itself (pets, avatars,
 * buildings past the Detail reach). near / spawned / switches: next to the lens, added to World, a wall changing mesh. */
export interface AppearStats { count: number; entered: number; others: number; near: number; spawned: number; switches: number; frames: number; cuts: number; samples: AppearSample[] }

const MAX_SAMPLES = 24;
const empty = (): AppearStats => ({ count: 0, entered: 0, others: 0, near: 0, spawned: 0, switches: 0, frames: 0, cuts: 0, samples: [] });

export const onScreenPoint = (px: number, py: number, W: number, H: number): boolean => px >= 0 && px <= W && py >= 0 && py <= H;

/** Where the world point now drawn at (px, py), camera depth cz, was on screen under the previous camera (out: x, y, depth). */
export function screenBefore(cur: Basis, prev: Basis, px: number, py: number, cz: number, out: number[]): void {
  const a = ((px - cur.cx0) * cz) / cur.fpx, c = ((cur.cy0 - py) * cz) / cur.fpx;
  project(prev, cur.C[0] + cur.F[0] * cz + cur.R[0] * a + cur.U[0] * c, cur.C[1] + cur.F[1] * cz + cur.U[1] * c, cur.C[2] + cur.F[2] * cz + cur.R[2] * a + cur.U[2] * c, out);
}

/** Compares each frame's drawn set with the previous frame's. */
export class AppearTracker {
  private prev = new Set<object>();
  private cur = new Set<object>();
  private prevKeys = new Set<number>();
  private curKeys = new Set<number>();
  private last = NaN;
  private valid = false;
  private s = empty();

  /** False when there is no previous frame to compare with: the first frame, a frame-number gap, a camera cut. */
  begin(frameNo: number, cut: boolean): boolean {
    const p = this.prev; this.prev = this.cur; this.cur = p; this.cur.clear();
    const k = this.prevKeys; this.prevKeys = this.curKeys; this.curKeys = k; this.curKeys.clear();
    this.valid = !cut && frameNo === this.last + 1;
    if (!this.valid && !Number.isNaN(this.last)) this.s.cuts++;
    this.last = frameNo;
    this.s.frames++;
    return this.valid;
  }

  /** Records a drawn node (key: a perspective quad's depth key, for the switch check); true when it was not drawn last
   * frame. */
  seen(node: object, key?: number): boolean {
    this.cur.add(node);
    if (key !== undefined) this.curKeys.add(key);
    return this.valid && !this.prev.has(node);
  }

  /** A node seen() as new, at screen point (px, py); wasOn: that point was on screen last frame too. */
  appeared(kind: AppearKind, label: string, px: number, py: number, onScreen: boolean, near: boolean, spawned: boolean, key?: number, wasOn = true): void {
    if (!onScreen) return;
    const s = this.s;
    if (near) { s.near++; return; }
    if (spawned) { s.spawned++; return; }
    // A wall's strip takes over from its perspective quad (same depth key last frame): not a pop-in. Only quads record
    // keys: a straight run of walls shares one key at a cardinal yaw, so strip keys would hide strip pop-ins.
    if (key !== undefined && this.prevKeys.has(key)) { s.switches++; return; }
    if (!wasOn) { s.entered++; return; }
    if (kind === 'other') s.others++; else s.count++;
    if (s.samples.length < MAX_SAMPLES) s.samples.push({ kind, label, px: Math.round(px), py: Math.round(py), frame: this.last });
  }

  reset(): void { this.last = NaN; }
  count(): number { return this.s.count; }
  entered(): number { return this.s.entered; }
  read(): AppearStats { const s = this.s; this.s = empty(); return s; }
}

// Labels QPM gives its own World cards (scene/decor.ts build(), scene/fences.ts own()).
const DECOR_LABEL = 'qpm3d-decor';
const FENCE_LABEL = 'qpm3d-fence';
// A camera move past these between two frames is a cut (a bench pose change), not motion.
const CUT_PX = 1536;
const CUT_YAW = (20 * Math.PI) / 180;
// A fence strip's middle ground vertex (scene/wallGeom.ts projectStrip: screen px, row-major, ground row last).
const STRIP_FOOT = WALL_COLS / 2 + WALL_ROWS * (WALL_COLS + 1);

/** dx/dz: camera move since the last frame (NaN without one). Yaw wraps at ±π (viewForS wrapDeg). */
export function cameraCut(dx: number, dz: number, yaw: number, lastYaw: number): boolean {
  let dyaw = Math.abs(yaw - lastYaw) % (2 * Math.PI);
  if (dyaw > Math.PI) dyaw = 2 * Math.PI - dyaw;
  return !(dx * dx + dz * dz <= CUT_PX * CUT_PX && dyaw <= CUT_YAW);
}

let tracker: AppearTracker | null = null;
const getTracker = (): AppearTracker => (tracker ??= new AppearTracker());

/** Totals since the last read, then reset. */
export const firstAppear = (): AppearStats => getTracker().read();
export const appearCount = (): number => getTracker().count();
export const appearEntered = (): number => getTracker().entered();

/** For one perf() window: checks every 3D frame's drawn entities and QPM cards. onCost gets the probe's own ms, so the
 * caller keeps it out of the frame times. Returns the uninstall. */
export function installAppearProbe(rt: Runtime, onCost: (ms: number) => void): () => void {
  const t = getTracker();
  t.reset();
  const world = rt.caps.scene.world;
  const spawned = new WeakSet<object>();
  const cards: Node3[] = [];
  let cardsFor = -1, cardsDirty = true;
  const onAdd = (child: unknown): void => { cardsDirty = true; if (child !== null && typeof child === 'object') spawned.add(child); };
  const onRemove = (): void => { cardsDirty = true; };
  world.on?.('childAdded', onAdd);
  world.on?.('childRemoved', onRemove);
  let lx = NaN, lz = NaN, lyaw = NaN;
  // The previous frame's camera: was an appearing point already on screen under it? (AppearStats count vs entered)
  const prev: Basis = { F: [0, 0, 0], R: [0, 0, 0], U: [0, 0, 0], C: [0, 0, 0], fpx: 1, cx0: 0, cy0: 0 };
  const o = [0, 0, 0];
  let cur = prev, sw = 0, sh = 0, near = 0;
  const wasOn = (): boolean => o[2]! >= near && onScreenPoint(o[0]!, o[1]!, sw, sh);
  const drawnWasOn = (px: number, py: number, cz: number): boolean => { screenBefore(cur, prev, px, py, cz, o); return wasOn(); };
  // A card's foot and a strip's foot row lie on the ground: g, that ground point (null: none, counted as on before).
  const groundWasOn = (g: XY | null): boolean => {
    if (!g) return true;
    project(prev, g.x, 0, g.y, o);
    return wasOn();
  };

  const checkCards = (ctx: FrameCtx): void => {
    const { W, H } = ctx;
    // The length check covers a World without child events.
    if (cardsDirty || world.children.length !== cardsFor) {
      cardsDirty = false;
      cardsFor = world.children.length;
      cards.length = 0;
      for (const c of world.children) if (c.label === DECOR_LABEL || c.label === FENCE_LABEL) cards.push(c);
    }
    for (const c of cards) {
      if (c.destroyed === true || c.parent !== world || !rt.ov.raw<boolean>('visible', c) || c.scale.x === 0) continue;
      if (c.label === DECOR_LABEL) {
        if (!t.seen(c)) continue;
        // Its position is the projected foot (decor.ts pre()); near the lens by ground distance, as decor culls it.
        const on = onScreenPoint(c.x, c.y, W, H);
        const g = on ? groundRay(cur, c.x, c.y) : null;
        t.appeared('card', DECOR_LABEL, c.x, c.y, on, g !== null && nearCamera(ctx, g.x, g.y), spawned.has(c), undefined, groundWasOn(g));
        continue;
      }
      const pos = (c.geometry as { positions?: unknown } | null | undefined)?.positions;
      // A perspective quad (no screen-space positions) only draws next to the lens: recorded for the switch check only.
      if (!(pos instanceof Float32Array)) { t.seen(c, c.zIndex); continue; }
      if (!t.seen(c)) continue;
      const px = pos[2 * STRIP_FOOT] ?? NaN, py = pos[2 * STRIP_FOOT + 1] ?? NaN;
      const on = onScreenPoint(px, py, W, H);
      t.appeared('card', FENCE_LABEL, px, py, on, false, spawned.has(c), c.zIndex, groundWasOn(on ? groundRay(cur, px, py) : null));
    }
  };

  const off = rt.onFrame(() => {
    const t0 = performance.now();
    const ctx = rt.frame.ctx();
    if (!ctx) return;
    const C = ctx.basis.C, yaw = ctx.params.yaw;
    const cut = cameraCut(C[0]! - lx, C[2]! - lz, yaw, lyaw);
    lx = C[0]!; lz = C[2]!; lyaw = yaw;
    t.begin(ctx.frameNo, cut);
    const { W, H } = ctx;
    cur = ctx.basis; sw = W; sh = H; near = ctx.params.near;
    const tab = rt.frame.published();
    for (let i = 0; i < tab.len; i++) {
      const e = tab.entries[i]!;
      if (!t.seen(e.node) || e.node === ctx.avatar) continue;
      const label = e.node.label ?? '';
      const on = onScreenPoint(e.px, e.py, W, H);
      t.appeared(label.startsWith('Tile (') ? 'tile' : 'other', label, e.px, e.py, on, nearCamera(ctx, e.x, e.y), spawned.has(e.node), undefined, on && drawnWasOn(e.px, e.py, ctx.basis.fpx / e.mm));
    }
    checkCards(ctx);
    for (let i = 0; i < 3; i++) { prev.F[i] = cur.F[i]!; prev.R[i] = cur.R[i]!; prev.U[i] = cur.U[i]!; prev.C[i] = cur.C[i]!; }
    prev.fpx = cur.fpx; prev.cx0 = cur.cx0; prev.cy0 = cur.cy0;
    onCost(performance.now() - t0);
  });
  return () => { off(); world.off?.('childAdded', onAdd); world.off?.('childRemoved', onRemove); };
}
