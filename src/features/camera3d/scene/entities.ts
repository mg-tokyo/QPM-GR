import { project } from '../math/camera';
import { SCRIM_Z, depthKey, sortYOf, standLine, stickyQuantize, tiebreakOf } from '../math/depth';
import { cullSlot, nearCamera, recheck, type FrameCtx, type Pass } from '../frame/frame';
import type { Node3 } from '../types';

const AVATAR_UPPER = 0.6 * 256;

/** standY: the ground row the card stands on; artY (default standY): the art row that touches the ground there. */
export interface PlaceOpts { isTile: boolean; standY: number; artY?: number; depthY: number; tiebreak: number; artRow: boolean }
/** gdy: ground row minus art row (a lifted slot moves with its card). */
export interface Placement { sx: number; sy: number; px: number; mm: number; fx: number; x2d: number; fy2d: number; key: number; gdy: number }
export type PlaceFn = (ctx: FrameCtx, node: Node3, o: PlaceOpts, lp: Placement) => number | null;
export interface BuildingPlacer { place(ctx: FrameCtx, buildings: Node3[], place: PlaceFn): void; drop(): void }
export interface LayerHandler {
  adopt(ctx: FrameCtx): void;
  isLayerNode(n: Node3): boolean;
  /** Detached from an overlay layer (or a child of such a node): the polaroid, a thought bubble. */
  isOverlayNode(n: Node3): boolean;
  placeMarker(ctx: FrameCtx, n: Node3): void;
  /** A tile of a game area indicator (areaMarks.ts), drawn flat by the ground layer: not part of its owner's card. */
  isAreaMark(n: Node3): boolean;
  /** The owner was placed as a billboard: lay its area indicators on their tiles. */
  layAreas(ctx: FrameCtx, owner: Node3, lp: Placement): void;
  /** After the World pass: hide area marks whose owner was not drawn this frame. */
  finishAreas(ctx: FrameCtx): void;
  stats(): Record<string, number>;
  drop(): void;
}
/** The local avatar's hand in 3D (D17, scene/viewmodel.ts). */
export interface HeldHandler {
  /** Once per frame, before the World walk: finds the hand and its area indicator. */
  begin(ctx: FrameCtx): void;
  /** First person: pins the hand in its screen corner and lays its area tiles. False: unavailable, hide the whole
   * avatar as before (its area marks are then pinned invisible by finishAreas). */
  firstPerson(ctx: FrameCtx, avatar: Node3): boolean;
  /** Not first person: undo the first-person overrides. */
  release(ctx: FrameCtx): void;
  drop(): void;
  stats(): Record<string, number | string | boolean>;
}
export interface EntityDeps {
  skip: WeakSet<Node3>;
  buildings: BuildingPlacer | null;
  layers: LayerHandler | null;
  /** Ground row (2D world y) a non-building entity stands on; null: its sort y. */
  standRow: ((ctx: FrameCtx, node: Node3, sortY: number, isTile: boolean) => number) | null;
  afterPlace: ((ctx: FrameCtx, node: Node3, lp: Placement, standY: number) => void) | null;
  /** Near-camera fade of a placed billboard (ground point gx, gy). */
  fade: ((ctx: FrameCtx, node: Node3, key: number, gx: number, gy: number) => void) | null;
  placeMask: ((ctx: FrameCtx, owner: Node3, lp: Placement) => void) | null;
  held: HeldHandler | null;
}

export const newPlacement = (): Placement => ({ sx: 0, sy: 0, px: 0, mm: 1, fx: 0, x2d: 0, fy2d: 0, key: 0, gdy: 0 });

interface Hold { orig: (...a: unknown[]) => unknown; frame: number; x: number; y: number; sx: number; sy: number }
const holds = new Map<Node3, Hold>();
let currentFrame = -1;

// A node with a game onRender hook (Rive layout) is re-laid out inside the render, after pre(): re-apply our
// transform after the game's hook for the current frame only.
export function holdThroughOnRender(ctx: FrameCtx, nd: Node3, x: number, y: number, sx: number, sy: number): void {
  const existing = holds.get(nd);
  if (!existing) {
    const orig = nd._onRender;
    if (!orig) return;
    const h: Hold = { orig, frame: -1, x: 0, y: 0, sx: 1, sy: 1 };
    holds.set(nd, h);
    nd.onRender = function (this: unknown, ...a: unknown[]): unknown {
      const r = h.orig.apply(this, a);
      if (h.frame === currentFrame) { nd.position.set(h.x, h.y); nd.scale.set(h.sx, h.sy); }
      return r;
    };
  }
  const h = holds.get(nd)!;
  h.frame = ctx.frameNo; h.x = x; h.y = y; h.sx = sx; h.sy = sy;
}

function unhookAll(): void {
  for (const [nd, h] of holds) if (!nd.destroyed) nd.onRender = h.orig;
  holds.clear();
}

/** Ground point (gx, gy) projected to (sx, sy, cz): inside the view plus the cull margins. */
const inView = (ctx: FrameCtx, gx: number, gy: number, sx: number, sy: number, cz: number): boolean =>
  nearCamera(ctx, gx, gy) || !(cz < ctx.params.near || cz > ctx.params.far || sx < -ctx.marginX || sx > ctx.W + ctx.marginX || sy < -ctx.marginTop || sy > ctx.H + 1200);

/** Projects one node as a billboard. Returns its depth key, or null when it is not drawn this frame. */
export const placeBillboard: PlaceFn = (ctx, nd, o, lp) => {
  const { basis: b, out, ov } = ctx;
  const osx = nd.scale.x, osy = nd.scale.y, nx = nd.x, ny = nd.y;
  const tex = nd.texture, anc = nd.anchor;
  const off = tex && anc ? (0.5 - anc.x) * tex.orig.width * osx : 0;
  const fx = nx + off;
  project(b, fx, 0, o.standY, out);
  const sx = out[0]!, sy0 = out[1]!, cz = out[2]!;
  if (recheck(ctx, cullSlot(nx, ny))) {
    if (!inView(ctx, fx, o.standY, sx, sy0, cz)) { ov.put('visible', nd, false); return null; }
    // Pinned: past the Detail radius the game's own tile cull hides tiles again as its view moves (live 2026-10-03:
    // 28 of 30 on-screen tile pop-ins in a walk).
    if (o.isTile) ov.put('visible', nd, true, true);
    else ov.drop('visible', nd);
  }
  if (!ov.raw<boolean>('visible', nd)) return null;
  if (cz < ctx.params.near) {
    ctx.saves.save(nd);
    nd.scale.set(0, 0);
    nd.position.set(-1e5, -1e5);
    return null;
  }
  const mm = b.fpx / cz;
  const px = sx - off * mm;
  // Art-row formula (spec §6.3): art row artY touches the ground at depth standY; exact 2D when straight down.
  const artY = o.artY ?? o.standY;
  const sy = o.artRow ? sy0 - (artY - ny) * mm : sy0;
  const key = depthKey(fx, o.depthY, ctx.dx, ctx.dz, o.tiebreak);
  ctx.drawn.push(nd, nx, ny, osx, osy, px, sy, mm);
  nd.position.set(px, sy);
  nd.scale.set(osx * mm, osy * mm);
  holdThroughOnRender(ctx, nd, px, sy, osx * mm, osy * mm);
  ov.put('zIndex', nd, key);
  lp.sx = sx; lp.sy = sy; lp.px = px; lp.mm = mm; lp.fx = fx; lp.x2d = nx; lp.fy2d = ny; lp.key = key; lp.gdy = o.standY - artY;
  return key;
};

export function createEntityPass(deps: EntityDeps): Pass {
  const sticky = new WeakMap<Node3, number>();
  const lp = newPlacement();
  let selfHidden: Node3 | null = null;
  let shown = 0;

  const isScrim = (ctx: FrameCtx, e: Node3): boolean => e.texture === ctx.caps.classes.Texture.WHITE && e.children.length === 0;

  // Rain's above-ground tint (a WHITE sprite the game sizes to its 2D view): from the horizon line down, under
  // every billboard.
  function placeScrim(ctx: FrameCtx, e: Node3): void {
    const yh = Math.min(ctx.H, Math.max(0, ctx.basis.cy0 - ctx.basis.fpx * Math.tan(ctx.params.pitch)));
    ctx.saves.save(e);
    e.pivot.set(0, 0); e.rotation = 0; e.skew.set(0, 0);
    e.position.set(0, yh);
    e.scale.set(ctx.W, ctx.H - yh);
    ctx.ov.put('zIndex', e, SCRIM_Z);
  }

  function placeEntity(ctx: FrameCtx, e: Node3): number | null {
    if (e === ctx.avatar) {
      if (ctx.hideSelf) {
        if (deps.held?.firstPerson(ctx, e)) { selfHidden = null; return null; }
        ctx.ov.put('visible', e, false); selfHidden = e; return null;
      }
      deps.held?.release(ctx);
      if (selfHidden === e) { ctx.ov.drop('visible', e); selfHidden = null; }
    }
    // Between its re-checks a culled (or game-hidden) entity stays undrawn: placeBillboard would return null, after
    // the stand row and the projection.
    const check = recheck(ctx, cullSlot(e.x, e.y));
    if (!check && !ctx.ov.raw<boolean>('visible', e)) return null;
    const gz = ctx.ov.gameValue<number>('zIndex', e);
    const sortY = sortYOf(gz, e.y);
    // Culled at its sort y before the stand row, which scans the entity (lift.ts): every re-check of a culled tile paid
    // that scan (live 2026-10-03: +0.37 ms per rolling frame). The stand row is under a tile off, inside the margins.
    if (check) {
      project(ctx.basis, e.x, 0, sortY, ctx.out);
      if (!inView(ctx, e.x, sortY, ctx.out[0]!, ctx.out[1]!, ctx.out[2]!)) { ctx.ov.put('visible', e, false); return null; }
    }
    const isTile = (e.label ?? '').startsWith('Tile (');
    const standY = deps.standRow ? deps.standRow(ctx, e, sortY, isTile) : sortY;
    // Tile art bottoms sit 20–113 px south of the tile centre (live 2026-10-03), so a card standing there looks off its
    // tile once turned: tilted, it stands on the centre (its sort y) with that art row on the ground.
    const groundY = isTile ? standLine(standY, sortY, ctx.params.pitch) : standY;
    // Exact game sort y straight down (s = 0 order); tilted, the row the card stands on (smooth for a walking avatar).
    let depthY = sortY;
    if (!ctx.exactKeys) { depthY = stickyQuantize(sticky.get(e), groundY); sticky.set(e, depthY); }
    const key = placeBillboard(ctx, e, { isTile, standY: groundY, artY: standY, depthY, tiebreak: tiebreakOf(gz), artRow: true }, lp);
    if (key === null) return null;
    shown++;
    if (e.mask && deps.placeMask) deps.placeMask(ctx, e, lp);
    if (e === ctx.avatar) {
      ctx.avatarKey = key;
      project(ctx.basis, lp.fx, AVATAR_UPPER, standY, ctx.out); // e.x is already the screen x here
      ctx.avatarUpper = { x: ctx.out[0]!, y: ctx.out[1]! };
    }
    deps.afterPlace?.(ctx, e, lp, standY);
    deps.layers?.layAreas(ctx, e, lp);
    // The over-the-shoulder camera sits ~90 px from its own avatar (s 0.92): never fade the followed avatar.
    if (deps.fade && e !== ctx.avatar) deps.fade(ctx, e, key, lp.fx, groundY);
    return key;
  }

  /** Returns the depth key the node was drawn at (null: not drawn as a billboard). */
  function visit(ctx: FrameCtx, e: Node3, blds: Node3[]): number | null {
    if (deps.skip.has(e) || e.renderLayerChildren) return null;
    if (isScrim(ctx, e)) { placeScrim(ctx, e); return null; }
    if (e.includeInBuild === false) return null; // mask graphics: moved with their owner
    if (e.x === 0 && e.y === 0) {
      if ((e.label ?? '').startsWith('Building')) { blds.push(e); return null; }
      if (e.children.length > 0 && !e.texture) {
        const layerGroup = deps.layers?.isLayerNode(e) ?? false;
        let top: number | null = null;
        for (const c of e.children) {
          if (layerGroup && deps.layers) { deps.layers.placeMarker(ctx, c); continue; }
          const k = visit(ctx, c, blds);
          if (k !== null && (top === null || k > top)) top = k;
        }
        // Children sort inside the group, the group at its own World slot: tilted, that slot is its frontmost child
        // (JournalTags tags, a ridden pet). Straight down the game's slot keeps the 2D order.
        if (!layerGroup && e.parent === ctx.caps.scene.world) {
          if (top !== null && !ctx.exactKeys) ctx.ov.put('zIndex', e, top);
          else ctx.ov.drop('zIndex', e);
        }
        return top;
      }
      if (!e.texture) {
        // (0,0) empty container (an idle RiddenPetVisual): left as is (spec §6.1), so it shows its children as soon
        // as the game gives it some. A (0,0) leaf that draws 2D geometry cannot be placed, so it is hidden.
        if (e.geometry || e.context) ctx.ov.put('visible', e, false);
        return null;
      }
    }
    if (deps.layers?.isLayerNode(e)) { deps.layers.placeMarker(ctx, e); return null; }
    return placeEntity(ctx, e);
  }

  return {
    name: 'entities',
    pre(ctx) {
      currentFrame = ctx.frameNo;
      shown = 0;
      deps.held?.begin(ctx);
      deps.layers?.adopt(ctx);
      const blds: Node3[] = [];
      for (const e of ctx.caps.scene.world.children) visit(ctx, e, blds);
      if (deps.buildings) deps.buildings.place(ctx, blds, placeBillboard);
      else for (const b of blds) ctx.ov.put('visible', b, false);
      deps.layers?.finishAreas(ctx);
    },
    drop() {
      unhookAll();
      deps.layers?.drop();
      deps.buildings?.drop();
      deps.held?.drop();
      selfHidden = null;
    },
    destroy() { unhookAll(); },
    stats: () => ({ shown, holds: holds.size, ...deps.layers?.stats(), ...deps.held?.stats() }),
  };
}
