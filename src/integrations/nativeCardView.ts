// src/integrations/nativeCardView.ts
//
// Bridge to the game's native InventoryCardView (PIXI canvas).
// Opens the game's own card UI with arbitrary phantom items so we can
// reuse its holographic frames, mutation overlays, and open animation
// instead of recreating them in DOM.

import { getAtomByLabel, readAtomValue } from '../core/jotaiBridge';
import { createNamedLogger } from '../diagnostics/logger';
import { healthBus } from '../diagnostics/healthBus';
import {
  setImageOverride,
  waitForInstance,
  findInstancesUnderPixiContainer,
  type RiveInstance,
} from '../rive-engine';

const cardLog = createNamedLogger('integrationNativeCard');
let cardBusRegistered = false;
let successfulOpens = 0;
let lastPublishedStatus: 'starting' | 'ok' | 'degraded' = 'starting';

function ensureCardBusRegistered(): void {
  if (cardBusRegistered) return;
  healthBus.register('integrationNativeCard', {
    category: 'integration',
    status: 'starting',
    message: 'Waiting for first open',
  });
  cardBusRegistered = true;
}

function publishCardOk(): void {
  // §7.2 — publish on first ok transition and after any degrade (the bus
  // coerces ok-out-of-degraded to recovering, which feeds the hysteresis
  // machine). Skip the no-op republish on the steady-state success path.
  if (lastPublishedStatus === 'ok') return;
  ensureCardBusRegistered();
  lastPublishedStatus = 'ok';
  healthBus.publish({
    subsystem: 'integrationNativeCard',
    status: 'ok',
    message: 'Card view ready',
    metrics: { opens: successfulOpens },
  });
}

/**
 * Register the integrationNativeCard subsystem so its row appears in
 * Diagnostics before the user ever opens a card. Called from main.ts during
 * Phase 9 alongside exposeAriesBridge(). Idempotent.
 */
export function startNativeCardViewDiagnostics(): void {
  ensureCardBusRegistered();
}

// NCARD-* codes warn, which the logger transport flips to bus 'degraded'.
// Track that locally so publishCardOk() knows to republish on the next
// successful resolve / open (the bus coerces to 'recovering' per §7.2).
function warnCard(code: 'QPM-NCARD-001' | 'QPM-NCARD-002' | 'QPM-NCARD-003', ctx: Record<string, unknown>, cause?: unknown): void {
  ensureCardBusRegistered();
  lastPublishedStatus = 'degraded';
  cardLog.warn(code, ctx, cause);
}

export interface PhantomInventoryItem {
  /** Unique phantom item id. Should not collide with real inventory item ids. */
  id: string;
  /** Item type — currently only 'Pet' is exercised. Other types may render differently. */
  itemType: 'Pet' | 'Egg' | 'Plant' | 'Crop' | 'Seed' | 'Tool';
  /** Must be a valid key in __QPM_CATALOGS.petCatalog. Invalid IDs crash the Rive renderer. */
  petSpecies?: string;
  /** Free-text display name. Unicode and emoji safe. */
  name: string;
  xp: number;
  hunger: number;
  /** Each entry must be a key in __QPM_CATALOGS.mutationCatalog. Invalid IDs crash every draw tick. */
  mutations: string[];
  /** Each entry must be a key in __QPM_CATALOGS.petAbilities. Unknown IDs crash every draw tick. */
  abilities: string[];
  abilityCooldowns: Record<string, number>;
  sourceEggId?: string;
  targetScale: number;
}

export interface SpeciesOverrides {
  /**
   * Rarity tier — drives the corner gem sprite and dust multiplier. Note: the
   * dex enum stringifies Mythic as `'Mythical'` at runtime (see
   * common/games/Quinoa/systems/rarity.ts:6: `Mythic = 'Mythical'`), so this
   * union uses `'Mythical'` to match what the card actually reads.
   */
  rarity?: 'Common' | 'Uncommon' | 'Rare' | 'Legendary' | 'Mythical' | 'Divine' | 'Celestial';
  /** Crop species ids (FloraSpeciesId) shown as diet sprites next to the hunger bar. */
  diet?: string[];
  /** Max hunger — drives the hunger bar denominator. */
  coinsToFullyReplenishHunger?: number;
  /** Mature weight in kg — multiplied by scale to produce the displayed weight number. */
  matureWeight?: number;
  /** Base sell price in coins — multiplied by mutations + scale in getPetSellPrice. */
  maturitySellPrice?: number;
}

export interface OpenNativeCardOptions {
  /** Pre-built origin sprite for the fly-in animation. Falls back to a borrowed sprite. */
  originSprite?: unknown;
  /**
   * Static image URL (PNG/JPG/first-frame GIF) to render as the custom portrait.
   * Mutually exclusive with `videoUrl` — `videoUrl` wins if both are set.
   */
  portraitUrl?: string;
  /**
   * Looping video URL (WebM/MP4) for an animated portrait. Renders via PIXI VideoTexture
   * backed by an off-DOM `<video>` element. Plays muted + looping + autoplaying to satisfy
   * browser autoplay policies. Audio is never played.
   */
  videoUrl?: string;
  /** Hide frame, gloss, name banner, abilities row, stats — show only the portrait. */
  fullTakeover?: boolean;
  /**
   * Live override of selected `faunaSpeciesDex[item.petSpecies]` fields for the duration
   * of this card's open lifecycle. Applied via mutate-and-restore (see applySpeciesOverrides).
   */
  overrides?: SpeciesOverrides;
  /**
   * Override image properties inside the pet's running Rive animation. Map of
   * `viewModel.image` property name → image URL or raw bytes. Different from
   * `portraitUrl` / `videoUrl` (which hide the Rive pet and overlay a PIXI
   * sprite): this leaves the Rive animation playing and swaps textures inside
   * it. The exact property names available on a pet bundle aren't documented
   * yet — use `__QPM_RIVE_ENGINE__.dumpPet()` with a card open to enumerate.
   * Overrides are scoped to this card open and auto-revert on close.
   */
  riveImageOverrides?: Record<string, string | Uint8Array>;
}

const OVERLAY_LABEL = 'qpm-card-overlay';
let cachedCardView: unknown = null;

// Active overlay handle — restored on next open() OR on close. One card open at a time.
let activeOverlay: OverlayHandle | null = null;

// Pending dex-override restore closure. Fires on close, on error inside open(),
// or is swept on the next openNativeCard() entry if a prior session leaked.
let pendingRestore: (() => void) | null = null;

interface OverlayHandle {
  restore: () => void;
}

const OVERRIDE_FIELDS = [
  'rarity',
  'diet',
  'coinsToFullyReplenishHunger',
  'matureWeight',
  'maturitySellPrice',
] as const;

/**
 * Locate the live `faunaSpeciesDex[species]` reference. Verified during the
 * implementation plan's Task 0 — `__QPM_CATALOGS.petCatalog` IS the live
 * reference the card visual reads (mutating it propagates to the open card).
 */
function locateSpeciesDexEntry(species: string | undefined): Record<string, unknown> | null {
  if (!species) return null;
  const dex = (window as any).__QPM_CATALOGS?.petCatalog;
  if (!dex || typeof dex !== 'object') return null;
  const entry = dex[species];
  return entry && typeof entry === 'object' ? entry : null;
}

/**
 * Apply selected `faunaSpeciesDex[species]` field overrides. Returns a restore
 * closure that writes the originals back. Restore is idempotent — safe to call
 * twice. Returns a no-op restore when overrides is undefined, empty, or the
 * dex entry is missing.
 */
function applySpeciesOverrides(
  entry: Record<string, unknown> | null,
  overrides: SpeciesOverrides | undefined,
): () => void {
  if (!entry || !overrides) return () => {};
  const stash: Record<string, unknown> = {};
  let touchedAny = false;
  for (const field of OVERRIDE_FIELDS) {
    const next = (overrides as Record<string, unknown>)[field];
    if (next === undefined) continue;
    stash[field] = entry[field];
    entry[field] = next;
    touchedAny = true;
  }
  if (!touchedAny) return () => {};
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const [field, original] of Object.entries(stash)) {
      entry[field] = original;
    }
  };
}

async function resolveCardView(): Promise<any | null> {
  // Re-walk each call — engine atom can become null on game reconnect,
  // and beta builds can change the chain structure.
  try {
    const atom = getAtomByLabel('quinoaEngineAtom');
    if (!atom) {
      warnCard('QPM-NCARD-001', { reason: 'atom_missing' });
      return null;
    }
    const engine = await readAtomValue<any>(atom);
    if (!engine || typeof engine.getSystem !== 'function') {
      warnCard('QPM-NCARD-001', { reason: 'engine_invalid' });
      cachedCardView = null;
      return null;
    }
    const inventorySystem = engine.getSystem('inventory');
    const modalView = inventorySystem?.modalView;
    const cardView = modalView?.inventoryCardView;
    if (!cardView || typeof cardView.open !== 'function') {
      warnCard('QPM-NCARD-001', { reason: 'cardview_missing' });
      cachedCardView = null;
      return null;
    }
    cachedCardView = cardView;
    return cardView;
  } catch (err) {
    warnCard('QPM-NCARD-001', { reason: 'exception' }, err);
    return null;
  }
}

function getOriginSprite(cv: any): any | null {
  // Prefer the cardView's existing originSprite if it's alive — has a meaningful screen position.
  if (cv.originSprite && !cv.originSprite.destroyed) {
    return cv.originSprite;
  }
  // PIXI isn't exposed on window — it's minified inside the game's chunks. Borrow
  // the Sprite class from an existing sprite on the cardView itself; those are
  // created in the InventoryCardView constructor and always present.
  const refSprite = cv.cardBottom ?? cv.cardMiddle ?? cv.cardGloss;
  const SpriteClass = refSprite?.constructor;
  if (typeof SpriteClass === 'function') {
    try {
      const texture = refSprite.texture ?? refSprite._texture;
      return texture ? new SpriteClass(texture) : new SpriteClass();
    } catch (err) {
      warnCard('QPM-NCARD-002', { what: 'sprite_build' }, err);
    }
  }
  return null;
}

interface PortraitSource {
  /** Naturally-sized HTMLImageElement or HTMLVideoElement, ready to render. */
  element: HTMLImageElement | HTMLVideoElement;
  /** Detached video stays referenced here so it isn't GC'd while the texture is live. */
  videoRef?: HTMLVideoElement;
  /** Source-native dimensions (independent of any PIXI scaling). */
  width: number;
  height: number;
}

function loadImageSource(url: string): Promise<PortraitSource> {
  return new Promise(function(resolve, reject) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      resolve({ element: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = function() { reject(new Error('image load failed: ' + url)); };
    img.src = url;
  });
}

// HTMLVideoElement → PIXI VideoSource is auto-detected by Texture.from() in v8.
// The video must be muted + playing for browser autoplay policies + PIXI frame updates.
function loadVideoSource(url: string): Promise<PortraitSource> {
  return new Promise(function(resolve, reject) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true;
    (video as any).playsInline = true;
    video.autoplay = true;
    video.preload = 'auto';
    let resolved = false;
    const onReady = function() {
      if (resolved) return;
      resolved = true;
      // play() may be rejected under strict autoplay policies; PIXI still gets frames once the user clicks.
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function() { /* will resume on user gesture */ });
      resolve({
        element: video,
        videoRef: video,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
      });
    };
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', function() { reject(new Error('video load failed: ' + url)); }, { once: true });
    video.src = url;
  });
}

// PIXI v8's Texture.from(url) returns a placeholder until the asset loads via the Assets cache.
// Loading via HTMLImageElement/HTMLVideoElement first guarantees PIXI gets real pixels synchronously
// and triggers PIXI's auto-detected source path (ImageSource / VideoSource).
function buildSpriteFromSource(cv: any, src: PortraitSource): any | null {
  const SpriteClass = cv.cardBottom?.constructor;
  const TextureClass = cv.cardBottom?.texture?.constructor;
  if (typeof SpriteClass !== 'function' || typeof TextureClass?.from !== 'function') {
    warnCard('QPM-NCARD-002', { what: 'sprite_class_missing' });
    return null;
  }
  try {
    const sprite = new SpriteClass(TextureClass.from(src.element));
    if (src.videoRef) {
      // Keep the video reference alive on the sprite so it isn't GC'd before PIXI texture cleanup.
      (sprite as any).__qpmVideoRef = src.videoRef;
    }
    return sprite;
  } catch (err) {
    warnCard('QPM-NCARD-002', { what: 'sprite_build' }, err);
    return null;
  }
}

function teardownOverlaySprite(overlay: any): void {
  const video = (overlay as any).__qpmVideoRef as HTMLVideoElement | undefined;
  if (video) {
    try { video.pause(); } catch { /* best effort */ }
    video.src = '';
    video.load();
    delete (overlay as any).__qpmVideoRef;
  }
  if (overlay.parent) overlay.parent.removeChild(overlay);
  overlay.destroy?.();
}

// Portrait-only overlay: replaces just the Rive pet, keeps native frame/banner/abilities.
function applyPortraitOverlay(cv: any, src: PortraitSource): OverlayHandle | null {
  const overlay = buildSpriteFromSource(cv, src);
  if (!overlay) return null;
  const rive = cv.cardVisual?.petRiveSprite;
  const riveWasVisible = !!rive?.visible;
  if (rive) rive.visible = false;

  overlay.label = OVERLAY_LABEL;
  overlay.anchor?.set?.(0.5, 0.5);
  overlay.x = rive?.x ?? 0;
  overlay.y = rive?.y ?? 17;
  overlay.width = rive?.width ?? 353;
  overlay.height = rive?.height ?? 499;

  const parent = cv.cardVisual?.container;
  if (!parent) return null;
  parent.addChild(overlay);

  return {
    restore: function() {
      if (rive) rive.visible = riveWasVisible;
      teardownOverlaySprite(overlay);
    },
  };
}

// Full-card takeover: hides every native chrome element, image dominates the whole card face.
function applyFullTakeover(cv: any, src: PortraitSource): OverlayHandle | null {
  const overlay = buildSpriteFromSource(cv, src);
  if (!overlay) return null;

  const frameW = cv.cardBottom?.width ?? 500;
  const frameH = cv.cardBottom?.height ?? 720;
  const sw = frameW / (src.width || frameW);
  const sh = frameH / (src.height || frameH);
  // Fit by the larger axis so the overlay fills the frame edge-to-edge (slight overflow on smaller axis).
  const scale = Math.max(sw, sh);

  overlay.label = OVERLAY_LABEL;
  overlay.anchor?.set?.(0.5, 0.5);
  overlay.x = 0;
  overlay.y = 0;
  overlay.width = (src.width || frameW) * scale;
  overlay.height = (src.height || frameH) * scale;

  const cardBottomWasVisible = !!cv.cardBottom?.visible;
  const cardMiddleWasVisible = !!cv.cardMiddle?.visible;
  const cardGlossWasVisible = !!cv.cardGloss?.visible;
  if (cv.cardBottom) cv.cardBottom.visible = false;
  if (cv.cardMiddle) cv.cardMiddle.visible = false;
  if (cv.cardGloss) cv.cardGloss.visible = false;

  // Stash + hide every child of cardVisual.container (name, abilities, stats, tooltips, Rive pet).
  const stash: Array<[any, boolean]> = [];
  const visualChildren = cv.cardVisual?.container?.children;
  if (Array.isArray(visualChildren)) {
    visualChildren.forEach(function(child: any) {
      stash.push([child, !!child.visible]);
      child.visible = false;
    });
  }

  const cardContainer = cv.cardContainer;
  if (!cardContainer) {
    if (cv.cardBottom) cv.cardBottom.visible = cardBottomWasVisible;
    if (cv.cardMiddle) cv.cardMiddle.visible = cardMiddleWasVisible;
    if (cv.cardGloss) cv.cardGloss.visible = cardGlossWasVisible;
    return null;
  }
  cardContainer.addChild(overlay);

  return {
    restore: function() {
      if (cv.cardBottom) cv.cardBottom.visible = cardBottomWasVisible;
      if (cv.cardMiddle) cv.cardMiddle.visible = cardMiddleWasVisible;
      if (cv.cardGloss) cv.cardGloss.visible = cardGlossWasVisible;
      stash.forEach(function(pair) { pair[0].visible = pair[1]; });
      teardownOverlaySprite(overlay);
    },
  };
}

/**
 * Schedule Rive image-property overrides on the pet instance inside the card.
 *
 * Returns a restore closure that aborts the async resolution if it hasn't
 * matched yet, AND disposes every override that did get applied. Call sites
 * compose this into `pendingRestore` so card close cleans everything up.
 *
 * Resolution strategy:
 *   1. Sync lookup via `findInstancesUnderPixiContainer(cv.cardVisual.container)`
 *      — covers the case where the pet Rive is already registered.
 *   2. Otherwise subscribe with `waitForInstance` and a 2-second timeout. The
 *      predicate re-checks ancestor reachability on each newly-registered
 *      instance so we only match Rives that sit under THIS card.
 *
 * Soft-fails on timeout / missing container / engine not ready — we log info
 * (`QPM-NCARD-005`) and return a no-op restore. The card still opens cleanly.
 */
function scheduleRiveImageOverrides(
  cv: any,
  overrides: Record<string, string | Uint8Array>,
): () => void {
  const entries = Object.entries(overrides);
  if (entries.length === 0) return () => {};

  const cardContainer = cv?.cardVisual?.container as object | undefined;
  if (!cardContainer) {
    cardLog.info('QPM-NCARD-005 rive override skipped', { reason: 'no_card_container' });
    return () => {};
  }

  // Per-open session — `aborted` short-circuits the async chain if the
  // user closes the card before the pet Rive registers or before every
  // override has been applied.
  const session = { aborted: false, disposers: [] as Array<() => void> };

  void (async () => {
    // Sync first — covers re-opens where the pet Rive registered long ago.
    let petInstance: RiveInstance | null =
      findInstancesUnderPixiContainer(cardContainer)[0] ?? null;

    if (!petInstance) {
      petInstance = await waitForInstance(
        (inst) =>
          findInstancesUnderPixiContainer(cardContainer).some(
            (m) => m.id === inst.id,
          ),
        2000,
      );
    }

    if (session.aborted) return;
    if (!petInstance) {
      cardLog.info('QPM-NCARD-005 rive override skipped', {
        reason: 'pet_instance_not_found',
        propertyCount: entries.length,
      });
      return;
    }

    for (const [property, image] of entries) {
      if (session.aborted) return;
      const dispose = setImageOverride({
        target: { type: 'instance', id: petInstance.id },
        property,
        image,
      });
      session.disposers.push(dispose);
    }
  })();

  return () => {
    session.aborted = true;
    for (const dispose of session.disposers) {
      try { dispose(); } catch { /* best effort */ }
    }
    session.disposers.length = 0;
  };
}

// Wrap forceClose so native state is restored when the user closes the card.
// One-shot — unwraps itself after firing.
function wrapCloseForRestore(cv: any): void {
  const originalForceClose = cv.forceClose;
  if (typeof originalForceClose !== 'function') return;
  cv.forceClose = function patchedForceClose(this: any, ...args: any[]) {
    cv.forceClose = originalForceClose;
    try {
      if (activeOverlay) {
        activeOverlay.restore();
        activeOverlay = null;
      }
    } catch (err) {
      warnCard('QPM-NCARD-003', { what: 'overlay_restore' }, err);
    }
    try {
      if (pendingRestore) {
        pendingRestore();
        pendingRestore = null;
      }
    } catch (err) {
      warnCard('QPM-NCARD-003', { what: 'dex_restore' }, err);
    }
    return originalForceClose.apply(this, args);
  };
}

/**
 * Open the native card view with a phantom item. Returns true on success.
 *
 * Phantom items have fake IDs — if a user clicks Sell/Feed/etc the server
 * will reject the resulting WS message. The Sell/Feed/Favorite buttons
 * don't render on phantom Pet cards anyway (they live in InventoryModalView).
 *
 * Backwards-compat: second arg accepts the legacy raw originSprite OR a new options object.
 */
export async function openNativeCard(
  item: PhantomInventoryItem,
  optionsOrOriginSprite?: OpenNativeCardOptions | unknown
): Promise<boolean> {
  const options: OpenNativeCardOptions =
    optionsOrOriginSprite && typeof optionsOrOriginSprite === 'object' &&
    ('originSprite' in (optionsOrOriginSprite as object) ||
     'portraitUrl' in (optionsOrOriginSprite as object) ||
     'videoUrl' in (optionsOrOriginSprite as object) ||
     'fullTakeover' in (optionsOrOriginSprite as object) ||
     'overrides' in (optionsOrOriginSprite as object) ||
     'riveImageOverrides' in (optionsOrOriginSprite as object))
      ? (optionsOrOriginSprite as OpenNativeCardOptions)
      : { originSprite: optionsOrOriginSprite };

  // Sweep any leftover patch from a prior open whose restore never fired
  // (engine reload, hot-reload, uncaught exception).
  if (pendingRestore) {
    try { pendingRestore(); } catch { /* best effort */ }
    pendingRestore = null;
  }

  const cv = await resolveCardView();
  if (!cv) return false;

  // Pre-load the portrait source BEFORE open() so there's no Capybara flash.
  // videoUrl wins if both are set — animation beats static image.
  let portraitSrc: PortraitSource | null = null;
  if (options.videoUrl) {
    try {
      portraitSrc = await loadVideoSource(options.videoUrl);
    } catch (err) {
      // QPM-NCARD-004 (info-severity, recoverable): fall back to portraitUrl
      // if it's set. Routed via info() not warn() so the bus stays clean.
      cardLog.info('QPM-NCARD-004 portrait asset failed', { what: 'video', error: String(err) });
    }
  }
  if (!portraitSrc && options.portraitUrl) {
    try {
      portraitSrc = await loadImageSource(options.portraitUrl);
    } catch (err) {
      cardLog.info('QPM-NCARD-004 portrait asset failed', { what: 'image', error: String(err) });
    }
  }

  const sprite = options.originSprite ?? getOriginSprite(cv);
  if (!sprite) {
    warnCard('QPM-NCARD-002', { what: 'no_sprite' });
    return false;
  }

  const dexEntry = locateSpeciesDexEntry(item.petSpecies);
  const restoreOverrides = applySpeciesOverrides(dexEntry, options.overrides);
  pendingRestore = restoreOverrides;

  try {
    // Clean up any previous overlay before opening a new card.
    if (activeOverlay) {
      try { activeOverlay.restore(); } catch { /* best effort */ }
      activeOverlay = null;
    }
    // Always force-close stale state first — leaving an old activeItem set
    // causes per-frame error spam if THAT item was broken.
    if (cv.isOpen && typeof cv.forceClose === 'function') {
      cv.forceClose();
    }
    cv.open(item, sprite);

    if (portraitSrc) {
      activeOverlay = options.fullTakeover
        ? applyFullTakeover(cv, portraitSrc)
        : applyPortraitOverlay(cv, portraitSrc);
    }

    // Rive image-property overrides are scheduled AFTER cv.open() because the
    // pet Rive instance only registers when the card mounts. Compose the
    // restore closure into pendingRestore so close cleans both up. If the
    // dex restore was a no-op, the composed restore still carries the rive
    // disposers — that's why we check the option presence, not pendingRestore.
    if (options.riveImageOverrides) {
      const restoreRive = scheduleRiveImageOverrides(cv, options.riveImageOverrides);
      const priorRestore = pendingRestore;
      pendingRestore = () => {
        try { restoreRive(); } catch { /* best effort */ }
        if (priorRestore) {
          try { priorRestore(); } catch { /* best effort */ }
        }
      };
    }

    if (activeOverlay || pendingRestore !== null) {
      wrapCloseForRestore(cv);
    }
    successfulOpens += 1;
    publishCardOk();
    return true;
  } catch (err) {
    warnCard('QPM-NCARD-002', { what: 'open' }, err);
    try { cv.forceClose?.(); } catch { /* best effort */ }
    if (activeOverlay) {
      try { activeOverlay.restore(); } catch { /* best effort */ }
      activeOverlay = null;
    }
    // Restore the dex overrides we just applied, since cv.open never settled.
    // Note: if the rive-override composition already replaced pendingRestore,
    // restoreOverrides is captured in that closure and gets called there.
    // We still fire restoreOverrides directly here as a defensive belt — it's
    // idempotent (applySpeciesOverrides guards with a `restored` flag).
    try { restoreOverrides(); } catch { /* best effort */ }
    if (pendingRestore) {
      try { pendingRestore(); } catch { /* best effort */ }
    }
    pendingRestore = null;
    return false;
  }
}

/** Close the native card view if it's currently displaying. */
export function closeNativeCard(): boolean {
  const cv = cachedCardView as { forceClose?: () => void } | null;
  if (cv?.forceClose) {
    try {
      cv.forceClose();
      return true;
    } catch (err) {
      warnCard('QPM-NCARD-003', { what: 'force_close' }, err);
    }
  }
  return false;
}
