import type { SpriteConfig, SpriteState } from '../types';
import { buildItemsFromTextures } from '../atlas';
import { createDecoderTelemetry } from './ktx2Telemetry';

export type SpriteCtx = {
  cfg: SpriteConfig;
  state: SpriteState;
};

// Global state — shared holder so service modules read the live context.
export const ctxRef: { current: SpriteCtx | null } = { current: null };

export function createInitialState(): SpriteState {
  return {
    started: false,
    open: false,
    loaded: false,
    version: null,
    base: null,
    ctors: null,
    app: null,
    renderer: null,
    cat: '__all__',
    q: '',
    f: '',
    mutOn: false,
    mutations: [],
    scroll: 0,
    items: [],
    filtered: [],
    cats: new Map(),
    tex: new Map(),
    lru: new Map(),
    cost: 0,
    jobs: [],
    jobMap: new Set(),
    srcCan: new Map(),
    atlasBases: new Set(),
    dbgCount: {},
    sig: '',
    changedAt: 0,
    needsLayout: false,
    overlay: null,
    bg: null,
    grid: null,
    dom: null,
    selCat: null,
    count: null,
    pool: [],
    active: new Map(),
    anim: new Set(),
    loadMode: 'legacy',
    fallbackBase: null,
    decoder: createDecoderTelemetry(),
    runtimeTextureHints: [],
    ktx2Canvases: new WeakMap(),
  };
}

export function recalcSpriteCatalog(state: SpriteState): void {
  const { items, cats } = buildItemsFromTextures(state.tex, { catLevels: 1 });
  state.items = items;
  state.filtered = items.slice();
  state.cats = cats;
}
