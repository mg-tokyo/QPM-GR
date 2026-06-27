// PIXI v8 ColorOverlay filter for live-overlay tint rules.
//
// Composes a picked colour ON TOP of a sprite's pixels using straight
// alpha-blend, masked by the sprite's source alpha so transparent regions
// stay transparent. This produces a true "overlay tint" — underlying colour
// variation (Rainbow / Gold mutations, base detail) shows through the wash
// in proportion to strength.
//
// Falls back to a no-op when PIXI's Filter / GlProgram constructors can't be
// resolved on the page (older builds, unusual bundles). Callers should treat
// `createColorOverlayFilter` returning null as "fall back to sprite.tint".

import { pageWindow } from '../../../core/pageContext';
import { log } from './types';

type PixiNamespace = {
  Filter?: any;
  GlProgram?: any;
  UniformGroup?: any;
  GpuProgram?: any;
};

function getPixi(): PixiNamespace | null {
  const root = pageWindow as Record<string, unknown>;
  const candidate = (root.PIXI ?? root.__PIXI__) as PixiNamespace | undefined;
  return candidate ?? null;
}

const VERTEX_GLSL = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`;

const FRAGMENT_GLSL = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uOverlayColor;
uniform float uOverlayAlpha;

void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  // Source comes in pre-multiplied alpha. Unpremultiply, alpha-blend the
  // overlay colour, then re-premultiply so the result composes correctly
  // with the rest of the scene.
  vec3 unmul = src.a > 0.0 ? src.rgb / src.a : src.rgb;
  vec3 mixed = mix(unmul, uOverlayColor, uOverlayAlpha);
  finalColor = vec4(mixed * src.a, src.a);
}
`;

/**
 * Build a fresh PIXI v8 Filter that alpha-blends `color` (RGB 0-1) on top of
 * a sprite's pixels at `alpha` (0-1). Returns null if PIXI's filter
 * constructors are unavailable or filter creation throws — callers should
 * then fall back to sprite.tint multiply.
 */
export function createColorOverlayFilter(
  color: [number, number, number],
  alpha: number,
): any | null {
  const PIXI = getPixi();
  if (!PIXI?.Filter || !PIXI?.GlProgram) {
    log('createColorOverlayFilter: PIXI.Filter / GlProgram unavailable');
    return null;
  }

  try {
    const glProgram = new PIXI.GlProgram({
      vertex: VERTEX_GLSL,
      fragment: FRAGMENT_GLSL,
      name: 'qpm-color-overlay',
    });

    // PIXI v8 expects a `resources` object keyed by shader uniform block name.
    // The fragment shader's free-standing uniforms collapse into the default
    // `globals` block at compile time — we provide a single uniform group
    // matching the shader's declared uniforms.
    const filter = new PIXI.Filter({
      glProgram,
      resources: {
        overlayUniforms: {
          uOverlayColor: { value: new Float32Array(color), type: 'vec3<f32>' },
          uOverlayAlpha: { value: alpha, type: 'f32' },
        },
      },
    });

    return filter;
  } catch (e) {
    log('createColorOverlayFilter failed', e);
    return null;
  }
}

/**
 * In-place update of a filter's uniforms. Safe to call repeatedly during
 * slider drags — PIXI re-uploads only the changed values. Returns true on
 * success, false if the filter shape doesn't match what we built.
 */
export function updateColorOverlayUniforms(
  filter: any,
  color: [number, number, number],
  alpha: number,
): boolean {
  try {
    const group = filter?.resources?.overlayUniforms;
    if (!group?.uniforms) return false;
    const colorUniform = group.uniforms.uOverlayColor;
    if (colorUniform?.value && colorUniform.value.length >= 3) {
      colorUniform.value[0] = color[0];
      colorUniform.value[1] = color[1];
      colorUniform.value[2] = color[2];
    } else {
      group.uniforms.uOverlayColor = { value: new Float32Array(color), type: 'vec3<f32>' };
    }
    group.uniforms.uOverlayAlpha = { value: alpha, type: 'f32' };
    if (typeof group.update === 'function') group.update();
    return true;
  } catch (e) {
    log('updateColorOverlayUniforms failed', e);
    return false;
  }
}

/** Convert "#rrggbb" to normalized RGB [0..1, 0..1, 0..1] for shader uniforms. */
export function hexToRgbNormalized(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
