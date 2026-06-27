// src/features/standalone/textureSwapper/rive/state.ts
// Cross-cutting module-scope state for the Rive pipeline. Extracted from
// riveAdapter.ts during the 2026-06-27 perf refactor (PR #1 of
// docs/superpowers/plans/2026-06-27-texture-swapper-perf.md).
//
// No init logic lives here — every WeakMap/Set is declared empty and populated
// by the apply functions in the sibling modules. The state lives at module
// scope (not on a context object) because the Rive prototype patches are
// global to the renderer.
//
// PIXI/Rive interop is deeply runtime-typed; the WeakMap/Set value types stay
// `unknown` (cast at narrowing boundaries) per the architecture.md "no any"
// invariant. Lifting these to typed shapes is a separate cleanup (LOW finding
// from the audit) and is intentionally NOT in scope for this PR.

// ─── Type aliases ─────────────────────────────────────────────────────────
// Defined locally to avoid an import cycle between state.ts and rainbow-lite.ts
// / rainbow-offscreen.ts. Sibling modules re-export these for consumer typing.

export interface RainbowOverlayState {
  /** Container sibling of riveSprite — holds mask + overlay. v8-legal. */
  wrapper: unknown;
  /** Sprite using riveSprite's texture as alpha-shape mask. */
  mask: unknown;
  /** Sprite using the fixed-size rainbow gradient. */
  overlay: unknown;
  /** Built once at GRADIENT_REF_SIZE square; never rebuilt. */
  gradTex: unknown;
  /** Last riveSprite.texture seen — for mask resync on Rive backing swap. */
  lastTextureRef: unknown | null;
}

export interface OffscreenRainbowState {
  filter: unknown;
  offscreenContainer: unknown;
  offscreenSprite: unknown;
  scratchTexture: unknown;
  /** Last rive backing texture seen — saved before we swap to scratch. */
  sourceTexture: unknown | null;
  lastWidth: number;
  lastHeight: number;
  /**
   * Dirty-gate fields (PR #4 task 19 / audit CRITICAL #5). renderOffscreenRainbow
   * is called every frame at ticker priority -10; without these the full
   * `renderer.render(...)` GPU pass runs per active pet per frame even when
   * nothing changed. Skip when source identity AND rendered uniforms match
   * the last successful render.
   */
  lastRenderedSourceIdentity: object | null;
  /** True until the first render completes, or whenever an input changes. */
  dirty: boolean;
}

// ─── Scale + alpha + texture overrides ────────────────────────────────────

/** Per-instance scale multiplier. Default 1.0 (no scaling). */
export const scaleMultipliers = new WeakMap<object, { x: number; y: number }>();

/**
 * Per-instance pre-rule alpha snapshot. Captured the first time we change a
 * Rive sprite's alpha; restored on revertAllRiveOverlays. Rive sprites bypass
 * Layer B's standard snapshot/restore path (setting sprite.texture on a Rive
 * sprite with a stale snapshot crashes the game's _setWidth override), so we
 * snapshot alpha narrowly here instead.
 */
export const riveAlphaSnapshots = new WeakMap<object, number>();

/**
 * Per-instance forced texture. When set, the patched `draw` method assigns
 * this texture to the sprite after the original draw runs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const riveTextureOverrides = new WeakMap<object, any>();

/**
 * Per-rule cache of clean Rive override textures. Built from the rule's
 * source canvas with default frame coords.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const riveOverrideTexCache = new Map<string, any>();

// ─── Captured constructors / prototype refs ───────────────────────────────

/**
 * Cached base PIXI.Sprite constructor, walked from the captured Rive subclass.
 * Resolved lazily by getBasePixiSpriteCtor() in detection.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cachedBasePixiSpriteRef: { value: any | null } = { value: null };

/**
 * Captured prototype refs of SharedRiveWorldRenderer / PIXI Sprite owners
 * holding the patched width/height setters. Stored as a mutable ref-cell
 * so the install/uninstall pair can swap them in and out atomically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const capturedRendererProtoRef: { value: any | null } = { value: null };

/**
 * Captured constructors of Rive sprite classes for `isRiveSprite` checks.
 * The game uses TWO sibling Rive classes — `RiveSprite` (pets, avatars) and
 * `SharedRiveSprite` (decor). We track all captured Rive ctors in a Set so
 * the `instanceof` check covers both. `capturedRiveSpriteCtorRef` keeps the
 * primary for prototype-chain walks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const capturedRiveSpriteCtors = new Set<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const capturedRiveSpriteCtorRef: { value: any | null } = { value: null };

/** Per-ctor original draw, so each captured Rive class can be unpatched cleanly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const capturedDrawsByCtor = new Map<any, (this: any, timeMs: number) => void>();

// ─── Mutation overlays + tracking ─────────────────────────────────────────

/**
 * Per-Rive-sprite map of mutation name → child overlay sprite.
 * WeakMap keyed by sprite so cleanup happens on GC.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mutationOverlaysBySprite = new WeakMap<object, Map<string, any>>();

/** Snapshot of Rive's last-seen texture per sprite, for per-frame sync. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lastRiveTexture = new WeakMap<object, any>();

/** Tracked sprites with active mutations — iterated by sync helpers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const activeRiveSprites = new Set<any>();

/**
 * Per-feature active-sprite sets (PR #5 task 24 / audit HIGH #23). Each ticker
 * iterates ONLY its own set, so a scale-only rule doesn't get polled by the
 * Rainbow ticker (and the ticker can uninstall when its set is empty).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const activeRainbowSprites = new Set<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const activeOffscreenSprites = new Set<any>();

// ─── Pet filters ──────────────────────────────────────────────────────────

/**
 * Per-pet-sprite map of ruleId → filter array we installed. We track separately
 * from sprite.filters so we can selectively clear OUR filters without
 * disturbing any game-applied filters that may have been there first.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const petFiltersBySprite = new WeakMap<object, Map<string, any[]>>();

// ─── Rainbow lite (Phase 4a) ──────────────────────────────────────────────

export const rainbowOverlaysBySprite = new WeakMap<
  object,
  Map<string, RainbowOverlayState>
>();

// ─── Rainbow filter (Phase 4b) ────────────────────────────────────────────
//
// PR #5 task 22 (2026-06-27 perf plan) removed `capturedFilterCtorRef` and
// `capturedGlProgramCtorRef` — both files that used them now share the single
// captured state in riveFilters.ts (via `hasFilterCtors()` /
// `tryCaptureFilterCtors()`).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rainbowFiltersBySprite = new WeakMap<object, Map<string, any>>();

// ─── Rainbow offscreen (Phase 4c) ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const capturedRenderTextureCtorRef: { value: any | null } = { value: null };

export const offscreenRainbowsBySprite = new WeakMap<
  object,
  Map<string, OffscreenRainbowState>
>();

// ─── Tickers ──────────────────────────────────────────────────────────────

export const rainbowTickerCallbackRef: { value: (() => void) | null } = { value: null };
export const offscreenTickerCallbackRef: { value: (() => void) | null } = { value: null };

// ─── Mutation badges (Phase 5) ────────────────────────────────────────────

/** Per-sprite badge map: ruleId+mutation → badge child sprite. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const badgesBySprite = new WeakMap<object, Map<string, any>>();

// ─── Static fallback (Phase 6) ────────────────────────────────────────────

/** Sprites whose visibility we've toggled. WeakMap for GC safety. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const staticFallbackToggled = new WeakMap<object, { rive: any; staticSprite: any }>();
