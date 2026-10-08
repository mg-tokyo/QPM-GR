// Structural shapes of the game's private PIXI 8 objects and engine systems. The game's PIXI is not importable;
// every class is resolved from a live instance (capabilities.ts).
export interface XY { x: number; y: number }
export interface Point2 extends XY { set(x: number, y?: number): void; copyFrom(p: XY): unknown }

export interface Mat {
  a: number; b: number; c: number; d: number; tx: number; ty: number;
  set(a: number, b: number, c: number, d: number, tx: number, ty: number): Mat;
  append(m: Mat): Mat;
  prepend(m: Mat): Mat;
  clone(): Mat;
  copyFrom(m: Mat): Mat;
  invert(): Mat;
  translate(x: number, y: number): Mat;
  scale(x: number, y: number): Mat;
  apply(p: XY, out?: XY): XY;
}

export interface TexSourceLike { style: unknown; destroy?(): void; updateMipmaps?(): void }
export interface TexLike {
  orig: { width: number; height: number };
  frame: { x: number; y: number; width: number; height: number };
  source: TexSourceLike;
  destroy(destroySource?: boolean): void;
}

export interface Node3 {
  label?: string | null;
  x: number;
  y: number;
  position: Point2;
  scale: Point2;
  pivot: Point2;
  skew: Point2;
  rotation: number;
  zIndex: number;
  visible: boolean;
  alpha: number;
  renderable?: boolean;
  destroyed?: boolean;
  parent: Node3 | null;
  children: Node3[];
  texture?: TexLike | null;
  anchor?: Point2;
  mask?: unknown;
  eventMode?: string;
  tint?: number;
  width?: number;
  height?: number;
  includeInBuild?: boolean;
  context?: unknown;
  geometry?: unknown;
  shader?: unknown;
  _onRender?: ((...a: unknown[]) => unknown) | null;
  onRender?: ((...a: unknown[]) => unknown) | null;
  localTransform: Mat;
  updateLocalTransform(): void;
  setFromMatrix(m: Mat): void;
  /** structureDidChange: a visibility flip or child change since the last render (PIXI rebuilds the instructions). */
  renderGroup?: { worldTransform: Mat; structureDidChange?: boolean } | null;
  renderLayerChildren?: Node3[];
  parentRenderLayer?: Node3 | null;
  attach?(...n: Node3[]): void;
  detach?(...n: Node3[]): void;
  addChild(n: Node3): unknown;
  addChildAt(n: Node3, i: number): unknown;
  removeChild(n: Node3): unknown;
  destroy(opts?: unknown): void;
  toLocal?(p: XY, from?: unknown, out?: XY): XY;
  toGlobal?(p: XY): XY;
  containsPoint?(p: XY): boolean;
  getBounds?(skipUpdate?: boolean, out?: unknown): { x: number; y: number; width: number; height: number };
  /** PIXI's emitter: 'childAdded' / 'childRemoved' fire on a real add, a remove and a destroy (live 2026-10-05, 1419). */
  on?(event: string, fn: (...a: unknown[]) => void): unknown;
  off?(event: string, fn: (...a: unknown[]) => void): unknown;
}

export interface GraphicsLike extends Node3 {
  clear(): GraphicsLike;
  rect(x: number, y: number, w: number, h: number): GraphicsLike;
  fill(color: number): GraphicsLike;
}
export interface UniformGroupLike { uniforms: Record<string, unknown>; update(): void }
export interface ShaderLike {
  resources: Record<string, unknown>;
  groups?: Record<string, { resources?: Record<string, unknown> }>;
  glProgram?: { vertex: string; fragment: string };
  destroy(destroyPrograms?: boolean): void;
}
export interface GeometryLike { destroy(destroyBuffers?: boolean): void }

export interface RendererLike {
  render(...args: unknown[]): unknown;
  screen: { width: number; height: number };
  canvas: HTMLCanvasElement;
  gl?: WebGL2RenderingContext;
  generateTexture(opts: unknown): TexLike;
  extract: { pixels(target: unknown): { pixels: Uint8Array | Uint8ClampedArray; width: number; height: number } };
  events: {
    mapPositionToPoint(point: XY, x: number, y: number): void;
    rootBoundary: { hitTest(x: number, y: number): Node3 | null };
  };
}

export type Ctor<T> = new (...args: unknown[]) => T;
export interface PixiClasses {
  Sprite: Ctor<Node3>;
  Container: Ctor<Node3>;
  Graphics: Ctor<GraphicsLike>;
  Texture: Ctor<TexLike> & { WHITE: TexLike; EMPTY: TexLike };
  Rectangle: Ctor<{ x: number; y: number; width: number; height: number }>;
  Matrix: Ctor<Mat>;
  Mesh: Ctor<Node3>;
  Geometry: Ctor<GeometryLike>;
  Shader: Ctor<ShaderLike>;
  GlProgram: Ctor<unknown>;
  UniformGroup: Ctor<UniformGroupLike>;
  /** Optional: PIXI's batched mesh geometry ({ positions, uvs, indices }); null draws fence walls as perspective meshes. */
  MeshGeometry: Ctor<GeometryLike> | null;
}

/** pointsBuf: a plain array live (1419), 14 floats per rect (scene/tileArt.ts RECT). */
export interface TileDataLike { pointsBuf: number[] | Float32Array; rects_count: number }
/** A game-layout check: 'unknown' when there is too little to tell (it never blocks). */
export type DriftVerdict = 'ok' | 'drift' | 'unknown';
export interface SceneRefs {
  app: Record<string, unknown>;
  renderer: RendererLike;
  stage: Node3;
  camera: Node3;
  world: Node3;
  ground: Node3;
  weather: Node3;
  tilemap: Node3;
  tileData: TileDataLike;
  /** The PIXI app's ticker (optional): maxFPS is the game's frame-rate setting, 0 uncapped (live v1431: 30 in 3D on
   *  Automatic idle; the menu offers 20). */
  ticker: { readonly maxFPS: number } | null;
}

export interface ZoomLike {
  applyInputZoom(requested: number, kind: string, ctx?: unknown): unknown;
  readonly effective: number;
  readonly intentTileSize: number;
  overrideTileSize: number | null;
  /** Live v1419 getter: a cutscene camera or the tram's focus zoom (engine/resume.ts gameTakesCamera). */
  readonly inputBlocked?: boolean;
}
/** The gesture fields are optional (live 2026-10-04): set while a touch pinch or Safari gesture runs. */
export interface ZoomSystemLike { zoom: ZoomLike; shouldBlockZoom(): boolean; initialPinchDistance?: number | null; initialTileSizeOnGesture?: number }
export interface DirectionalInputLike { keysPressed: string[]; updateDirectionState(): void }
/** The game's MovementSystem step (live 2026-10-06 v1419): one tile toward `dir` ('up' | 'right' | 'down' | 'left')
 * from `pos`, unless its own collision check (mount mode, conditional regions) refuses; true when it stepped. */
export interface MovementLike { movePlayer(dir: string, pos: XY): boolean }
export interface MovementMapLike { cols: number; rows: number; collisionTiles: Set<number> }
/** The game's AvatarView, the fields the ground tracker reads (live 2026-10-05, v1419). Natural y = tile centre − rest −
 * lift, gliding source → target; the container adds the riding nudge and the peek lift. */
export interface AvatarViewLike {
  container: unknown;
  gridPosition: XY | null;
  naturalContainerY: number;
  lastTileData?: unknown;
  isAirborneMount?: boolean;
  currentRidingNudgePixels?: number;
  positionSmoothing: { readonly isInterpolating: boolean; goalSourceWorldY: number; lastGoalWorldY: number };
  buildingDataProvider?: { getBuildingAt(p: XY): unknown };
}
export interface AvatarSystemLike { views: Map<unknown, unknown> }
export interface EngineSystems {
  zoomSys: ZoomSystemLike;
  directionalInput: DirectionalInputLike;
  /** The movement system's step (optional): without it WASD keeps the quarter-turn snap (spec D5). */
  mover: MovementLike | null;
  movementFallback: { isTapInBounds(x: number, y: number): boolean };
  map: MovementMapLike;
  petSystem: { preDraw(...a: unknown[]): unknown };
  /** The game's FPS policy (optional): keeps the active frame rate while 3D input never reaches the canvas. */
  activity: { notifyActivity(): void } | null;
  /** The world tap router (optional): which claim a 2D global point would hand a tap to (null: tap-to-move), and
   * whether it drops a tap there (HUD or dead zone). */
  tapRouter: { resolveClaimAt(globalPoint: XY): unknown; isWorldPointerSuppressed?(globalPoint: XY, pointerType?: string): boolean } | null;
  /** The avatar system (optional): each avatar's ground vs its height (decor, building, saddle). Without it avatars
   * fall back to the learned rest offset. */
  avatar: AvatarSystemLike | null;
  /** The engine's frame clock (optional; live 2026-10-06 v1419: the frame's own timestamp, set before its render).
   * Without it the walk follower times by the render call, which jitters a few ms per frame. */
  clock: { readonly lastFrameTimeMs: number } | null;
}

export interface Caps { scene: SceneRefs; classes: PixiClasses; systems: EngineSystems }
