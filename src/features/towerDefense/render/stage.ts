import type { Point } from '../types';
import { PLOT_COLS, PLOT_ROWS } from '../constants';
import {
  enterPatchStage,
  exitPatchStage,
  dispatchSynthetic,
  isPatchStageActive,
  isPatchStageAvailable,
} from '../../../core/patchStage';
import { getRoomConnection } from '../../../websocket/api';
import { findSlotIdxByOwner, getPlayerIdSync } from '../../../core/playerContext';
import { getPixiRuntime, findByLabel, walkScene } from '../../../core/pixiScene';
import { onPixiNodeAdded, onPixiNodeRemoved } from '../../../core/pixiSceneEvents';
import { subscribe as stateTreeSubscribe } from '../../../core/stateTree';
import type { QuinoaStateSnapshot } from '../../../types/gameAtoms';
import { pageWindow } from '../../../core/pageContext';
import { createNamedLogger } from '../../../diagnostics/logger';

const log = createNamedLogger('td');

// Plot origins = first dirt tile per slot's LEFT grid (battleship
// gardenStage.ts:26, live-verified from Tiled map.json). TD anchors its
// 23×12 play area at (origin - 1, origin - 1) so the perimeter boardwalk is
// included.
const PLOT_ORIGINS: ReadonlyArray<{ col: number; row: number }> = [
  { col: 14, row: 14 },
  { col: 40, row: 14 },
  { col: 66, row: 14 },
  { col: 14, row: 36 },
  { col: 40, row: 36 },
  { col: 66, row: 36 },
];

const WORLD_PX_PER_TILE = 256;
const CONTAINER_LABEL = '__qpm_td-stage';

type PixiNode = Record<string, unknown>;
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
  children?: PixiNode[];
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
  eventMode?: string;
  sortableChildren?: boolean;
  destroyed?: boolean;
};

// z-index tiers within the TD stage container. Balloons must stay below towers
// so upgrades (which destroy+re-add tower sprites) don't put towers above
// already-live balloons; see towerRender.ts:312-317 for the rebuild path.
export const TD_Z_PATH = 0;
// Path-drop piles (pinecone) lie on the ground: above the path, below both
// balloons walking over them and towers standing over them.
export const TD_Z_PATH_DROP = 5;
export const TD_Z_BALLOON = 10;
export const TD_Z_TOWER = 20;
export const TD_Z_PROJECTILE = 30;
export const TD_Z_EFFECT = 40;
export const TD_Z_UI = 50;
type GraphicsNode = PixiNode & {
  rect?: (x: number, y: number, w: number, h: number) => GraphicsNode;
  fill?: (opts: { color: number; alpha?: number }) => GraphicsNode;
  clear?: () => GraphicsNode;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};
type GraphicsCtor = new () => GraphicsNode;
type ContainerCtor = new () => ContainerNode;
type SpriteNode = PixiNode & {
  anchor?: { set: (x: number, y: number) => void };
  scale?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};
type SpriteCtor = new (tex: unknown) => SpriteNode;
type TextureCtor = { from: (source: unknown) => unknown };

interface StageState {
  camera: ContainerNode;
  container: ContainerNode;
  graphicsCtor: GraphicsCtor;
  containerCtor: ContainerCtor;
  spriteCtor: SpriteCtor | null;
  textureCtor: TextureCtor | null;
  slotIdx: number;
  originCol: number;
  originRow: number;
  /** Player moved to a different slot — doctor/suppress are pass-through for good. */
  invalidated: boolean;
  /** Player currently unseated (reconnect in flight) — pass-through until re-seated. */
  pending: boolean;
  unsubscribeCamera: (() => void) | null;
  unsubscribeContainerRemoved: (() => void) | null;
  unsubscribeSlot: (() => void) | null;
}

let state: StageState | null = null;
const containerRecreatedListeners = new Set<(container: unknown) => void>();
const invalidatedListeners = new Set<(reason: string) => void>();

function emitContainerRecreated(container: unknown): void {
  for (const cb of containerRecreatedListeners) {
    try { cb(container); } catch { /* listener errors must not break renderers */ }
  }
}

function emitInvalidated(reason: string): void {
  for (const cb of invalidatedListeners) {
    try { cb(reason); } catch { /* ignore */ }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

// Mirrors flameOverlay.ts:49-83 — try window.PIXI first, else walk the scene.
// Skips Rive-backed subclasses via the arity-1 `draw` heuristic (QPM-BS-FLAME-007).
function findSpriteCtors(stage: unknown): { Sprite: SpriteCtor; Texture: TextureCtor } | null {
  const P = (pageWindow as Record<string, unknown>).PIXI as Record<string, unknown> | undefined;
  if (isObject(P) && typeof P.Sprite === 'function' && isObject(P.Texture) && typeof P.Texture.from === 'function') {
    return { Sprite: P.Sprite as unknown as SpriteCtor, Texture: P.Texture as unknown as TextureCtor };
  }
  let candidateSprite: SpriteCtor | null = null;
  let candidateTexture: TextureCtor | null = null;
  walkScene(stage, (node): boolean | void => {
    const n = node as {
      texture?: { constructor?: unknown; frame?: unknown };
      constructor?: unknown;
      draw?: unknown;
    };
    if (!n.texture || !n.texture.frame) return;
    if (typeof n.draw === 'function' && (n.draw as { length: number }).length === 1) return;
    const S = n.constructor;
    const T = n.texture.constructor as { from?: unknown } | undefined;
    if (typeof S === 'function' && T && typeof T.from === 'function') {
      candidateSprite = S as unknown as SpriteCtor;
      candidateTexture = T as unknown as TextureCtor;
      return true;
    }
  }, { maxNodes: 8000 });
  if (candidateSprite && candidateTexture) {
    return { Sprite: candidateSprite, Texture: candidateTexture };
  }
  return null;
}

function findGraphicsCtor(stage: unknown): GraphicsCtor | null {
  let found: GraphicsCtor | null = null;
  walkScene(stage, (node): boolean | void => {
    const n = node as { rect?: unknown; constructor?: unknown };
    if (typeof n.rect === 'function' && typeof n.constructor === 'function') {
      found = n.constructor as GraphicsCtor;
      return true;
    }
  }, { maxNodes: 8000 });
  return found;
}

type StateShape = {
  child?: {
    data?: {
      userSlots?: Array<{
        userId?: string;
        playerId?: string;
        data?: {
          garden?: {
            tileObjects?: Record<string, unknown>;
            boardwalkTileObjects?: Record<string, unknown>;
          };
        };
      } | null>;
    };
  };
};

function resolveSlotIdx(playerId: string): number {
  const rs = getRoomConnection()?.lastRoomStateJsonable as StateShape | undefined;
  return findSlotIdxByOwner(rs?.child?.data?.userSlots, playerId);
}

function resolveMySlotIdx(): number {
  const pid = getPlayerIdSync();
  if (!pid) return -1;
  return resolveSlotIdx(pid);
}

// A player owns two 10×10 grids (200 tileObject slots, localIdx 0..199).
function mySlotLocalIndices(): number[] {
  const out: number[] = [];
  for (let i = 0; i < 200; i++) out.push(i);
  return out;
}

function tilePath(slotIdx: number, localIdx: number): string {
  return `/child/data/userSlots/${slotIdx}/data/garden/tileObjects/${localIdx}`;
}

function boardwalkPath(slotIdx: number, key: string): string {
  return `/child/data/userSlots/${slotIdx}/data/garden/boardwalkTileObjects/${key}`;
}

// Boardwalk keys are dynamic strings (v.record schema), so we enumerate them
// from live state rather than iterating a fixed range.
function myBoardwalkKeys(slotIdx: number): string[] {
  const rs = getRoomConnection()?.lastRoomStateJsonable as StateShape | undefined;
  const bw = rs?.child?.data?.userSlots?.[slotIdx]?.data?.garden?.boardwalkTileObjects;
  return bw ? Object.keys(bw) : [];
}

// Doctor: wipe MY slot's tileObjects AND boardwalkTileObjects only. Battleship
// pattern — never touches other slots. Bare dirt/boardwalk shows through where
// the crops and boardwalk decor (seed silo, food trough, rocks, birdbath) were.
function doctor(rawState: unknown): unknown {
  const s = rawState as StateShape;
  if (state?.invalidated || state?.pending) return rawState;
  const slotIdx = state?.slotIdx ?? -1;
  if (slotIdx < 0) return rawState;
  const garden = s.child?.data?.userSlots?.[slotIdx]?.data?.garden;
  const tiles = garden?.tileObjects;
  if (tiles) {
    for (const k of Object.keys(tiles)) delete tiles[k];
  }
  const bw = garden?.boardwalkTileObjects;
  if (bw) {
    for (const k of Object.keys(bw)) delete bw[k];
  }
  return rawState;
}

let mySlotTilePathPrefix = '';
let mySlotBoardwalkPathPrefix = '';

function suppress(path: string): boolean {
  if (state?.invalidated || state?.pending) return false;
  if (mySlotTilePathPrefix !== '' && path.startsWith(mySlotTilePathPrefix)) return true;
  if (mySlotBoardwalkPathPrefix !== '' && path.startsWith(mySlotBoardwalkPathPrefix)) return true;
  return false;
}

function mySlotIdxIn(snapshot: unknown): number {
  const pid = getPlayerIdSync();
  if (!pid) return -1;
  return findSlotIdxByOwner((snapshot as StateShape).child?.data?.userSlots, pid);
}

function myRepaintPaths(slotIdx: number): string[] {
  return [
    ...mySlotLocalIndices().map((i) => tilePath(slotIdx, i)),
    ...myBoardwalkKeys(slotIdx).map((k) => boardwalkPath(slotIdx, k)),
  ];
}

// A reconnect can (a) re-seat us in the same slot, (b) leave us unseated for
// a moment while the server re-admits us (the game unmounts its engine
// meanwhile — QuinoaMain.tsx:26), or (c) seat us elsewhere. TD is anchored to
// a plot origin, so (b) pauses hiding and (c) is a hard stop: pass-through
// immediately so nobody else's plot gets doctored, then launch.ts autosaves
// and quits. Called from the Welcome hook (before the doctored fan-out) and
// from the state-tree slot subscription (re-seat patches).
function reconcileSlot(idx: number): void {
  const s = state;
  if (!s || s.invalidated) return;
  if (idx === s.slotIdx) {
    if (!s.pending) return;
    s.pending = false;
    log.info('stage: re-seated in same slot, hiding resumed', { slotIdx: idx });
    dispatchSynthetic(myRepaintPaths(idx));
    return;
  }
  if (idx < 0) {
    if (s.pending) return;
    s.pending = true;
    log.info('stage: player unseated (reconnect in flight), hiding paused', { slotIdx: s.slotIdx });
    return;
  }
  s.invalidated = true;
  s.pending = false;
  log.warn('QPM-TD-STAGE-012', { reason: 'slot_changed', was: s.slotIdx, now: idx });
  emitInvalidated('slot_changed');
}

function onWelcome(realState: unknown): void {
  reconcileSlot(mySlotIdxIn(realState));
}

function selectMySlotIdx(snapshot: QuinoaStateSnapshot): number {
  return mySlotIdxIn(snapshot);
}

function makeContainer(ctor: ContainerCtor): ContainerNode {
  const c = new ctor();
  c.label = CONTAINER_LABEL;
  c.eventMode = 'none';
  c.sortableChildren = true;
  return c;
}

function recreateContainerOn(camera: ContainerNode, reason: string): ContainerNode | null {
  const s = state;
  if (!s) return null;
  let replacement: ContainerNode;
  try {
    replacement = makeContainer(s.containerCtor);
  } catch (err) {
    log.warn('QPM-TD-STAGE-009', { reason: 'container_reheal_failed' }, err);
    return null;
  }
  try {
    camera.addChild?.(replacement);
  } catch (err) {
    log.warn('QPM-TD-STAGE-010', { reason: 'container_reheal_addchild_failed' }, err);
    return null;
  }
  s.camera = camera;
  s.container = replacement;
  log.warn('QPM-TD-STAGE-011', { reason });
  emitContainerRecreated(replacement);
  return replacement;
}

// The game rebuilds its whole PIXI engine on a transient reconnect
// (QuinoaCanvas.tsx:64-70) — a fresh `Camera` container is added to the new
// stage. Re-home the TD container there the moment it appears.
function handleCameraAdded(node: unknown): void {
  const s = state;
  if (!s) return;
  const camera = node as ContainerNode;
  if (camera === s.camera || camera.destroyed === true) return;
  if (typeof camera.addChild !== 'function') return;
  recreateContainerOn(camera, 'camera_rebuilt');
}

// Our container was detached from a still-live camera (game cleared the
// Camera subtree). Deferred one microtask so we never re-add inside the
// game's own removeChild call.
function handleContainerRemoved(node: unknown): void {
  const s = state;
  if (!s || node !== s.container) return;
  queueMicrotask(() => {
    const cur = state;
    if (!cur || cur.container !== node) return;
    if (cur.camera.destroyed === true) return;
    recreateContainerOn(cur.camera, 'container_detached');
  });
}

export function initStage(): boolean {
  if (state) return true;
  if (!isPatchStageAvailable()) {
    log.warn('QPM-TD-STAGE-001', { reason: 'patch_stage_unavailable' });
    return false;
  }
  const rt = getPixiRuntime();
  if (!rt.ready || !rt.stage) {
    log.warn('QPM-TD-STAGE-002', { reason: 'pixi_not_ready' });
    return false;
  }
  const camera = findByLabel(rt.stage, 'Camera') as ContainerNode | null;
  if (!camera || typeof camera.addChild !== 'function') {
    log.warn('QPM-TD-STAGE-003', { reason: 'no_camera_container' });
    return false;
  }
  const graphicsCtor = findGraphicsCtor(rt.stage);
  if (!graphicsCtor) {
    log.warn('QPM-TD-STAGE-004', { reason: 'no_graphics_ctor' });
    return false;
  }
  const slotIdx = resolveMySlotIdx();
  const origin = PLOT_ORIGINS[slotIdx];
  if (slotIdx < 0 || !origin) {
    log.warn('QPM-TD-STAGE-005', { reason: 'slot_not_resolved', slotIdx });
    return false;
  }
  mySlotTilePathPrefix = `/child/data/userSlots/${slotIdx}/data/garden/tileObjects/`;
  mySlotBoardwalkPathPrefix = `/child/data/userSlots/${slotIdx}/data/garden/boardwalkTileObjects/`;
  const ContainerCtorRef = camera.constructor as ContainerCtor;
  const spriteCtors = findSpriteCtors(rt.stage);
  if (!enterPatchStage(doctor, suppress, { onWelcome })) {
    mySlotTilePathPrefix = '';
    mySlotBoardwalkPathPrefix = '';
    log.warn('QPM-TD-STAGE-006', { reason: 'enter_patch_stage_failed' });
    return false;
  }
  let container: ContainerNode;
  try {
    container = makeContainer(ContainerCtorRef);
  } catch (err) {
    log.warn('QPM-TD-STAGE-007', { reason: 'container_ctor_failed' }, err);
    exitPatchStage([]);
    mySlotTilePathPrefix = '';
    mySlotBoardwalkPathPrefix = '';
    return false;
  }
  camera.addChild(container);

  state = {
    camera,
    container,
    graphicsCtor,
    containerCtor: ContainerCtorRef,
    spriteCtor: spriteCtors?.Sprite ?? null,
    textureCtor: spriteCtors?.Texture ?? null,
    slotIdx,
    originCol: origin.col - 1,
    originRow: origin.row - 1,
    invalidated: false,
    pending: false,
    unsubscribeCamera: null,
    unsubscribeContainerRemoved: null,
    unsubscribeSlot: null,
  };
  state.unsubscribeCamera = onPixiNodeAdded('Camera', handleCameraAdded);
  state.unsubscribeContainerRemoved = onPixiNodeRemoved(CONTAINER_LABEL, handleContainerRemoved);
  state.unsubscribeSlot = stateTreeSubscribe(
    selectMySlotIdx,
    (idx) => { if (typeof idx === 'number') reconcileSlot(idx); },
    'td-stage-slot',
    '/child/data/userSlots',
  );
  if (!spriteCtors) {
    log.warn('QPM-TD-STAGE-008', { reason: 'no_sprite_ctors' });
  }
  // Repaint MY slot's tiles + boardwalk from the doctored view — clears the
  // visible crops AND boardwalk decor (seed silo, food trough, rocks, birdbath).
  dispatchSynthetic(myRepaintPaths(slotIdx));
  return true;
}

// Container recreation is event-driven (Camera added / container removed);
// this only guards the destroy()-without-removeChild path via the O(1) flag.
export function getStageContainer(): unknown {
  const s = state;
  if (!s) return null;
  if (s.container.destroyed !== true) return s.container;
  if (s.camera.destroyed === true) return null;
  return recreateContainerOn(s.camera, 'container_destroyed');
}

/** Current container without the self-heal side effect (identity checks only). */
export function peekStageContainer(): unknown {
  return state?.container ?? null;
}

// Renderers subscribe here to rebuild their sprites when the stage container
// was recreated (game rebuilt the Camera subtree, orphaning our old container).
export function onStageContainerRecreated(cb: (container: unknown) => void): () => void {
  containerRecreatedListeners.add(cb);
  return () => {
    containerRecreatedListeners.delete(cb);
  };
}

/** Fires once when the stage can no longer hide the right garden (slot moved on reconnect). */
export function onStageInvalidated(cb: (reason: string) => void): () => void {
  invalidatedListeners.add(cb);
  return () => {
    invalidatedListeners.delete(cb);
  };
}

export function getStageGraphicsCtor(): GraphicsCtor | null {
  return state?.graphicsCtor ?? null;
}

export function getStageContainerCtor(): ContainerCtor | null {
  return state?.containerCtor ?? null;
}

export function getStageSpriteCtor(): SpriteCtor | null {
  return state?.spriteCtor ?? null;
}

export function getStageTextureCtor(): TextureCtor | null {
  return state?.textureCtor ?? null;
}

export function getMySlotIdx(): number {
  return state?.slotIdx ?? -1;
}

export function tileToPixel(tile: Point): Point {
  const s = state;
  if (!s) return { x: 0, y: 0 };
  return {
    x: (s.originCol + tile.x + 0.5) * WORLD_PX_PER_TILE,
    y: (s.originRow + tile.y + 0.5) * WORLD_PX_PER_TILE,
  };
}

// World-tile coord (integer, from position atom) → plot-local tile, or null
// when outside the 23×12 play area.
export function worldTileToPlotTile(worldTile: Point): Point | null {
  const s = state;
  if (!s) return null;
  const x = worldTile.x - s.originCol;
  const y = worldTile.y - s.originRow;
  if (x < 0 || x >= PLOT_COLS || y < 0 || y >= PLOT_ROWS) return null;
  return { x, y };
}

export function getWorldPxPerTile(): number {
  return WORLD_PX_PER_TILE;
}

export function isStageActive(): boolean {
  return state !== null && isPatchStageActive();
}

export function stopStage(): void {
  const s = state;
  if (!s) return;
  containerRecreatedListeners.clear();
  invalidatedListeners.clear();
  s.unsubscribeCamera?.();
  s.unsubscribeContainerRemoved?.();
  s.unsubscribeSlot?.();
  const slotIdx = s.slotIdx;
  // Enumerate boardwalk keys from LIVE state BEFORE clearing state — the
  // connection's lastRoomStateJsonable still holds the real (undoctored) keys
  // because the MITM only affects subscriber delivery, not the cached snapshot.
  const repaintPaths = myRepaintPaths(slotIdx);
  state = null;
  mySlotTilePathPrefix = '';
  mySlotBoardwalkPathPrefix = '';
  try {
    s.camera.removeChild?.(s.container);
    s.container.destroy?.({ children: true, texture: false });
  } catch { /* ignore */ }
  // Repaint from LIVE state so real crops AND boardwalk decor re-hydrate.
  exitPatchStage(repaintPaths);
}
