import { log, ctx } from './types';

// ---------------------------------------------------------------------------
// Rive filter shaders — ported from beta game source
//
// Beta references:
//   scraped-data/.../pixi/filters/ColorOverlayFilter.ts
//   scraped-data/.../pixi/filters/RainbowFilter.ts
//
// These shaders are constructed via captured PIXI.Filter + GlProgram
// constructors (see Phase 4b machinery in riveAdapter.ts). The captures are
// lazy — the first time a game-applied filter appears in the scene, we walk
// its prototype chain to grab Filter/GlProgram. Without those captures,
// callers fall back to overlay/gradient approximations.
//
// Why these are filters, not child sprites: pet RiveSprites render via
// `batchRenderer.markForRender(sprite)` and the batch renderer respects
// `sprite.filters`. Child overlay sprites don't show up in the rive pet's
// render path. This module is the filter-based pet mutation path that the
// game's PetView.applyMutationFilters uses verbatim (PetView.ts:434-461).
// ---------------------------------------------------------------------------

/**
 * Standard PIXI v8 filter vertex shader with coord passthrough. Used by both
 * the ColorOverlay and Rainbow fragment shaders below. Identical to beta's
 * RainbowFilter.ts VERTEX. Exported so the rive/ subfolder can reuse it
 * instead of carrying a duplicate (PR #5 task 21 of the 2026-06-27 perf plan).
 */
export const FILTER_VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
vec2 filterCoord(vec2 vTextureCoord) { return vTextureCoord * uInputSize.xy / uOutputFrame.zw; }
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
  vCoord = filterCoord(vTextureCoord);
}
`;

/**
 * Solid-color overlay fragment shader. Equivalent to beta's ColorOverlayFilter
 * (which extends ColorMatrixFilter) but written as a single shader pass so we
 * don't need to capture the ColorMatrixFilter subclass. Replaces base RGB with
 * the uniform color, mixes against original by uAlpha, preserves source alpha
 * via premultiplication.
 */
const COLOR_OVERLAY_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec3 uColor;
uniform float uAlpha;
void main(void) {
  vec4 base = texture(uTexture, vTextureCoord);
  if (base.a < 0.01) { finalColor = base; return; }
  vec3 baseRGB = base.rgb / max(base.a, 0.001);
  vec3 blended = mix(baseRGB, uColor, uAlpha);
  finalColor = vec4(blended * base.a, base.a);
}
`;

/**
 * Rainbow gradient with HSL color blend. Verbatim from beta's
 * RainbowFilter.ts FRAGMENT (we own the full shader source so the gradient
 * direction, squish, and aspect uniforms match the game's pet rainbow look).
 * Exported so the rive/ subfolder can reuse it (PR #5 task 21).
 */
export const RAINBOW_FRAGMENT = `
in vec2 vTextureCoord;
in vec2 vCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uAlpha;
uniform float uAngle;
uniform float uAspect;
uniform float uSquish;
uniform float uFlipX;
float getLuminosity(vec3 c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }
vec3 clipColor(vec3 c) {
  float l = getLuminosity(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + ((c - l) * l) / (l - n);
  if (x > 1.0) c = l + ((c - l) * (1.0 - l)) / (x - l);
  return c;
}
vec3 setLuminosity(vec3 c, float l) {
  float d = l - getLuminosity(c);
  return clipColor(c + d);
}
vec3 rainbowColor(float t) {
  vec3 colors[6];
  colors[0] = vec3(1.0, 0.09, 0.267);
  colors[1] = vec3(1.0, 0.569, 0.0);
  colors[2] = vec3(1.0, 0.918, 0.0);
  colors[3] = vec3(0.0, 0.902, 0.463);
  colors[4] = vec3(0.161, 0.475, 1.0);
  colors[5] = vec3(0.835, 0.0, 0.976);
  float offsets[6];
  offsets[0] = 0.0; offsets[1] = 0.2; offsets[2] = 0.4;
  offsets[3] = 0.6; offsets[4] = 0.8; offsets[5] = 1.0;
  for (int i = 0; i < 5; i++) {
    if (t >= offsets[i] && t <= offsets[i + 1]) {
      float local = (t - offsets[i]) / (offsets[i + 1] - offsets[i]);
      return mix(colors[i], colors[i + 1], local);
    }
  }
  return colors[5];
}
mat2 rotate2d(float angle) { return mat2(cos(angle), -sin(angle), sin(angle), cos(angle)); }
float projectLinearPosition(vec2 pos, float angle) {
  vec2 center = vec2(0.5);
  vec2 result = pos - center;
  result = rotate2d(angle) * result;
  result = result + center;
  return clamp(result.x, 0.0, 1.0);
}
void main(void) {
  vec4 base = texture(uTexture, vTextureCoord);
  if (base.a < 0.01) { finalColor = base; return; }
  float xCoord = mix(vCoord.x, 1.0 - vCoord.x, uFlipX);
  vec2 pos = vec2(xCoord, vCoord.y * uAspect);
  pos = (pos - 0.5) * uSquish + 0.5;
  float rad = uAngle * 3.14159265 / 180.0;
  float t = projectLinearPosition(pos, rad);
  vec3 rainbow = rainbowColor(t);
  vec3 baseRGB = base.rgb / max(base.a, 0.001);
  vec3 blended = setLuminosity(rainbow, getLuminosity(baseRGB));
  blended = mix(baseRGB, blended, uAlpha);
  finalColor = vec4(blended * base.a, base.a);
}
`;

// ---------------------------------------------------------------------------
// Lazy PIXI Filter / GlProgram capture (mirrors Phase 4b machinery)
// ---------------------------------------------------------------------------

let capturedFilterCtor: any | null = null;
let capturedGlProgramCtor: any | null = null;

/**
 * Try to find PIXI.Filter and PIXI.GlProgram constructors. Two paths in order:
 *
 *   1) Global PIXI namespace (window.PIXI / window.__PIXI__). The game bundle
 *      exposes its PIXI module on the page window — sprite-v2/utils.ts
 *      captures Texture/Sprite/Container/Rectangle off the same object. Filter
 *      and GlProgram are sibling exports; if PIXI is present, they're there.
 *      This path works even when no game-applied filters exist in the scene
 *      (e.g. no Celestial-rarity items, no Rainbow plant). Previously we only
 *      did the scene walk, so a no-filter scene meant Rainbow on pets fell
 *      back to the lite gradient — user-visible as "doesn't match native".
 *
 *   2) Scene-walk for any sprite with `filters[]` applied, then walk its
 *      prototype chain to find the base `Filter` class and grab `GlProgram`
 *      off the filter's `glProgram` instance.
 *
 * Idempotent — exits early once captured.
 */
export function tryCaptureFilterCtors(): boolean {
  if (capturedFilterCtor && capturedGlProgramCtor) return true;
  // Use the same window resolution as sprite-v2/utils.ts:getCtors — that
  // unsafeWindow path is verified to expose PIXI.{Texture,Sprite,...} in this
  // bundle, so Filter / GlProgram are sibling exports on the same object.
  const root: any = (typeof (globalThis as any).unsafeWindow !== 'undefined'
    ? (globalThis as any).unsafeWindow
    : (window as any));
  // Path 1 — global PIXI namespace.
  try {
    const P = root?.PIXI ?? root?.__PIXI__ ?? null;
    if (P?.Filter && P?.GlProgram && typeof P.GlProgram.from === 'function') {
      capturedFilterCtor = P.Filter;
      capturedGlProgramCtor = P.GlProgram;
      log('riveFilters: captured PIXI Filter + GlProgram from global PIXI');
      return true;
    }
  } catch {}
  // Path 2 — scene-walk for any game-applied filter.
  const app = root?.__PIXI_APP__ ?? root?.pixiApp ?? null;
  const renderer = ctx.currentSvc?.state?.renderer ?? null;
  const stage = app?.stage ?? renderer?.lastObjectRendered ?? null;
  if (!stage) return false;
  let firstFilter: any = null;
  const walk = (n: any) => {
    if (firstFilter || !n) return;
    if (Array.isArray(n.filters) && n.filters.length > 0) {
      firstFilter = n.filters[0];
      return;
    }
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  };
  walk(stage);
  if (!firstFilter) return false;
  let p = firstFilter.constructor;
  let baseFilter: any = null;
  while (p && p !== Function.prototype) {
    if (p.name === 'Filter') { baseFilter = p; break; }
    p = Object.getPrototypeOf(p);
  }
  const glProgram = firstFilter.glProgram;
  const glProgramCtor = glProgram?.constructor;
  if (!baseFilter || !glProgramCtor || typeof glProgramCtor.from !== 'function') {
    return false;
  }
  capturedFilterCtor = baseFilter;
  capturedGlProgramCtor = glProgramCtor;
  log('riveFilters: captured PIXI Filter + GlProgram via scene walk');
  return true;
}

/** Public: are the PIXI filter constructors captured yet? */
export function hasFilterCtors(): boolean {
  return !!(capturedFilterCtor && capturedGlProgramCtor);
}

// ---------------------------------------------------------------------------
// Filter builders
// ---------------------------------------------------------------------------

/** Parse `#rrggbb` or `rgb(r,g,b)` to a [r, g, b] tuple in 0..1 range. */
function parseColorTo01(input: string): [number, number, number] | null {
  if (!input) return null;
  const hex = /^#?([0-9a-f]{6})$/i.exec(input.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(input.trim());
  if (rgb) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  }
  return null;
}

/**
 * Build a ColorOverlayFilter — solid-color overlay with HSL-preserving alpha
 * mix. Game-equivalent of `new ColorOverlayFilter({color, alpha})` from beta's
 * createPetRiveSprite.ts:89. Returns null if PIXI filter ctors haven't been
 * captured yet.
 */
export function buildColorOverlayFilter(color: string, alpha: number): any | null {
  if (!tryCaptureFilterCtors()) return null;
  if (!capturedFilterCtor || !capturedGlProgramCtor) return null;
  const rgb = parseColorTo01(color);
  if (!rgb) {
    log('buildColorOverlayFilter: invalid color', color);
    return null;
  }
  try {
    const glProgram = capturedGlProgramCtor.from({
      vertex: FILTER_VERTEX,
      fragment: COLOR_OVERLAY_FRAGMENT,
    });
    return new capturedFilterCtor({
      glProgram,
      resources: {
        colorOverlayUniforms: {
          uColor: { value: rgb, type: 'vec3<f32>' },
          uAlpha: { value: alpha, type: 'f32' },
        },
      },
      padding: 0,
    });
  } catch (e) {
    log('buildColorOverlayFilter: construction failed', e);
    return null;
  }
}

/**
 * Build a RainbowFilter — verbatim shader port of beta's RainbowFilter.ts.
 * Default uniforms match the beta's pet rainbow (aspect = pet artboard
 * 600/850 ≈ 0.706, angle = 130, squish = 2.5, flipX = 1.0). Returns null
 * if PIXI filter ctors haven't been captured yet.
 */
export function buildRainbowFilterProper(options: {
  alpha?: number;
  angle?: number;
  aspect?: number;
  squish?: number;
  flipX?: boolean;
} = {}): any | null {
  if (!tryCaptureFilterCtors()) return null;
  if (!capturedFilterCtor || !capturedGlProgramCtor) return null;
  try {
    const glProgram = capturedGlProgramCtor.from({
      vertex: FILTER_VERTEX,
      fragment: RAINBOW_FRAGMENT,
    });
    return new capturedFilterCtor({
      glProgram,
      resources: {
        rainbowUniforms: {
          uAlpha: { value: options.alpha ?? 1.0, type: 'f32' },
          uAngle: { value: options.angle ?? 130, type: 'f32' },
          uAspect: { value: options.aspect ?? 600 / 850, type: 'f32' },
          uSquish: { value: options.squish ?? 2.5, type: 'f32' },
          uFlipX: { value: (options.flipX ?? true) ? 1.0 : 0.0, type: 'f32' },
        },
      },
      padding: 0,
    });
  } catch (e) {
    log('buildRainbowFilterProper: construction failed', e);
    return null;
  }
}

/**
 * Reset the captured ctors. Called by the riveAdapter disposer so a teardown
 * doesn't leave stale class references behind.
 */
export function clearCapturedFilterCtors(): void {
  capturedFilterCtor = null;
  capturedGlProgramCtor = null;
}
