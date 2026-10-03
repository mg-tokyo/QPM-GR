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
  renderGroup?: { worldTransform: Mat } | null;
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
}

export interface TileDataLike { pointsBuf: Float32Array; rects_count: number; tileset: { arr: unknown[] } }
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
}

export interface ZoomLike {
  applyInputZoom(requested: number, kind: string, ctx?: unknown): unknown;
  readonly effective: number;
  readonly intentTileSize: number;
  overrideTileSize: number | null;
}
export interface ZoomSystemLike { zoom: ZoomLike; shouldBlockZoom(): boolean }
export interface DirectionalInputLike { keysPressed: string[]; updateDirectionState(): void }
export interface MovementMapLike { cols: number; rows: number; collisionTiles: Set<number> }
export interface EngineSystems {
  zoomSys: ZoomSystemLike;
  directionalInput: DirectionalInputLike;
  movementFallback: { isTapInBounds(x: number, y: number): boolean };
  map: MovementMapLike;
  petSystem: { preDraw(...a: unknown[]): unknown };
}

export interface Caps { scene: SceneRefs; classes: PixiClasses; systems: EngineSystems }
