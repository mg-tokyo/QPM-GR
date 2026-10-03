// GLSL 300 es for the 3D floor and horizon ring (PIXI 8 WebGL2 programs). The floor vertex shader runs the CPU
// projection (math/camera.ts project()) from uniforms and emits w = camera depth, so the GPU does perspective-correct
// texturing and clips at the CPU near plane.
export const GROUND_VS = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vWorld;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec2 uRegionOrigin;
uniform vec3 uCamPos;
uniform vec3 uCamF;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform float uFpx;
uniform vec2 uCenter;
uniform float uNear;
void main(void) {
  vec2 world = uRegionOrigin + aPosition;
  vWorld = world;
  vColor = uColor * uWorldColorAlpha;
  vec3 rel = vec3(world.x, 0.0, world.y) - uCamPos;
  float cz = dot(rel, uCamF);
  float cx = dot(rel, uCamR);
  float cy = dot(rel, uCamU);
  vec3 screenH = vec3(uCenter.x * cz + uFpx * cx, uCenter.y * cz - uFpx * cy, cz);
  vec3 clip = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * screenH;
  gl_Position = vec4(clip.xy, cz - 2.0 * uNear, cz);
}
`;

export const GROUND_FS = `#version 300 es
precision highp float;
in vec2 vWorld;
in vec4 vColor;
out vec4 finalColor;
uniform float uFarBlendPx;
uniform sampler2D uFarTexture;
uniform sampler2D uNearTexture;
uniform sampler2D uMapTexture;
uniform vec4 uFarRect;
uniform vec4 uNearRect;
uniform vec4 uMapRect;
uniform float uNearBlendPx;
uniform float uNearOn;
uniform float uMapOn;
void main(void) {
  vec2 farUV = (vWorld - uFarRect.xy) * uFarRect.zw;
  vec2 nearUV = (vWorld - uNearRect.xy) * uNearRect.zw;
  vec2 mapUV = (vWorld - uMapRect.xy) * uMapRect.zw;
  vec4 farC = texture(uFarTexture, farUV);
  vec4 nearC = texture(uNearTexture, nearUV);
  vec4 mapC = texture(uMapTexture, mapUV) * uMapOn;
  // The map bake clamps at its edge: outside the map only the far bake draws (whatever Ground shows there).
  mapC *= step(0.0, min(min(mapUV.x, mapUV.y), min(1.0 - mapUV.x, 1.0 - mapUV.y)));
  vec2 edgePx = min(nearUV, 1.0 - nearUV) / uNearRect.zw;
  float wNear = uNearOn * clamp(min(edgePx.x, edgePx.y) / uNearBlendPx, 0.0, 1.0);
  vec2 farEdgePx = min(farUV, 1.0 - farUV) / uFarRect.zw;
  float wFar = clamp(min(farEdgePx.x, farEdgePx.y) / uFarBlendPx, 0.0, 1.0);
  finalColor = mix(mix(mapC, farC, wFar), nearC, wNear) * vColor;
}
`;

// Area tiles (areaMesh.ts): each quad's corners are 2D world ground points, projected like the floor, so the GPU maps
// the game's tile texture in perspective (an affine sprite cannot: first person, user report 2026-10-03).
export const AREA_VS = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
in vec4 aColor;
out vec2 vUV;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec3 uCamPos;
uniform vec3 uCamF;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform float uFpx;
uniform vec2 uCenter;
uniform float uNear;
void main(void) {
  vUV = aUV;
  vColor = aColor * uColor * uWorldColorAlpha;
  vec3 rel = vec3(aPosition.x, 0.0, aPosition.y) - uCamPos;
  float cz = dot(rel, uCamF);
  vec3 screenH = vec3(uCenter.x * cz + uFpx * dot(rel, uCamR), uCenter.y * cz - uFpx * dot(rel, uCamU), cz);
  vec3 clip = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * screenH;
  gl_Position = vec4(clip.xy, cz - 2.0 * uNear, cz);
}
`;

export const AREA_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uAreaTexture;
void main(void) {
  finalColor = texture(uAreaTexture, vUV) * vColor;
}
`;

export const RING_VS = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vScreen;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec2 uScreen;
void main(void) {
  vec2 s = aPosition * uScreen;
  vScreen = s;
  vColor = uColor * uWorldColorAlpha;
  vec3 clip = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(s, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const RING_FS = `#version 300 es
precision highp float;
in vec2 vScreen;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uSkyTexture;
uniform vec3 uCamF;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform float uFpx;
uniform vec2 uCenter;
uniform float uRingN;
uniform float uH0;
uniform vec2 uStrip;
uniform float uBlend;
uniform vec4 uTopColor;
uniform vec4 uBotColor;
const float TAU = 6.283185307179586;
void main(void) {
  vec3 d = uCamF * uFpx + uCamR * (vScreen.x - uCenter.x) + uCamU * (uCenter.y - vScreen.y);
  float az = atan(d.x, -d.z);
  float el = atan(d.y, length(d.xz));
  float u = az / TAU * uRingN;
  float row = uH0 - el * uRingN * uStrip.x / TAU;
  vec2 uv = vec2(u, row / uStrip.y);
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  if (abs(gx.x) > 0.5 * uRingN) gx.x -= sign(gx.x) * uRingN;
  if (abs(gy.x) > 0.5 * uRingN) gy.x -= sign(gy.x) * uRingN;
  vec4 c = textureGrad(uSkyTexture, uv, gx, gy);
  c = mix(c, uTopColor, clamp(-row / uBlend, 0.0, 1.0));
  c = mix(c, uBotColor, clamp((row - uStrip.y) / uBlend, 0.0, 1.0));
  finalColor = c * vColor;
}
`;

// The game's weather pattern vertex shader ends with this statement; the mirror swaps it for the floor projection.
const WEATHER_POSITION = /gl_Position\s*=\s*vec4\(\(modelViewProjectionMatrix \* vec3\(aPosition, 1\.0\)\)\.xy, 0\.0, 1\.0\);/;
const WEATHER_MAIN = /void main\(void\)\s*\{/;
const WEATHER_UNIFORMS = [
  'uniform vec3 uCamPos;', 'uniform vec3 uCamF;', 'uniform vec3 uCamR;', 'uniform vec3 uCamU;', 'uniform float uFpx;', 'uniform vec2 uCenter;', 'uniform float uNear;',
  'uniform float uRadius;', 'uniform float uThinPx;', 'uniform float uStandScale;',
  'uniform float uStand;', 'uniform float uFlatAlpha;', 'uniform float uFootPx;',
  'out float vQAlpha;',
  'float qHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }',
  '',
].join('\n');
// Spec §6.8.1: uStand 0 is the floor projection exactly (s = 0); 1 stands each cell as a yaw-facing card on its foot
// row. Thinning, the radius fade and the proximity fade scale in with uStand; a zero-alpha cell is moved off-screen.
const WEATHER_PROJECTION = [
  'vec2 qFoot = aCell * uFrameSizePx + vec2(0.5 * uFrameSizePx.x, uFootPx);',
  '  vec2 qLocal = (aPosition - qFoot) * uStandScale;',
  '  vec3 qStand = vec3(qFoot.x + qLocal.x * uCamR.x, -qLocal.y, qFoot.y + qLocal.x * uCamR.z);',
  '  vec3 qRel = mix(vec3(aPosition.x, 0.0, aPosition.y), qStand, uStand) - uCamPos;',
  '  float qz = dot(qRel, uCamF);',
  '  vec3 qS = vec3(uCenter.x * qz + uFpx * dot(qRel, uCamR), uCenter.y * qz - uFpx * dot(qRel, uCamU), qz);',
  '  vec3 qClip = modelViewProjectionMatrix * qS;',
  '  float qD = length(qFoot - uCamPos.xz);',
  '  float qThin = mix(1.0, min(1.0, uThinPx / max(qD, 1.0)), uStand);',
  '  float qKeep = clamp((qThin + 0.125 - qHash(aCell)) * 8.0, 0.0, 1.0);',
  '  float qFar = (1.0 - smoothstep(0.75 * uRadius, uRadius, qD)) * clamp((qD - 128.0) / 256.0, 0.0, 1.0);',
  '  vQAlpha = uFlatAlpha * qKeep * mix(1.0, qFar, uStand);',
  '  gl_Position = vQAlpha <= 0.0 ? vec4(-2.0, -2.0, 0.0, 1.0) : vec4(qClip.xy, qz - 2.0 * uNear, qz);',
].join('\n');

// PIXI names a GlProgram only when its source has no SHADER_NAME yet, and caches compiled programs by source. The
// game's processed source keeps its name, so every mirror shared one cache key and only the first got its attributes.
export function stripShaderName(src: string): string {
  return src.replace(/^[ \t]*#define SHADER_NAME[^\n]*\n/gm, '');
}

/** The game's weather VS with the 3D projection and the stand/fade uniforms (spec §6.8.1); null on drift. */
export function patchWeatherVertex(vs: string): string | null {
  if (!WEATHER_POSITION.test(vs) || !WEATHER_MAIN.test(vs) || !vs.includes('precision highp float;\n')) return null;
  if (!/\bin vec2 aCell;/.test(vs) || !/uniform vec2 uFrameSizePx;/.test(vs)) return null;
  return stripShaderName(vs)
    .replace('precision highp float;\n', `precision highp float;\n${WEATHER_UNIFORMS}`)
    .replace(WEATHER_MAIN, (m) => `${m}\n  vQAlpha = uFlatAlpha;`)
    .replace(WEATHER_POSITION, WEATHER_PROJECTION);
}

const WEATHER_FRAG_OUT = /(finalColor\s*=\s*[^;]*\*\s*uOpacity)\s*;/;

/** The game's weather FS scaled by the mirror's per-cell alpha; null on drift (the mirror then keeps the game FS). */
export function patchWeatherFragment(fs: string): string | null {
  if (!WEATHER_FRAG_OUT.test(fs) || !fs.includes('precision highp float;\n')) return null;
  return stripShaderName(fs).replace('precision highp float;\n', 'precision highp float;\nin float vQAlpha;\n').replace(WEATHER_FRAG_OUT, '$1 * vQAlpha;');
}
