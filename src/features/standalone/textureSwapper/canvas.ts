import {
  log,
  ctx,
  parseAtlasKey,
} from './types';
import { renderBySpriteKey, getCropSpriteWithMutations } from '../../../sprite-v2/compat';
import { getFloraBlueprintSafe } from '../../../utils/game/catalogHelpers';
import type {
  TextureOverrideRule,
  TextureCanvasLayout,
  SpriteService,
  SpriteCategory,
} from './types';

// ---------------------------------------------------------------------------
// Low-level canvas helpers
// ---------------------------------------------------------------------------

export async function loadImageToCanvas(dataUrl: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) { resolve(null); return; }
      ctx2d.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function offscreenToCanvas(src: any): HTMLCanvasElement | null {
  try {
    const out = document.createElement('canvas');
    out.width = src.width as number;
    out.height = src.height as number;
    const ctx2d = out.getContext('2d');
    if (!ctx2d) return null;
    ctx2d.drawImage(src, 0, 0);
    return out;
  } catch {
    return null;
  }
}

function texToAtlasCanvas(tex: any): HTMLCanvasElement | null {
  try {
    const src: any = tex?.source?.resource?.source
      ?? tex?._source?.resource?.source
      ?? tex?._baseTexture?.resource?.source
      ?? null;
    const frame: any = tex?.frame ?? tex?._frame ?? null;
    if (!src || !frame || !(frame.width > 0)) return null;
    const c = document.createElement('canvas');
    c.width = Math.round(frame.width as number);
    c.height = Math.round(frame.height as number);
    const ctx2d = c.getContext('2d');
    if (!ctx2d) return null;
    ctx2d.drawImage(src, Math.round(-(frame.x as number)), Math.round(-(frame.y as number)));
    return c;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sprite rendering
// ---------------------------------------------------------------------------

/**
 * For plant category with a `${species}Plant` or `${species}Crop` suffix
 * (the editor's synthetic naming), resolve the REAL atlas key via the
 * flora blueprint. Multi-harvest species (Squash, Tomato, …) only register
 * `sprite/plant/${species}` — neither `${species}Plant` nor `${species}Crop`
 * exists, so the legacy paths 1–4 below all return null. Going through the
 * blueprint produces the correct per-component texture (plant body vs crop).
 */
function tryResolveViaBlueprint(
  category: SpriteCategory,
  id: string,
  mutations: string[],
): HTMLCanvasElement | null {
  if (category !== 'plant') return null;
  let realKey: string | null = null;
  let species: string | null = null;
  if (/Plant$/.test(id)) {
    species = id.replace(/Plant$/, '');
    realKey = getFloraBlueprintSafe(species)?.plantSpriteKey ?? null;
  } else if (/Crop$/.test(id)) {
    species = id.replace(/Crop$/, '');
    realKey = getFloraBlueprintSafe(species)?.cropSpriteKey ?? null;
  }
  if (!realKey) return null;
  try {
    const c = renderBySpriteKey(realKey, mutations);
    if (c && c.width > 0) {
      log(`renderSpriteToCanvas path0 blueprint ${species}→${realKey}: ${c.width}x${c.height}`);
      return c;
    }
  } catch (e) {
    log('renderSpriteToCanvas path0 blueprint threw:', e);
  }
  return null;
}

export function renderSpriteToCanvas(
  svc: SpriteService,
  category: SpriteCategory,
  id: string,
  mutations: string[] = [],
): HTMLCanvasElement | null {
  const blueprintCanvas = tryResolveViaBlueprint(category, id, mutations);
  if (blueprintCanvas) return blueprintCanvas;
  try {
    const c: any = svc.renderToCanvas({ category, id, mutations });
    log(`renderSpriteToCanvas path1 ${category}/${id}: got`, c ? `${Object.prototype.toString.call(c)} ${c.width}x${c.height}` : 'null');
    if (c instanceof HTMLCanvasElement && c.width > 0) return c;
    if (c && (c as any).width > 0) {
      const converted = offscreenToCanvas(c);
      log(`renderSpriteToCanvas offscreen→canvas: ${converted ? `${converted.width}x${converted.height}` : 'null'}`);
      if (converted) return converted;
    }
  } catch (e) {
    log('renderSpriteToCanvas path1 threw:', e);
  }
  try {
    const tex: any = (svc as any).getBaseSprite?.({ category, id });
    log(`renderSpriteToCanvas path2 ${category}/${id}: baseTex=`, tex ? `frame ${JSON.stringify(tex?.frame ?? tex?._frame)}` : 'null');
    if (tex) {
      const c = texToAtlasCanvas(tex);
      log(`renderSpriteToCanvas path2 atlas canvas: ${c ? `${c.width}x${c.height}` : 'null'}`);
      if (c) return c;
    }
  } catch (e) {
    log('renderSpriteToCanvas path2 threw:', e);
  }
  if (category === 'crop' || category === 'plant') {
    try {
      const species = id.replace(/Crop$/i, '');
      const c = getCropSpriteWithMutations(species, mutations);
      log(`renderSpriteToCanvas path3 cropCompat ${species}: got`, c ? `${c.width}x${c.height}` : 'null');
      if (c && c.width > 0) return c;
    } catch (e) {
      log('renderSpriteToCanvas path3 cropCompat threw:', e);
    }
  }
  try {
    const fullKey = `sprite/${category}/${id}`;
    const c = renderBySpriteKey(fullKey, mutations);
    log(`renderSpriteToCanvas path4 compat ${fullKey}: got`, c ? `${c.width}x${c.height}` : 'null');
    if (c && c.width > 0) return c;
  } catch (e) {
    log('renderSpriteToCanvas path4 threw:', e);
  }
  log(`renderSpriteToCanvas FAILED for ${category}/${id}`);
  return null;
}

// ---------------------------------------------------------------------------
// Tint
// ---------------------------------------------------------------------------

export function applyTintToCanvas(
  source: HTMLCanvasElement,
  color: string,
  strength: number,
  saturation: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx2d = out.getContext('2d');
  if (!ctx2d) return source;

  // 1. Base sprite
  ctx2d.drawImage(source, 0, 0);

  // 2. Multiply blend — matches PIXI's sprite.tint behaviour so the preview
  //    is consistent with what the on-stage live-overlay rule will produce.
  //    Strength interpolates the tint colour from white (no tint) toward the
  //    picked colour, then the multiply darkens the underlying pixels by
  //    that channel ratio. Color variation in the base (Rainbow/Gold) shows
  //    through because each channel is scaled independently.
  if (strength > 0) {
    const eff = lerpHexTowards('#ffffff', color, Math.max(0, Math.min(1, strength)));
    ctx2d.globalCompositeOperation = 'multiply';
    ctx2d.globalAlpha = 1;
    ctx2d.fillStyle = eff;
    ctx2d.fillRect(0, 0, out.width, out.height);
  }

  // 3. Optional saturation boost — keep the existing 'saturation' blend; this
  //    parameter is rarely used and the boost is subtle enough to leave alone.
  if (saturation > 0) {
    ctx2d.globalCompositeOperation = 'saturation';
    ctx2d.globalAlpha = Math.max(0, Math.min(1, saturation));
    ctx2d.fillStyle = color;
    ctx2d.fillRect(0, 0, out.width, out.height);
  }

  // 4. Mask to source alpha — guarantees transparent pixels stay transparent.
  //    Multiply blend already preserves transparency in modern browsers but
  //    this is a belt-and-braces guard for older composite implementations.
  ctx2d.globalCompositeOperation = 'destination-in';
  ctx2d.globalAlpha = 1;
  ctx2d.drawImage(source, 0, 0);

  ctx2d.globalCompositeOperation = 'source-over';
  return out;
}

function lerpHexTowards(fromHex: string, toHex: string, t: number): string {
  const parse = (h: string): [number, number, number] => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
    if (!m) return [0xff, 0xff, 0xff];
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  };
  const [fr, fg, fb] = parse(fromHex);
  const [tr, tg, tb] = parse(toHex);
  const r = Math.round(fr + (tr - fr) * t);
  const g = Math.round(fg + (tg - fg) * t);
  const b = Math.round(fb + (tb - fb) * t);
  return `#${[(r << 16) | (g << 8) | b].map((v) => v.toString(16).padStart(6, '0'))[0]}`;
}

// ---------------------------------------------------------------------------
// Texture dimension / layout
// ---------------------------------------------------------------------------

export function getRuleTargetTexture(rule: TextureOverrideRule, svc: SpriteService): any | null {
  const item = svc.state.items.find(it => it.key === rule.targetSpriteKey);
  return svc.state.tex.get(rule.targetSpriteKey) ?? item?.first ?? null;
}

export function getTextureCanvasLayout(tex: any): TextureCanvasLayout | null {
  if (!tex) return null;
  const canvasWidth = Math.round(
    Number(
      tex?.orig?.width
      ?? tex?._orig?.width
      ?? tex?.frame?.width
      ?? tex?._frame?.width
      ?? tex?.width
      ?? 0
    )
  );
  const canvasHeight = Math.round(
    Number(
      tex?.orig?.height
      ?? tex?._orig?.height
      ?? tex?.frame?.height
      ?? tex?._frame?.height
      ?? tex?.height
      ?? 0
    )
  );
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) {
    return null;
  }

  const trim = tex?.trim ?? tex?._trim ?? null;
  const trimWidth = Math.round(Number(trim?.width ?? 0));
  const trimHeight = Math.round(Number(trim?.height ?? 0));
  const hasTrim = Number.isFinite(trimWidth) && Number.isFinite(trimHeight) && trimWidth > 0 && trimHeight > 0;

  let contentX = hasTrim ? Math.round(Number(trim?.x ?? 0)) : 0;
  let contentY = hasTrim ? Math.round(Number(trim?.y ?? 0)) : 0;
  let contentWidth = hasTrim ? trimWidth : canvasWidth;
  let contentHeight = hasTrim ? trimHeight : canvasHeight;

  contentX = Math.max(0, Math.min(canvasWidth - 1, contentX));
  contentY = Math.max(0, Math.min(canvasHeight - 1, contentY));
  contentWidth = Math.max(1, Math.min(canvasWidth - contentX, contentWidth));
  contentHeight = Math.max(1, Math.min(canvasHeight - contentY, contentHeight));

  return { canvasWidth, canvasHeight, contentX, contentY, contentWidth, contentHeight };
}

export function resizeCanvasToLayout(source: HTMLCanvasElement, layout: TextureCanvasLayout): HTMLCanvasElement {
  const { canvasWidth, canvasHeight, contentX, contentY, contentWidth, contentHeight } = layout;
  const isIdentity = source.width === canvasWidth
    && source.height === canvasHeight
    && contentX === 0
    && contentY === 0
    && contentWidth === canvasWidth
    && contentHeight === canvasHeight;
  if (isIdentity) return source;
  const out = document.createElement('canvas');
  out.width = canvasWidth;
  out.height = canvasHeight;
  const ctx2d = out.getContext('2d');
  if (!ctx2d) return source;
  ctx2d.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx2d.imageSmoothingEnabled = false;
  const scale = Math.min(contentWidth / Math.max(1, source.width), contentHeight / Math.max(1, source.height));
  const drawWidth = Math.min(contentWidth, Math.max(1, Math.round(source.width * scale)));
  const drawHeight = Math.min(contentHeight, Math.max(1, Math.round(source.height * scale)));
  const offsetX = contentX + Math.floor((contentWidth - drawWidth) / 2);
  const offsetY = contentY + (contentHeight - drawHeight);
  ctx2d.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
  return out;
}

// ---------------------------------------------------------------------------
// Source + custom texture building
// ---------------------------------------------------------------------------

export async function buildSourceCanvas(rule: TextureOverrideRule, svc: SpriteService): Promise<HTMLCanvasElement | null> {
  if (rule.source.type === 'library' && rule.source.librarySpriteKey) {
    const { category, id } = parseAtlasKey(rule.source.librarySpriteKey);
    const canvas = renderSpriteToCanvas(svc, category, id);
    if (canvas) return canvas;
    log('buildSourceCanvas: library source failed for', rule.source.librarySpriteKey);
    return null;
  }

  if (rule.source.type === 'upload' && rule.source.uploadAssetId) {
    const dataUrl = ctx.state.uploadedAssets[rule.source.uploadAssetId];
    if (dataUrl) {
      const canvas = await loadImageToCanvas(dataUrl);
      if (canvas) return canvas;
    }
    log('buildSourceCanvas: upload source failed for', rule.source.uploadAssetId);
    return null;
  }

  const { category, id } = parseAtlasKey(rule.targetSpriteKey);
  // Force-none takes precedence: render the bare base without any mutation
  // overlay regardless of cosmeticMutations. cosmeticMutations is empty under
  // the mutual-exclusion contract enforced by the UI, but the guard is a
  // defensive belt-and-braces for legacy / corrupt data.
  const mutations = rule.forceNoMutations
    ? []
    : (rule.cosmeticMutations?.length ? rule.cosmeticMutations : []);
  return renderSpriteToCanvas(svc, category, id, mutations);
}

export async function buildCustomCanvas(rule: TextureOverrideRule, svc: SpriteService): Promise<HTMLCanvasElement | null> {
  const src = await buildSourceCanvas(rule, svc);
  if (!src || src.width === 0) return null;

  let out = src;
  if (rule.params.tintColor) {
    out = applyTintToCanvas(
      src,
      rule.params.tintColor,
      rule.params.tintAlpha ?? 0.5,
      rule.params.tintSaturation ?? 0,
    );
  }

  // Advanced-only (implicit-target) rules apply at runtime via sprite.tint —
  // the on-stage texture stays original. The customCanvas exists only for the
  // preview hero, so leave it at its natural render dimensions so users see
  // the actual sprite proportions rather than a stretched atlas-frame view.
  const isImplicitTarget = !rule.source.librarySpriteKey && !rule.source.uploadAssetId;
  if (!isImplicitTarget) {
    const targetTex = getRuleTargetTexture(rule, svc);
    const targetLayout = getTextureCanvasLayout(targetTex);
    if (targetLayout) {
      out = resizeCanvasToLayout(out, targetLayout);
    }
  }
  return out;
}

/**
 * Restore atlas trim geometry on a canvas-backed texture so a sprite swap
 * doesn't visibly grow.
 *
 * Trimmed atlas sprites have `frame.width × frame.height` (visible region)
 * smaller than `orig.width × orig.height` (untrimmed natural size). PIXI v8
 * sprites use `orig` for bounds and position the `frame` pixels at `trim`.
 * `Texture.from(canvas)` defaults frame = orig = canvas dims with no trim,
 * so the swapped sprite shows the entire canvas as visible region instead of
 * just the trimmed area. For DawnCelestialPlant that's 596×596 visible vs
 * the original 324×555 — what the user sees as "duplication slightly larger"
 * since the canvas region outside the original trim now has plant-tinted
 * content where the original was transparent. The renderer
 * (sprite-v2/renderer.ts:303-335) already positions the rendered content at
 * the trim offset within an orig-sized canvas, so the canvas pixels map
 * 1:1 to the original frame/orig/trim relationship — we just need to declare
 * that mapping on the new Texture.
 */
export function transferTrimGeometry(tex: any, refTex: any, ctors: { Rectangle: any }): void {
  if (!tex || !refTex || !ctors?.Rectangle) return;
  const refFrame = refTex.frame ?? refTex._frame ?? null;
  const refOrig = refTex.orig ?? refTex._orig ?? null;
  const refTrim = refTex.trim ?? refTex._trim ?? null;
  if (!refFrame || !refOrig) return;
  const isTrimmed = refFrame.width < refOrig.width || refFrame.height < refOrig.height;
  if (!isTrimmed) return;

  // Atlas-rotation guard. When the atlas stores the sprite at 90° rotation
  // (e.g. pet/WhiteCaribou is packed as 831×465 wide but the rendered
  // upright canvas is 465×831 tall), the atlas frame coords reference a
  // region in the ROTATED storage, not the upright canvas we just produced.
  // Blindly copying frame coords makes PIXI read outside canvas bounds and
  // shows a tiny crop of the wrong region — the "static zoomed in" pet
  // symptom in inventory/team/hutch UI sprites. When canvas dimensions are
  // transposed relative to refOrig, leave the default full-canvas frame in
  // place so PIXI displays the upright canvas as-is.
  const canvas: any = tex?.source?.resource ?? tex?._source?.resource ?? null;
  const canvasW = canvas?.width ?? 0;
  const canvasH = canvas?.height ?? 0;
  if (canvasW > 0 && canvasH > 0) {
    const origW = Number(refOrig.width);
    const origH = Number(refOrig.height);
    const matches = canvasW === origW && canvasH === origH;
    const transposed = !matches && canvasW === origH && canvasH === origW;
    if (transposed) {
      log('transferTrimGeometry: canvas transposed vs atlas orig — skipping trim transfer');
      return;
    }
  }
  const trimX = Number(refTrim?.x ?? 0);
  const trimY = Number(refTrim?.y ?? 0);
  const ow = Number(refOrig.width);
  const oh = Number(refOrig.height);
  // Resolve the new texture's frame width/height with three cases:
  //
  // 1) Atlas-rotated WITH trim (DawnCelestialPlant, MarbleBlobling,
  //    UncommonEgg, etc.) — refTrim.w/h describes the unrotated visible
  //    content. Use trim dimensions.
  //
  // 2) Atlas-rotated WITHOUT trim (LegendaryEgg, MythicalEgg, CommonEgg,
  //    DawnEgg, HorseEgg, SnowEgg, ThunderEgg, WinterEgg) — refTrim is
  //    absent because the sprite fills the full orig with no transparent
  //    padding, but the atlas still stores at 90°. The rotation signal
  //    survives in (frame.w === orig.h && frame.h === orig.w). Use orig
  //    dimensions as the unrotated content extent.
  //
  // 3) No rotation (Squash, DawnCelestialPlatform, RareEgg) — frame == orig.
  //    All paths give the same answer; use frame dimensions.
  //
  // Without this dual detector, refFrame.w/h (the rotated atlas-storage
  // dimensions) would be copied verbatim onto the new texture's frame,
  // pointing PIXI at a region whose width/height are swapped relative to the
  // actual canvas content — visually crops the right half / bottom half.
  // Verified 2026-06-27 via console probe.
  const trimW = Number(refTrim?.width);
  const trimH = Number(refTrim?.height);
  const hasTrim = Number.isFinite(trimW) && Number.isFinite(trimH);
  const fw = Number(refFrame.width);
  const fh = Number(refFrame.height);
  const frameVsOrigRotated = !hasTrim && fw === oh && fh === ow;
  const tw = hasTrim
    ? trimW
    : (frameVsOrigRotated ? ow : fw);
  const th = hasTrim
    ? trimH
    : (frameVsOrigRotated ? oh : fh);
  try {
    tex.frame = new ctors.Rectangle(trimX, trimY, tw, th);
    tex.orig = new ctors.Rectangle(0, 0, ow, oh);
    tex.trim = new ctors.Rectangle(trimX, trimY, tw, th);
  } catch {
    try {
      tex._frame = new ctors.Rectangle(trimX, trimY, tw, th);
      tex._orig = new ctors.Rectangle(0, 0, ow, oh);
      tex._trim = new ctors.Rectangle(trimX, trimY, tw, th);
    } catch { /* ignore */ }
  }
  const refAnchor = refTex.defaultAnchor;
  if (refAnchor) {
    const ax = Number(refAnchor.x ?? 0.5);
    const ay = Number(refAnchor.y ?? 0.5);
    try {
      if (tex.defaultAnchor?.set) {
        tex.defaultAnchor.set(ax, ay);
      } else if (tex.defaultAnchor) {
        tex.defaultAnchor.x = ax;
        tex.defaultAnchor.y = ay;
      } else {
        tex.defaultAnchor = { x: ax, y: ay };
      }
    } catch {}
  }
  try { tex.updateUvs?.(); } catch {}
}

export async function buildCustomTexture(rule: TextureOverrideRule, svc: SpriteService): Promise<any | null> {
  const ctors = svc.state.ctors;
  if (!ctors) {
    log('buildCustomTexture: no ctors available');
    return null;
  }

  const canvas = await buildCustomCanvas(rule, svc);
  if (!canvas) {
    log('buildCustomTexture: buildCustomCanvas returned null for rule', rule.id, rule.targetSpriteKey);
    return null;
  }
  log(`buildCustomTexture: canvas ${canvas.width}x${canvas.height}, calling Texture.from`);

  try {
    const tex = ctors.Texture.from(canvas);
    log('buildCustomTexture: Texture.from result', tex ? 'ok' : 'null/falsy', tex);
    if (tex) {
      const origTex = getRuleTargetTexture(rule, svc);
      transferTrimGeometry(tex, origTex, ctors);
    }
    return tex;
  } catch (e) {
    log('buildCustomTexture: Texture.from threw:', e);
    return null;
  }
}
