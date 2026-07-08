// sprite-v2/types.ts - TypeScript type definitions for the new sprite system

export type SpriteMode = 'bitmap' | 'canvas' | 'dataURL';

export type MutationName =
  | 'Gold'
  | 'Rainbow'
  | 'Wet'
  | 'Chilled'
  | 'Frozen'
  | 'Dawnlit'
  | 'Ambershine'
  | 'Dawncharged'
  | 'Ambercharged'
  | 'Thunderstruck';

export type SpriteCategory = 'plant' | 'tallplant' | 'crop' | 'decor' | 'item' | 'pet' | 'seed' | 'mutation' | 'mutation-overlay' | 'avatar' | 'any';

export interface MutationMeta {
  overlayTall: string | null;
  tallIconOverride: string | null;
  angle?: number;
  angleTall?: number;
}

export interface SpriteFilterConfig {
  op: GlobalCompositeOperation;
  colors: string[];
  a?: number;
  ang?: number;
  angTall?: number;
  masked?: boolean;
  reverse?: boolean;
}

export interface VariantInfo {
  mode: 'M' | 'F';
  muts: MutationName[];
  overlayMuts: MutationName[];
  selectedMuts: MutationName[];
  sig: string;
}

export interface SpriteConfig {
  origin: string;
  jobOn: boolean;
  jobBudgetMs: number;
  jobBurstMs: number;
  jobBurstWindowMs: number;
  jobCapPerTick: number;
  cacheOn: boolean;
  cacheMaxEntries: number;
  cacheMaxCost: number;
  keepCacheOnClose: boolean;
  srcCanvasMax: number;
  debugLog: boolean;
  debugLimitDefault: number;
}

export interface SpriteItem {
  key: string;
  isAnim: boolean;
  first: any; // PIXI.Texture
  frames?: any[]; // PIXI.Texture[]
  count?: number;
}

export interface CacheEntry {
  isAnim: boolean;
  tex?: any; // PIXI.Texture
  frames?: any[]; // PIXI.Texture[]
}

export interface RenderJob {
  k: string;
  sig: string;
  itKey: string;
  V: VariantInfo;
  src: any[]; // PIXI.Texture[]
  out: any[]; // PIXI.Texture[]
  i: number;
  isAnim: boolean;
  priority?: number; // Priority for job queue (higher = more important)
}

export interface SpriteState {
  started: boolean;
  open: boolean;
  loaded: boolean;
  version: string | null;
  base: string | null;
  ctors: PixiConstructors | null;
  app: any; // PIXI.Application
  renderer: any; // PIXI.Renderer
  cat: string;
  q: string;
  f: string;
  mutOn: boolean;
  mutations: string[];
  scroll: number;
  items: SpriteItem[];
  filtered: SpriteItem[];
  cats: Map<string, SpriteItem[]>;
  tex: Map<string, any>; // Map<string, PIXI.Texture>
  lru: Map<string, CacheEntry>;
  cost: number;
  jobs: RenderJob[];
  jobMap: Set<string>;
  srcCan: Map<any, HTMLCanvasElement>; // Map<PIXI.Texture, HTMLCanvasElement>
  atlasBases: Set<any>; // Set<PIXI.BaseTexture>
  dbgCount: Record<string, number>;
  sig: string;
  changedAt: number;
  needsLayout: boolean;
  overlay: any;
  bg: any;
  grid: any;
  dom: any;
  selCat: any;
  count: any;
  pool: any[];
  active: Map<any, any>;
  anim: Set<any>;
  loadMode?: 'legacy' | 'ktx2-native' | 'ktx2-native-failed' | 'legacy-fallback';
  fallbackBase?: string | null;
  decoder?: {
    workerReady: boolean;
    decodeAttempts: number;
    decodeSuccesses: number;
    decodeFailures: number;
    totalDecodeMs: number;
    discoveryStrategy: 'resource-timing' | 'bundle-scan' | 'failed' | 'pending';
    workerUrl: string | null;
    wasmUrl: string | null;
    wasmBytes: number;
    wasmFetchMs: number;
    discoveryMs: number;
  };
  runtimeTextureHints?: any[];
  /** WeakMap from PIXI texture source → KTX2-decoded source canvas for reliable 2D extraction */
  ktx2Canvases?: WeakMap<object, HTMLCanvasElement>;
}

export interface PixiConstructors {
  Container: any;
  Sprite: any;
  Texture: any;
  Rectangle: any;
  Text: any | null;
}

export interface PixiHooks {
  app: any;
  renderer: any;
  pixiVersion: string | null;
  appReady: Promise<any>;
  rendererReady: Promise<any>;
}

export interface GetSpriteParams {
  category: SpriteCategory;
  id: string;
  mutations?: string[];
}

export interface RenderOptions {
  maxWidth?: number;
  maxHeight?: number;
  allowScaleUp?: boolean;
}

export interface SpriteService {
  ready: Promise<void>;
  state: SpriteState;
  cfg: SpriteConfig;
  list(category?: SpriteCategory): SpriteItem[];
  getBaseSprite(params: GetSpriteParams): any; // PIXI.Texture | null
  getSpriteWithMutations(params: GetSpriteParams): any; // PIXI.Texture | null
  buildVariant(mutations: string[]): VariantInfo;
  renderToCanvas(arg: GetSpriteParams | any): HTMLCanvasElement | null;
  renderToDataURL(arg: GetSpriteParams | any, type?: string, quality?: number): Promise<string | null>;
  renderOnCanvas(arg: GetSpriteParams | any, opts?: RenderOptions): { wrap: HTMLDivElement; canvas: HTMLCanvasElement } | null;
  clearOverlay(): void;
  renderAnimToCanvases(params: GetSpriteParams): HTMLCanvasElement[];
}

export interface AtlasFrameData {
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize?: { x: number; y: number; w: number; h: number };
  sourceSize?: { w: number; h: number };
  anchor?: { x: number; y: number };
}

export interface AtlasData {
  frames: Record<string, AtlasFrameData>;
  meta: {
    image: string;
    related_multi_packs?: string[];
    [key: string]: any;
  };
}

export interface ManifestAsset {
  name?: string;
  src?: (string | { src: string })[];
}

export interface ManifestBundle {
  name: string;
  assets?: ManifestAsset[];
}

export interface Manifest {
  bundles?: ManifestBundle[];
  [key: string]: any;
}
