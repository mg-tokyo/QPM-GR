import { depthKeyAlong } from '../math/depth';
import { patchWeatherFragment, patchWeatherTall, patchWeatherVertex } from './shaders';
import { extractHashFn } from './weatherPhases';

export type WeatherMode = 'flat' | 'stand' | 'bolts';

// literal-list-justified: render-only weather art classification; an unknown or renamed key stays flat on the floor
const WEATHER_MODES: Readonly<Record<string, WeatherMode>> = {
  'weather/RainAnimation': 'stand',
  'weather/FrostAnimation': 'stand',
  'weather/ThunderstormAnimation': 'bolts',
};

export function weatherModeOf(key: string | null): WeatherMode {
  return (key !== null ? WEATHER_MODES[key] : undefined) ?? 'flat';
}

export interface CellHash { kx: number; ky: number; scale: number }

// The game's per-cell phase hash (live VS: `sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453`), read from its own
// shader so the constants follow the game.
const HASH_RE = /sin\(\s*dot\(\s*cell\s*,\s*vec2\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)\s*\)\s*\)\s*\*\s*([\d.]+)/;

export function parseCellHash(vs: string): CellHash | null {
  const m = HASH_RE.exec(vs);
  if (!m) return null;
  const kx = Number(m[1]), ky = Number(m[2]), scale = Number(m[3]);
  return Number.isFinite(kx) && Number.isFinite(ky) && Number.isFinite(scale) ? { kx, ky, scale } : null;
}

/** CPU fallback for the game's phase bucket, used only when the GPU phase map fails (weatherPhases.ts). float64 sin
 * disagrees with the game's GPU bucket for ~97 % of cells (live 10-03). */
export function phaseOf(h: CellHash, cx: number, cy: number, phaseCount: number): number {
  const n = Math.sin(cx * h.kx + cy * h.ky) * h.scale;
  return Math.floor((Math.abs(n) % 1) * phaseCount);
}

/** The strip frame a phase bucket shows (the game shader's cycle maths), or −1 while it rests on the last frame. */
export function strikeFrame(cycleFrame: number, phase: number, phaseCount: number, cycleSlots: number, frameCount: number): number {
  if (cycleSlots <= 0 || phaseCount <= 0 || frameCount <= 1) return -1;
  const pos = ((Math.floor(cycleFrame + (phase * cycleSlots) / phaseCount) % cycleSlots) + cycleSlots) % cycleSlots;
  return pos < frameCount - 1 ? pos : -1;
}

export interface WeatherBlend { stand: number; flatAlpha: number; boltAlpha: number; overWorld: boolean; slabs: boolean }

/** w = the view's tilt (by s): 0 at the 2D match (every mode draws exactly the 2D pattern), 1 fully tilted. Tilted,
 * standing cards draw as depth slabs in World (P9); flat patterns lie on the ground under every billboard. */
export function weatherBlend(mode: WeatherMode, w: number, exact: boolean): WeatherBlend {
  if (mode === 'stand') return { stand: w, flatAlpha: 1, boltAlpha: 0, overWorld: exact, slabs: !exact };
  if (mode === 'bolts') return { stand: 0, flatAlpha: 1 - w, boltAlpha: w, overWorld: exact, slabs: false };
  return { stand: 0, flatAlpha: 1, boltAlpha: 0, overWorld: exact, slabs: false };
}

// P9 depth slabs: one mesh can't sit partly behind a building, so standing weather draws as world-aligned slabs along
// the view axis, each keyed like an entity at its middle (out of order by at most half a slab). The end slabs are open,
// so a window that lags the camera (it moves only on frames World rebuilds anyway) never drops a cell.
export const SLAB_OPEN = 1e30;
// Over the entities at the slab's middle row (their tiebreaks are layer / 10 + fraction / 10 < 1).
const SLAB_TIE = 0.999;

export const slabCount = (radiusPx: number, slabPx: number): number => Math.ceil(radiusPx / slabPx) + 3;
/** The first slab's index: the camera's own along falls in slab 1. */
export const slabStart = (camAlong: number, slabPx: number): number => Math.floor(camAlong / slabPx) - 1;

export function slabBounds(i: number, k0: number, n: number, slabPx: number, out: { 0: number; 1: number }): void {
  out[0] = i === 0 ? -SLAB_OPEN : (k0 + i) * slabPx;
  out[1] = i === n - 1 ? SLAB_OPEN : (k0 + i + 1) * slabPx;
}

export const slabKey = (i: number, k0: number, slabPx: number): number => depthKeyAlong((k0 + i + 0.5) * slabPx, SLAB_TIE);

export type SlabShift = 'keep' | 'now' | 'forced';

/** structural: World rebuilds this frame anyway (a re-key of every slab is then free). A turned view must re-key now:
 * the slab ranges are along the old axis. */
export function slabShift(want: number, have: number, dirChanged: boolean, structural: boolean): SlabShift {
  if (Number.isNaN(have) || dirChanged) return structural ? 'now' : 'forced';
  if (want === have) return 'keep';
  if (structural) return 'now';
  return Math.abs(want - have) >= 2 ? 'forced' : 'keep';
}

export type WeatherPatch = 'vertex' | 'fragment' | 'cellHash' | 'hashFn' | 'tall';

/** Which mirror patches the game's weather program defeats. vertex: no 3D weather; fragment: no per-cell fades; cellHash:
 * no CPU phase fallback; hashFn: no GPU phases; tall: standing cards stay one frame tall. Bolts need one of the two
 * phase paths (A W3). */
export function weatherPatchIssues(vs: string, fs: string): WeatherPatch[] {
  const out: WeatherPatch[] = [];
  const faded = patchWeatherFragment(fs);
  const hash = extractHashFn(vs);
  if (!patchWeatherVertex(vs)) out.push('vertex');
  if (!faded) out.push('fragment');
  if (!parseCellHash(vs)) out.push('cellHash');
  if (!hash) out.push('hashFn');
  if (!faded || !hash || !patchWeatherTall(faded, hash)) out.push('tall');
  return out;
}

export interface StormCell { gx: number; gy: number; phase: number }

/** One entry per cell of the game's weather geometry (aCell: 4 vertices × 2 floats per cell), standing on footPx. */
export function stormCells(aCell: Float32Array, fw: number, fh: number, footPx: number, phaseAt: (cx: number, cy: number) => number): StormCell[] {
  const out: StormCell[] = [];
  for (let i = 0; i + 1 < aCell.length; i += 8) {
    const cx = aCell[i]!, cy = aCell[i + 1]!;
    out.push({ gx: cx * fw + fw / 2, gy: cy * fh + footPx, phase: phaseAt(cx, cy) });
  }
  return out;
}

/** Cells within `radius` of (x, y), grouped by phase bucket. */
export function bucketCells(cells: readonly StormCell[], x: number, y: number, radius: number, phaseCount: number): StormCell[][] {
  const out: StormCell[][] = Array.from({ length: Math.max(0, phaseCount) }, () => []);
  const r2 = radius * radius;
  for (const c of cells) {
    const dx = c.gx - x, dy = c.gy - y;
    if (dx * dx + dy * dy <= r2) out[c.phase]?.push(c);
  }
  return out;
}

/** Resting phases in the order their next strike starts (the game's cycle maths, as `strikeFrame`), at most `max`. */
export function nextPhases(cycleFrame: number, phaseCount: number, cycleSlots: number, frameCount: number, max: number): number[] {
  if (cycleSlots <= 0 || phaseCount <= 0 || frameCount <= 1) return [];
  const wait: Array<[number, number]> = [];
  for (let p = 0; p < phaseCount; p++) {
    const pos = ((Math.floor(cycleFrame + (p * cycleSlots) / phaseCount) % cycleSlots) + cycleSlots) % cycleSlots;
    if (pos >= frameCount - 1) wait.push([cycleSlots - pos, p]);
  }
  wait.sort((a, b) => a[0] - b[0]);
  return wait.slice(0, max).map((w) => w[1]);
}

/** Sticky pool slots with look-ahead. A zIndex change re-sorts World and rebuilds its instruction set, so a strike
 * keeps the slot it owns (striking or reserved) and idle slots keep their key. Only on a frame that rebuilds anyway (a
 * strike needs a new slot, or `rekey`: the yaw step moved every key) are idle slots freed and refilled with whole
 * `upcoming()` groups. Writes each strike's slot (−1 = pool full); returns how many were dropped. */
export function claimSlots<T>(owners: Array<T | null>, strikes: readonly T[], slots: number[], upcoming: () => ReadonlyArray<readonly T[]>, rekey: boolean): number {
  slots.length = strikes.length;
  let refill = rekey;
  for (let k = 0; k < strikes.length; k++) {
    slots[k] = owners.indexOf(strikes[k]!);
    if (slots[k]! < 0) refill = true;
  }
  if (!refill) return 0;
  for (let i = 0; i < owners.length; i++) if (owners[i] !== null && !strikes.includes(owners[i]!)) owners[i] = null;
  let dropped = 0;
  for (let k = 0; k < strikes.length; k++) {
    if (slots[k]! >= 0) continue;
    const i = owners.indexOf(null);
    if (i >= 0) { owners[i] = strikes[k]!; slots[k] = i; } else dropped++;
  }
  let free = 0;
  for (const o of owners) if (o === null) free++;
  for (const group of upcoming()) {
    if (group.length > free) break;
    for (const c of group) owners[owners.indexOf(null)] = c;
    free -= group.length;
  }
  return dropped;
}
