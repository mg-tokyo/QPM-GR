import { createLogger } from '../../../utils/logger';
import type { SpriteService, SpriteCategory } from '../../../sprite-v2/types';

export type { SpriteService, SpriteCategory };

export const log = createLogger('QPM:TextureSwapper', false);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'qpm.textureSwaps.v1';
export const DEBUG_STORAGE_KEY = 'qpm.textureSwaps.debugLogs';
export const TEXTURE_MANIPULATOR_ENABLED = true;
export const UPLOADS_ENABLED = true;
export const MAX_UPLOAD_BYTES = 512 * 1024;
export const COMPRESS_SIZE = 256;
export const LAYER_B_REFRESH_DELAYS_MS = [0, 500, 2500] as const;
export const MAX_WALK_DEPTH = 25;

export const SPRITE_KEY_EXT_RE = /\.(png|webp|avif|jpg|jpeg|ktx2)$/i;
export const KNOWN_SPRITE_PREFIXES = new Set([
  'plant', 'tallplant', 'crop', 'decor', 'item', 'pet', 'seed',
  'mutation', 'mutation-overlay', 'ui', 'object', 'animation', 'winter',
]);

export const KNOWN_MUTATION_CANONICAL = [
  'Rainbow', 'Gold', 'Wet', 'Chilled', 'Frozen',
  'Dawnlit', 'Ambershine', 'Dawncharged', 'Ambercharged', 'Thunderstruck',
];

export const KNOWN_MUTATION_ALIASES: Record<string, string> = {
  rainbow: 'Rainbow', gold: 'Gold', wet: 'Wet', chilled: 'Chilled',
  frozen: 'Frozen', dawnlit: 'Dawnlit', ambershine: 'Ambershine',
  dawncharged: 'Dawncharged', ambercharged: 'Ambercharged',
  thunderstruck: 'Thunderstruck', amberlit: 'Ambershine',
  dawnbound: 'Dawncharged', amberbound: 'Ambercharged',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextureOverrideRule {
  id: string;
  enabled: boolean;
  targetSpriteKey: string;
  targetCategory: SpriteCategory;
  displayLabel: string;
  mutationBehavior?: 'preserve' | 'replace';
  cosmeticMutations?: string[];
  /**
   * When true, render matched sprites without any mutation overlay,
   * overriding the live game mutation state. Mutually exclusive with
   * `cosmeticMutations` at the UI level. Default false.
   */
  forceNoMutations?: boolean;
  /**
   * Optional per-instance scope (Spec 2). Undefined ↔ { kind: 'all' }.
   * Scoped rules apply only when the matched sprite is at the bound tile or
   * pet slot AND its species matches the bound species. Self-dormant otherwise.
   * Items and seeds keep all-instances only — they have no per-instance identity.
   */
  scope?: RuleScope;
  /**
   * Optional gate for crop rules on multi-harvest plants. Matches only
   * sprites whose `${species} slot-N` ancestor label resolves to this index.
   * Absent = match every slot of the species. Ignored for non-crop rules
   * (those whose targetSpriteKey id doesn't end in 'Crop').
   */
  slotIndex?: number;
  /**
   * For Rive-backed decor (WoodWindmill, MarbleFountain, StoneBirdbath,
   * WindSpinner, WindTurner per Thundershop decorRenderDex.ts:53-74): when
   * true, hide the live Rive renderer for matched instances and re-show the
   * underlying static atlas sprite, so library/upload texture swaps work via
   * the standard Layer A path. User opts in per rule. Ignored for non-Rive
   * targets.
   */
  useStaticFallback?: boolean;
  source: {
    type: 'library' | 'upload';
    librarySpriteKey?: string;
    uploadAssetId?: string;
  };
  params: {
    tintColor?: string;
    tintAlpha?: number;
    /** Optional saturation boost (0–1). Applied with 'saturation' blend. */
    tintSaturation?: number;
    /** @deprecated Legacy field from v1. Read-tolerated, ignored at apply time. */
    tintBlend?: string;
    scaleX?: number;
    /** @deprecated UI no longer writes this independently; reads tolerate it. */
    scaleY?: number;
    alpha?: number;
  };
}

// ---------------------------------------------------------------------------
// Rule scope (Spec 2)
// ---------------------------------------------------------------------------

export type RuleScope =
  | { kind: 'all' }
  | { kind: 'tile';    tileKey: string;    species: string }
  | { kind: 'petSlot'; slotIndex: 0 | 1 | 2; species: string };

/**
 * Stable key for indexing rules by scope. Used by RuleIndex (Task 6) and by
 * findRule() for uniqueness comparisons. Species comparison is case-insensitive.
 */
export function scopeKey(scope: RuleScope | undefined): string {
  if (!scope || scope.kind === 'all') return 'all';
  if (scope.kind === 'tile') return `tile:${scope.tileKey}:${scope.species.toLowerCase()}`;
  return `pet:${scope.slotIndex}:${scope.species.toLowerCase()}`;
}

export interface TextureManipulatorState {
  version: 1;
  rules: TextureOverrideRule[];
  uploadedAssets: Record<string, string>;
}

export type LayerBOriginalSnapshot = {
  texture: any;
  scaleX: number;
  scaleY: number;
  alpha: number;
  /** Sprite.tint (0xRRGGBB) at snapshot time. Default 0xFFFFFF when unset. */
  tint: number;
  frameSig: string | null;
  keyHints: string[];
  /**
   * Original per-frame textures for PIXI AnimatedSprite. Saved so we can
   * restore the animation after a rule is removed. Null for non-animated
   * sprites.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  animFrameTextures: any[] | null;
};

export type SpriteVariantInfo = {
  baseKey: string;
  sig: string;
  mutations: string[];
};

export type PlantSpriteContext = {
  speciesKey: string;
  mutations: string[];
};

export type TextureCanvasLayout = {
  canvasWidth: number;
  canvasHeight: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
};

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------

export const ctx = {
  state: { version: 1, rules: [], uploadedAssets: {} } as TextureManipulatorState,
  activeRules: [] as TextureOverrideRule[],
  currentSvc: null as SpriteService | null,

  origTextures: new Map<string, any | null>(),
  ruleTextures: new Map<string, any>(),
  ruleVariantTextures: new Map<string, any>(),
  origItemFirsts: new Map<string, any>(),
  retiredTextures: new Set<any>(),
  /** PIXI ColorOverlay filter per live-overlay rule. Reused across all matched sprites. */
  ruleFilters: new Map<string, any>(),
  /** Per-sprite original filter array, captured before we append our overlay filter. */
  layerBOriginalFilters: new WeakMap<object, any[] | null>(),
  /** Per-sprite overlay child sprite (child of the matched sprite, same texture, tinted to the rule colour). */
  layerBOverlaySprites: new WeakMap<object, any>(),

  layerBOriginals: new WeakMap<object, LayerBOriginalSnapshot>(),
  layerBModified: [] as any[],
  ruleRevision: 0,
  lastLayerBApplyToken: null as string | null,

  /**
   * Per-rule monotonic counter for Layer A apply ordering (PR #4 task 17 /
   * audit CRITICAL #6). Mirrors lastLayerBApplyToken. Used by applyLayerA to
   * discard stale buildCustomTexture results that resolve out of order during
   * slider drag — otherwise an older drag tick can overwrite a newer one's
   * texture and the newer one leaks.
   */
  lastLayerAApplyTokenByRule: new Map<string, number>(),

  /**
   * Per-rule fingerprint of the inputs that affect buildCustomTexture's output
   * (source identity, tint, alpha, saturation, size, mutations, target).
   * Same fingerprint → reuse the cached texture instead of rebuilding (PR #4
   * task 18 / audit HIGH #14). Cleared on rule delete + on stop.
   */
  ruleTextureFingerprints: new Map<string, string>(),

  /**
   * Per-frame scale re-asserter state (2026-06-27 — verified live: in-world
   * egg sprites are re-sized by the game's tile renderer every ~16-100ms,
   * stomping any sprite.scale we set in Layer B's PASS 2). For each sprite
   * with an active scale rule we store the |scaleX|, |scaleY| and re-assert
   * from a single app.ticker callback. Sign is read from the live sprite
   * each tick so any game-applied horizontal/vertical flip (e.g.
   * MarbleKnight's `scale.x = -1` mirroring) survives the re-assert.
   */
  scaledSpritesActive: new Set<object>(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scaledSpriteTargets: new WeakMap<object, { sx: number; sy: number }>(),
  scaleAsserterCallback: null as (() => void) | null,

  layerBStructureDirty: false,
  suppressChildAdded: false,

  contextRevision: 0,
  debugEnabled: false,
  layerBRefreshRunId: 0,
  layerBRefreshTimers: new Set<number>(),
  started: false,
  cleanups: [] as Array<() => void>,
};

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

export function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function parseAtlasKey(key: string): { category: SpriteCategory; id: string } {
  const parts = key.split('/').filter(Boolean);
  const start = parts[0] === 'sprite' ? 1 : 0;
  const category = (parts[start] ?? 'any') as SpriteCategory;
  const id = parts.slice(start + 1).join('/');
  return { category, id };
}

export function normalizeSpeciesMatchKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[\s_\-]+/g, '')
    .replace(/(seed|plant|baby|fruit|crop)$/i, '');
}
