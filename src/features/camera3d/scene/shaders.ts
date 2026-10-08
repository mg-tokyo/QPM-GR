// GLSL 300 es for the 3D floor, area tiles, fence walls and horizon ring (PIXI 8 WebGL2 programs).
import type { Caps } from '../types';
import type { HashFn } from './weatherPhases';

// The CPU projection (math/camera.ts project()) from the shared camera group (camUniforms.ts), with w = camera depth:
// the GPU texturing is perspective-correct and clips at the CPU near plane. PIXI's globals come first.
const PROJECT_GLSL = `uniform mat3 uProjectionMatrix;
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
vec4 qpmProject(vec3 p) {
  vec3 rel = p - uCamPos;
  float cz = dot(rel, uCamF);
  vec3 screenH = vec3(uCenter.x * cz + uFpx * dot(rel, uCamR), uCenter.y * cz - uFpx * dot(rel, uCamU), cz);
  vec3 clip = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * screenH;
  return vec4(clip.xy, cz - 2.0 * uNear, cz);
}`;

export const GROUND_VS = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vWorld;
out vec4 vColor;
${PROJECT_GLSL}
uniform vec2 uRegionOrigin;
void main(void) {
  vec2 world = uRegionOrigin + aPosition;
  vWorld = world;
  vColor = uColor * uWorldColorAlpha;
  gl_Position = qpmProject(vec3(world.x, 0.0, world.y));
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
uniform vec2 uWrap;
void main(void) {
  vec2 farUV = (vWorld - uFarRect.xy) * uFarRect.zw;
  vec2 nearUV = (vWorld - uNearRect.xy) * uNearRect.zw;
  vec2 mapUV = (vWorld - uMapRect.xy) * uMapRect.zw;
  // A toroidal bake (uWrap) holds world texel mod its side, sampled with REPEAT; same derivatives, so the same mip.
  vec4 farC = texture(uFarTexture, uWrap.y > 0.5 ? vWorld * uFarRect.zw : farUV);
  vec4 nearC = texture(uNearTexture, uWrap.x > 0.5 ? vWorld * uNearRect.zw : nearUV);
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
${PROJECT_GLSL}
void main(void) {
  vUV = aUV;
  vColor = aColor * uColor * uWorldColorAlpha;
  gl_Position = qpmProject(vec3(aPosition.x, 0.0, aPosition.y));
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

// A fence wall near the lens (wallGeom.ts): its four corners are world points with height, projected like the floor,
// so the GPU maps the panel art in perspective and clips at the near plane. Drawn with AREA_FS.
export const WALL_VS = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec2 aUV;
out vec2 vUV;
out vec4 vColor;
${PROJECT_GLSL}
void main(void) {
  vUV = aUV;
  vColor = uColor * uWorldColorAlpha;
  gl_Position = qpmProject(aPosition);
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
  'uniform float uRadius;', 'uniform float uThinPx;', 'uniform float uStandScale;', 'uniform vec2 uSortDir;', 'uniform float uNearTall;', 'uniform float uNearPx;',
  'uniform float uStand;', 'uniform float uFlatAlpha;', 'uniform float uFootPx;', 'uniform vec2 uSlab;', 'uniform float uStandTiles;',
  'out float vQAlpha;', 'flat out vec2 vQCell;', 'out float vQH;',
  'float qHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }',
  '',
].join('\n');
// Spec §6.8.1: uStand 0 is the floor projection exactly (s = 0); 1 stands each cell as a yaw-facing card on its foot
// row. Thinning, the radius fade and the proximity fade scale in with uStand; a zero-alpha cell is moved off-screen.
// uSlab: the [lo, hi) of foot rows along uSortDir this mesh draws (P9 depth slabs; open for the single mesh).
// Tall cards (patchWeatherTall repeats the art up them): the top is the eye height, at most uStandTiles frames, so no drop
// draws over the sky (user, 10-06); first person (uNearTall) lifts the cards within uNearPx to the full height.
const WEATHER_PROJECTION = [
  'vec2 qFoot = aCell * uFrameSizePx + vec2(0.5 * uFrameSizePx.x, uFootPx);',
  '  vec2 qLocal = (aPosition - qFoot) * uStandScale;',
  '  float qD = length(qFoot - uCamPos.xz);',
  '  float qF = max(uFootPx * uStandScale, 1.0);',
  '  float qMax = uStandTiles * qF;',
  '  float qTop = min(max(uCamPos.y, 1.0), qMax);',
  '  qTop = mix(qTop, mix(qMax, qTop, smoothstep(uNearPx, 2.0 * uNearPx, qD)), uNearTall);',
  '  float qK = uStandTiles > 1.0 ? mix(1.0, qTop / qF, uStand) : 1.0;',
  '  vLocalPx.y = uFootPx - (uFootPx - vLocalPx.y) * qK;',
  '  vQCell = aCell;',
  '  vQH = uStandTiles > 1.0 ? uStand * (qFoot.y - aPosition.y) / max(uFootPx, 1.0) : 0.0;',
  '  vec3 qStand = vec3(qFoot.x + qLocal.x * uCamR.x, -qLocal.y * qK, qFoot.y + qLocal.x * uCamR.z);',
  '  vec3 qRel = mix(vec3(aPosition.x, 0.0, aPosition.y), qStand, uStand) - uCamPos;',
  '  float qz = dot(qRel, uCamF);',
  '  vec3 qS = vec3(uCenter.x * qz + uFpx * dot(qRel, uCamR), uCenter.y * qz - uFpx * dot(qRel, uCamU), qz);',
  '  vec3 qClip = modelViewProjectionMatrix * qS;',
  '  float qThin = mix(1.0, min(1.0, uThinPx / max(qD, 1.0)), uStand);',
  '  float qKeep = clamp((qThin + 0.125 - qHash(aCell)) * 8.0, 0.0, 1.0);',
  '  float qFar = (1.0 - smoothstep(0.75 * uRadius, uRadius, qD)) * clamp((qD - 128.0) / 256.0, 0.0, 1.0);',
  '  float qAlong = dot(qFoot, uSortDir);',
  '  vQAlpha = uFlatAlpha * qKeep * mix(1.0, qFar, uStand) * step(uSlab.x, qAlong) * (1.0 - step(uSlab.y, qAlong));',
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

// literal-list-justified: the game weather VS cycle uniforms the layer phases read (weather-pattern-pass-vertex, 1419)
const CYCLE_UNIFORMS = ['uCycleFrame', 'uFrameCount', 'uPhaseCount', 'uCycleSlots', 'uLastFrameTransparent'] as const;
const TALL_SAMPLE = /clamp\(\s*vLocalPx\s*,/;
// Full density up to this share of the column, then a fade to its top (live 10-06: no visible ceiling in FP looking up).
const TALL_FADE_FROM = 0.55;
// The game VS's per-cell frame (its phase → cycle maths), for the 2D cell a layer stands in for.
const frameAt = (hash: string): string => `float qFrameAt(vec2 c) {
  float off = floor(${hash}(c) * uPhaseCount) * uCycleSlots / uPhaseCount;
  return min(mod(floor(uCycleFrame + off), uCycleSlots), uFrameCount - 1.0);
}
`;
// The local shadows the game's flat vFrame: GLSL scopes a name from after its initializer, which still reads the input.
const TALL_MAIN = `
  float qL = floor((uFrameSizePx.y - vLocalPx.y) / uFrameSizePx.y);
  float vFrame = qL < 0.5 ? vFrame : qFrameAt(vQCell - vec2(0.0, qL));
  if (qL > 0.5 && uLastFrameTransparent > 0.5 && vFrame >= uFrameCount - 1.0) discard;`;

/** Tall standing weather on a `patchWeatherFragment` output: the frame repeats up the stretched card, layer L above the
 *  foot shows the 2D cell L rows up (the game's hash), and the column's top fades; null on drift (cards stay 1 frame). */
export function patchWeatherTall(fs: string, hash: HashFn): string | null {
  if (!fs.includes('in float vQAlpha;\n') || !fs.includes('* vQAlpha;') || !TALL_SAMPLE.test(fs) || !WEATHER_MAIN.test(fs)) return null;
  if (!/flat in float vFrame;/.test(fs) || !/uniform vec2 uFrameSizePx;/.test(fs) || fs.includes(`${hash.name}(`)) return null;
  const decl = CYCLE_UNIFORMS.filter((n) => !new RegExp(`uniform\\s+float\\s+${n}\\s*;`).test(fs)).map((n) => `uniform float ${n};\n`).join('');
  return fs
    .replace('in float vQAlpha;\n', `in float vQAlpha;\nflat in vec2 vQCell;\nin float vQH;\n${decl}${hash.src}\n${frameAt(hash.name)}`)
    .replace(WEATHER_MAIN, (m) => `${m}${TALL_MAIN}`)
    .replace(TALL_SAMPLE, 'clamp(vec2(vLocalPx.x, mod(vLocalPx.y, uFrameSizePx.y)),')
    .replace('* vQAlpha;', `* vQAlpha * (1.0 - smoothstep(${TALL_FADE_FROM}, 1.0, vQH));`);
}

/** Draws a throwaway mesh of this geometry + shader into a 1×1 texture so the program compiles at install. A throwaway:
 *  rendering the live node made PIXI turn it into a render group. Live 2026-10-04 (fresh page): ground 3.8 ms, ring
 *  8.2 ms; compiled just before entry the first 3D frame still waited on the link, compiled early it went 37.7 → 21.4. */
export function compileNow(caps: Caps, geometry: unknown, shader: unknown): void {
  const m = new caps.classes.Mesh({ geometry, shader, texture: caps.classes.Texture.WHITE });
  try { caps.scene.renderer.generateTexture({ target: m, frame: new caps.classes.Rectangle(0, 0, 1, 1), resolution: 1 }).destroy(true); }
  finally { m.destroy(); }
}
