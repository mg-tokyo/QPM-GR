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

export interface WeatherBlend { stand: number; flatAlpha: number; boltAlpha: number; overWorld: boolean }

/** w = fadeWeight(pitch): 0 at ≥ 80° (every mode draws exactly the 2D pattern), 1 at ≤ 60°. */
export function weatherBlend(mode: WeatherMode, w: number, overPitch: boolean): WeatherBlend {
  if (mode === 'stand') return { stand: w, flatAlpha: 1, boltAlpha: 0, overWorld: true };
  if (mode === 'bolts') return { stand: 0, flatAlpha: 1 - w, boltAlpha: w, overWorld: overPitch };
  return { stand: 0, flatAlpha: 1, boltAlpha: 0, overWorld: overPitch };
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
