import { TILE } from '../constants';
import { project } from '../math/camera';
import { BASE_LAYER, SCRIM_Z, bandOf, depthKeyAlong, layerOf, quantizeAlong, sortYOf, standLine, tiebreakOf, tiltedTiebreak } from '../math/depth';
import { MOVE_PX, MoveCheck, cullSlot, mayBeSeen, recheck, ringDue, type FrameCtx, type Pass } from '../frame/frame';
import type { Node3 } from '../types';
import { ART_REACH, GameCull } from './gameCull';
import { StillTiles, type TileRec } from './stillTiles';

const AVATAR_UPPER = 0.6 * TILE;

/** standY: the ground row the card stands on; artY (default standY): the art row that touches the ground there.
 * force: re-decide visibility now (a walker that moved). quantize: the depth key moves in 32 px steps. dx, dy: the
 * ground point and depth moved by this, the art kept on it (your own avatar on the follow point, P16 a). */
export interface PlaceOpts {
  isTile: boolean; standY: number; artY?: number; depthY: number; tiebreak: number; artRow: boolean;
  force?: boolean; quantize?: boolean; dx?: number; dy?: number;
}
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
  /** Forgets destroyed nodes it holds detached from their layers (A R4). */
  prune(): void;
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
  /** Not first person: your own body's alpha during the push-in (P2 a); 1 hands it back. */
  fadeSelf(ctx: FrameCtx, avatar: Node3, alpha: number): void;
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
  /** An avatar's feet above its ground as drawn (bench, saddle, peek lift), from its stand row this frame. */
  feetHeight?: ((node: Node3) => number) | null;
  /** Your own avatar or its mount (asked after its stand row): drawn moved by ctx.selfShift. */
  isSelf?: ((ctx: FrameCtx, node: Node3) => boolean) | null;
  /** A tile's stand-row input as a token (lift.ts scanOf): a new one re-places it. Absent: tiles never replay. */
  standKey?: ((ctx: FrameCtx, node: Node3) => unknown) | null;
  /** Mid-fade: a replayed tile still gets its fade. Absent: always faded. */
  isFading?: ((ctx: FrameCtx, node: Node3) => boolean) | null;
}

export const newPlacement = (): Placement => ({ sx: 0, sy: 0, px: 0, mm: 1, fx: 0, x2d: 0, fy2d: 0, key: 0, gdy: 0 });

type Hook = (...a: unknown[]) => unknown;
interface Hold { orig: Hook; wrap: Hook; frame: number; x: number; y: number; sx: number; sy: number }
const holds = new Map<Node3, Hold>();
let currentFrame = -1;
// The entity pass's cull while it runs (buildings place through placeBillboard too); never begun: flips at once.
const IMMEDIATE = new GameCull();
let cull = IMMEDIATE;

// A node with a game onRender hook (Rive layout) is re-laid out inside the render, after pre(): re-apply our
// transform after the game's hook for the current frame only. A hook the game replaced is wrapped afresh.
export function holdThroughOnRender(ctx: FrameCtx, nd: Node3, x: number, y: number, sx: number, sy: number): void {
  let h = holds.get(nd);
  if (!h || nd._onRender !== h.wrap) {
    const orig = nd._onRender;
    if (!orig) { holds.delete(nd); return; }
    const hold: Hold = {
      orig, frame: -1, x: 0, y: 0, sx: 1, sy: 1,
      wrap(this: unknown, ...a: unknown[]): unknown {
        const r = hold.orig.apply(this, a);
        if (hold.frame === currentFrame) { nd.position.set(hold.x, hold.y); nd.scale.set(hold.sx, hold.sy); }
        return r;
      },
    };
    holds.set(nd, hold);
    nd.onRender = hold.wrap;
    h = hold;
  }
  h.frame = ctx.frameNo; h.x = x; h.y = y; h.sx = sx; h.sy = sy;
}

// Only a hook that is still ours goes back: one the game set since is newer than our saved one.
function unhook(nd: Node3, h: Hold): void { if (!nd.destroyed && nd._onRender === h.wrap) nd.onRender = h.orig; }
function unhookAll(): void {
  for (const [nd, h] of holds) unhook(nd, h);
  holds.clear();
}
/** A despawned (destroyed or detached) node's hold goes now, not on exit (A R4). */
function pruneHolds(): void {
  for (const [nd, h] of holds) if (nd.destroyed === true || !nd.parent) { unhook(nd, h); holds.delete(nd); }
}

// A walker moves itself up to MOVE_PX (Manhattan) before MoveCheck re-checks it, plus that frame's step.
const WALKER_PX = 2 * MOVE_PX;

/** Ground point (gx, gy) of node nd projected to (sx, sy, cz): may be on screen before its next re-check (frame/cull.ts).
 * Its art reaches ART_REACH from the foot, or a textured leaf's own size if larger (a building piece, centred on its
 * foot; dy: its art row's offset). extra: world px the item may move itself meanwhile. */
function inView(ctx: FrameCtx, nd: Node3, gx: number, gy: number, sx: number, sy: number, cz: number, dy: number, extra: number): boolean {
  const tex = nd.texture;
  const tw = tex ? (tex.orig.width * Math.abs(nd.scale.x)) / 2 : 0, th = tex ? tex.orig.height * Math.abs(nd.scale.y) + Math.abs(dy) : 0;
  return mayBeSeen(ctx, gx, gy, sx, sy, cz, Math.max(ART_REACH.side, tw), Math.max(ART_REACH.up, th), Math.max(ART_REACH.down, th), extra, false);
}

/** Projects one node as a billboard. Returns its depth key, or null when it is not drawn this frame. */
export const placeBillboard: PlaceFn = (ctx, nd, o, lp) => {
  const { basis: b, out, ov } = ctx;
  const osx = nd.scale.x, osy = nd.scale.y, nx = nd.x, ny = nd.y;
  const tex = nd.texture, anc = nd.anchor;
  const off = tex && anc ? (0.5 - anc.x) * tex.orig.width * osx : 0;
  const fx = nx + off + (o.dx ?? 0);
  const dy = o.dy ?? 0, gy = o.standY + dy;
  project(b, fx, 0, gy, out);
  const sx = out[0]!, sy0 = out[1]!, cz = out[2]!;
  if (o.force || recheck(ctx, cullSlot(nx, ny)) || ringDue(ctx, fx, gy)) {
    if (!inView(ctx, nd, fx, gy, sx, sy0, cz, (o.artY ?? o.standY) - ny, o.isTile ? 0 : WALKER_PX)) { cull.cull(ctx, nd); return null; }
    // Pinned: past the Detail radius the game's own tile cull hides tiles again as its view moves (live 2026-10-03:
    // 28 of 30 on-screen tile pop-ins in a walk).
    if (!cull.show(ctx, nd, o.isTile, sx, sy0, cz)) return null;
  } else if (cull.isWaiting(nd) && !cull.show(ctx, nd, o.isTile, sx, sy0, cz)) return null;
  if (!ov.raw<boolean>('visible', nd) || cull.isParked(ctx, nd)) return null;
  if (cz < ctx.params.near) {
    // Tile views stay parked across frames (persist.ts); anything else is saved and restored each frame.
    if (!o.isTile || !ctx.persist.apply(nd, -1e5, -1e5, 0, 0)) {
      ctx.saves.save(nd);
      nd.scale.set(0, 0);
      nd.position.set(-1e5, -1e5);
    }
    return null;
  }
  const mm = b.fpx / cz;
  const px = sx - off * mm;
  // Art-row formula (spec §6.3): art row artY touches the ground at depth standY; exact 2D when straight down.
  const artY = o.artY ?? o.standY;
  const sy = o.artRow ? sy0 - (artY - ny) * mm : sy0;
  // Quantized on the projected scalar, not on y alone: at any non-cardinal yaw a raw fx·dx term gave every moving walker
  // and pet a new key, so a World re-sort, each frame (A PF2).
  const along = fx * ctx.dx + (o.depthY + dy) * ctx.dz;
  const key = depthKeyAlong(o.quantize ? quantizeAlong(along) : along, o.tiebreak);
  // Walkers and buildings are set and restored each frame: the game moves them anyway (perf Task 3, PC1).
  const held = o.isTile && ctx.persist.apply(nd, px, sy, osx * mm, osy * mm);
  if (!held) { nd.position.set(px, sy); nd.scale.set(osx * mm, osy * mm); }
  ctx.drawn.push(nd, nx, ny, osx, osy, px, sy, mm, held);
  holdThroughOnRender(ctx, nd, px, sy, osx * mm, osy * mm);
  ov.put('zIndex', nd, key);
  lp.sx = sx; lp.sy = sy; lp.px = px; lp.mm = mm; lp.fx = fx; lp.x2d = nx; lp.fy2d = ny; lp.key = key; lp.gdy = o.standY - artY;
  return key;
};

export function createEntityPass(deps: EntityDeps): Pass {
  const movers = new MoveCheck();
  const lp = newPlacement();
  // One options record for every billboard: a literal per call was an object per entity per frame (A PF4).
  const po: PlaceOpts = { isTile: false, standY: 0, artY: 0, depthY: 0, tiebreak: 0, artRow: true, force: false, quantize: false, dx: 0, dy: 0 };
  const blds: Node3[] = [];
  const avatarGround = { x: 0, y: 0 };
  const gameCull = new GameCull();
  const still = new StillTiles();
  let selfHidden: Node3 | null = null;
  let shown = 0, replayed = 0;

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

  // Perf Task 4 (A PA3): a held tile view on a still camera, unchanged since last frame, is drawn from its record. The
  // persist tick covers its transform, alpha and visible; per-frame saves (lifts, areas, masks) and fades still run.
  function replay(ctx: FrameCtx, e: Node3, r: TileRec): boolean {
    if (r.frame !== ctx.frameNo - 1 || recheck(ctx, r.slot) || e.label !== r.label || e._onRender) return false;
    const tex = e.texture ?? null;
    if (ctx.ov.gameValue<number>('zIndex', e) !== r.gz || tex !== r.tex || (tex !== null && e.anchor?.x !== r.ax)) return false;
    if (!deps.standKey || deps.standKey(ctx, e) !== r.stand || !ctx.persist.keep(e)) return false;
    r.frame = ctx.frameNo;
    ctx.drawn.push(e, r.x, r.y, r.sx, r.sy, r.px, r.py, r.mm, true);
    shown++; replayed++;
    if (e.mask && deps.placeMask) deps.placeMask(ctx, e, r.lp);
    // As placeBillboard: afterPlace only raises the key (lifted produce), so a lift gone since must fall back to it.
    ctx.ov.put('zIndex', e, r.key);
    deps.afterPlace?.(ctx, e, r.lp, r.standY);
    deps.layers?.layAreas(ctx, e, r.lp);
    if (deps.fade && deps.isFading?.(ctx, e) !== false) deps.fade(ctx, e, r.key, r.lp.fx, r.groundY);
    return true;
  }

  function placeEntity(ctx: FrameCtx, e: Node3): number | null {
    if (ctx.camStill) {
      const r = still.get(e);
      if (r !== undefined && replay(ctx, e, r)) return r.key;
    }
    if (e === ctx.avatar) {
      if (ctx.hideSelf) {
        if (deps.held?.firstPerson(ctx, e)) { selfHidden = null; return null; }
        ctx.ov.put('visible', e, false); selfHidden = e; return null;
      }
      deps.held?.release(ctx);
      deps.held?.fadeSelf(ctx, e, ctx.selfAlpha);
      if (selfHidden === e) { ctx.ov.drop('visible', e); selfHidden = null; }
    }
    // Between its re-checks a culled (parked, or hidden and not waiting to show) or game-hidden entity stays undrawn:
    // placeBillboard would return null, after the stand row and the projection. Tiles never move; a walker is
    // re-checked once it has moved (MoveCheck); anything in the near ring on every moving frame.
    const isTile = (e.label ?? '').startsWith('Tile (');
    const t = ctx.target;
    const check = recheck(ctx, cullSlot(e.x, e.y)) || (!isTile && movers.due(e, e.x, e.y, t.x, t.y, ctx.cull.cap)) || ringDue(ctx, e.x, e.y);
    if (!check && (ctx.ov.raw<boolean>('visible', e) ? gameCull.isParked(ctx, e) : !gameCull.isWaiting(e))) return null;
    const gz = ctx.ov.gameValue<number>('zIndex', e);
    const sortY = sortYOf(gz, e.y);
    // Culled at its sort y before the stand row, which scans the entity (lift.ts): every re-check of a culled tile paid
    // that scan (live 2026-10-03: +0.37 ms per rolling frame). The stand row is under a tile off, inside the margins;
    // a hidden entity waiting to show pays it only once it may show (a tile of slack for the stand row).
    if (check) {
      if (!isTile) movers.note(e, e.x, e.y, t.x, t.y);
      project(ctx.basis, e.x, 0, sortY, ctx.out);
      // Extra slack for the foot placeBillboard tests: the stand row (a tile from the sort y at most) and, for a textured
      // leaf, its anchor offset.
      const tx = e.texture, anc = e.anchor;
      const off = tx && anc ? Math.abs((0.5 - anc.x) * tx.orig.width * e.scale.x) : 0;
      if (!inView(ctx, e, e.x, sortY, ctx.out[0]!, ctx.out[1]!, ctx.out[2]!, 0, (isTile ? 0 : WALKER_PX) + TILE + off)) { gameCull.cull(ctx, e); return null; }
    } else if (!ctx.ov.raw<boolean>('visible', e)) {
      project(ctx.basis, e.x, 0, sortY, ctx.out);
      if (!gameCull.canShow(ctx, ctx.out[0]!, ctx.out[1]!, ctx.out[2]!, TILE)) return null;
    }
    const standY = deps.standRow ? deps.standRow(ctx, e, sortY, isTile) : sortY;
    // P16 a: your avatar and its mount stand on the steady follow point; straight down (tilt 0) on the game's.
    let sdx = 0, sdy = 0;
    if (ctx.tilt > 0 && deps.isSelf?.(ctx, e)) { sdx = ctx.selfShift.x * ctx.tilt; sdy = ctx.selfShift.y * ctx.tilt; }
    // Tile art bottoms sit 20–113 px south of the tile centre (live 2026-10-03), so a card standing there looks off its
    // tile once turned: tilted, it stands on the centre (its sort y) with that art row on the ground.
    const groundY = isTile ? standLine(standY, sortY, ctx.params.pitch) : standY;
    // Exact game sort y (and the foremost band of an airborne rider) straight down (s = 0 order); tilted, the row the
    // card stands on (smooth for a walking avatar), so a building in front hides a flying rider as it does a walker.
    // Ground decor keeps its sort row: whatever stands on its tile (the centre) sorts over it, as in 2D.
    const depthY = ctx.exactKeys || (isTile && layerOf(sortY) === BASE_LAYER) ? sortY : groundY;
    const tiebreak = ctx.exactKeys ? tiebreakOf(gz) + bandOf(gz) : tiltedTiebreak(gz, sortY);
    po.isTile = isTile; po.standY = groundY; po.artY = standY; po.depthY = depthY; po.tiebreak = tiebreak; po.force = check; po.quantize = !ctx.exactKeys; po.dx = sdx; po.dy = sdy;
    const drawnAt = ctx.drawn.len;
    const key = placeBillboard(ctx, e, po, lp);
    if (key === null) return null;
    shown++;
    if (e.mask && deps.placeMask) deps.placeMask(ctx, e, lp);
    if (e === ctx.avatar) {
      ctx.avatarKey = key;
      // e.x is already the screen x here; the body point rises with the feet (bench, saddle).
      project(ctx.basis, lp.fx, AVATAR_UPPER + (deps.feetHeight?.(e) ?? 0), standY + sdy, ctx.out);
      ctx.avatarUpper = { x: ctx.out[0]!, y: ctx.out[1]! };
      avatarGround.x = lp.fx; avatarGround.y = groundY + sdy;
      ctx.avatarGround = avatarGround;
    }
    deps.afterPlace?.(ctx, e, lp, standY);
    deps.layers?.layAreas(ctx, e, lp);
    // The over-the-shoulder camera sits ~90 px from its own avatar (s 0.92): never fade the followed avatar.
    if (deps.fade && e !== ctx.avatar) deps.fade(ctx, e, key, lp.fx, groundY + sdy);
    // Recorded on a still frame only: a moving camera never replays, so it pays nothing for the records.
    if (isTile && ctx.camStill && deps.standKey && sdx === 0 && sdy === 0 && !e._onRender) {
      still.note(ctx, e, drawnAt, gz, deps.standKey(ctx, e), standY, groundY, key, lp);
    }
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
      shown = 0; replayed = 0;
      cull = gameCull;
      gameCull.begin(ctx);
      if (ctx.reCull || ctx.roll === 0) { pruneHolds(); gameCull.prune(ctx); deps.layers?.prune(); }
      deps.held?.begin(ctx);
      deps.layers?.adopt(ctx);
      blds.length = 0;
      try {
        for (const e of ctx.caps.scene.world.children) visit(ctx, e, blds);
        if (deps.buildings) deps.buildings.place(ctx, blds, placeBillboard);
        else for (const b of blds) ctx.ov.put('visible', b, false);
        deps.layers?.finishAreas(ctx);
        gameCull.end(ctx);
      } finally { cull = IMMEDIATE; }
    },
    drop() {
      unhookAll();
      gameCull.drop();
      still.drop();
      blds.length = 0;
      deps.layers?.drop();
      deps.buildings?.drop();
      deps.held?.drop();
      selfHidden = null;
    },
    destroy() { unhookAll(); gameCull.drop(); },
    stats: () => ({ shown, replayed, holds: holds.size, ...gameCull.stats(), ...deps.layers?.stats(), ...deps.held?.stats() }),
  };
}
