import type { Runtime } from '../runtime';
import { GRAPHICS_PRESET_NAMES, getCamera3dHints, getCamera3dSettings, graphicsPresetOf, type GraphicsPreset } from '../settings';
import type { ZoomBridge } from './zoomBridge';

/** S §4.4: a frame gap past this is slow (under ~22 fps). 3D normally runs at the game's idle 30 fps (33 ms) here. */
export const SLOW_GAP_MS = 45;
export const SLOW_WINDOW_MS = 5000;
const BUCKET_MS = 1000;
const BUCKETS = SLOW_WINDOW_MS / BUCKET_MS;
// One second of gaps at up to 1000 fps; a faster bucket keeps its first 1024, and is never slow anyway.
const CAP = 1024;

export type SlowBlock = 'not-live' | 'hidden' | 'unfocused' | 'transition' | 'debug' | 'capped' | 'suggested';

export interface SlowProbeDeps {
  /** The game's own frame time, ms. */
  clock(): number;
  isLive(): boolean;
  visible(): boolean;
  focused(): boolean;
  /** A timed camera move: entry, exit, resume, first-person push or pull. */
  inTransition(): boolean;
  debugDriven(): boolean;
  /** The game's frame-rate cap as a gap, ms; 0 uncapped. */
  capMs(): number;
  /** Storage-backed: read only when a run of slow seconds completes. */
  preset(): GraphicsPreset | 'custom';
  suggested(): boolean;
  suggest(offer: GraphicsPreset): void;
}

/** median: the current second's (or the last closed one's); samples and spanMs: since the run started. */
export interface SlowProbeStats { median: number; samples: number; slowSeconds: number; spanMs: number; fired: boolean; blocked: SlowBlock | null; capMs: number }
export interface SlowProbe { onFrame(): void; reset(): void; stats(): SlowProbeStats }

/** Ultra → High → Medium → Low; Custom → Low; nothing below Low. GRAPHICS_PRESET_NAMES runs lowest first. */
export function nextPresetDown(p: GraphicsPreset | 'custom'): GraphicsPreset | null {
  if (p === 'custom') return 'low';
  return GRAPHICS_PRESET_NAMES[GRAPHICS_PRESET_NAMES.indexOf(p) - 1] ?? null;
}

function medianOf(a: Float64Array): number {
  const n = a.length;
  if (n === 0) return NaN;
  a.sort();
  return n % 2 ? a[(n - 1) / 2]! : (a[n / 2 - 1]! + a[n / 2]!) / 2;
}

// Sustained, not average: every one-second bucket of game time must have a median gap over SLOW_GAP_MS, five in a row.
// A normal second resets the run, so a slow burst that recovers never counts (a 5 s rolling median still fires on
// 4 s slow + 1 s fine). Any block resets it too, and the gap across a block is never sampled.
export function createSlowProbe(d: SlowProbeDeps): SlowProbe {
  const bucket = new Float64Array(CAP);
  let n = 0;
  let bucketStart = NaN;
  let prev = NaN;
  let runStart = NaN;
  let runSamples = 0;
  let slowSeconds = 0;
  let lastMedian = NaN;
  let fired = false;
  let dormant = d.suggested();
  let blocked: SlowBlock | null = dormant ? 'suggested' : null;

  const reset = (): void => {
    n = 0; bucketStart = NaN; prev = NaN; runStart = NaN; runSamples = 0; slowSeconds = 0;
  };

  const blockOf = (): SlowBlock | null => {
    if (dormant) return 'suggested';
    if (!d.isLive()) return 'not-live';
    if (!d.visible()) return 'hidden';
    if (!d.focused()) return 'unfocused';
    if (d.inTransition()) return 'transition';
    if (d.debugDriven()) return 'debug';
    // The game's own 20 FPS option steps 50 ms by itself: the player's choice, not a slow machine (PC15).
    if (d.capMs() >= SLOW_GAP_MS) return 'capped';
    return null;
  };

  const verdict = (): void => {
    reset();
    if (d.suggested()) { dormant = true; return; }
    const offer = nextPresetDown(d.preset());
    if (!offer) return;
    dormant = true;
    fired = true;
    d.suggest(offer);
  };

  const closeBucket = (t: number): void => {
    lastMedian = medianOf(bucket.subarray(0, n));
    n = 0;
    bucketStart = t;
    slowSeconds = lastMedian > SLOW_GAP_MS ? slowSeconds + 1 : 0;
    if (slowSeconds >= BUCKETS) verdict();
  };

  return {
    onFrame() {
      blocked = blockOf();
      if (blocked) {
        if (runSamples > 0 || !Number.isNaN(prev)) reset();
        return;
      }
      const t = d.clock();
      const g = t - prev;
      // The first frame of a run (prev NaN), or a clock that ran backwards: start over from here.
      if (!(g >= 0)) {
        reset();
        prev = t; bucketStart = t; runStart = t;
        return;
      }
      if (g === 0) return;
      prev = t;
      if (n < CAP) bucket[n++] = g;
      runSamples++;
      if (t - bucketStart >= BUCKET_MS) closeBucket(t);
    },
    reset,
    stats() {
      const median = n > 0 ? medianOf(bucket.slice(0, n)) : lastMedian;
      const spanMs = Number.isNaN(runStart) ? 0 : prev - runStart;
      // In 2D no frame runs to update `blocked`.
      const why = dormant || d.isLive() ? blocked : 'not-live';
      return { median, samples: runSamples, slowSeconds, spanMs, fired, blocked: why, capMs: d.capMs() };
    },
  };
}

/** The probe on a live runtime: 3D frames feed it, an exit empties it. The offer runs after the render call. */
export function installSlowProbe(rt: Runtime, zoom: ZoomBridge, offer: (p: GraphicsPreset) => void): { probe: SlowProbe; off(): void } {
  const clock = rt.caps.systems.clock, ticker = rt.caps.scene.ticker;
  // An uninstall between the verdict and its microtask shows nothing (the hint stays unset, so a later run may offer).
  let on = true;
  const probe = createSlowProbe({
    clock: clock ? () => clock.lastFrameTimeMs : () => performance.now(),
    isLive: rt.isLive,
    visible: () => document.visibilityState === 'visible',
    focused: () => document.hasFocus(),
    inTransition: zoom.inTimedMove,
    debugDriven: () => !zoom.drives(),
    capMs: () => (ticker && ticker.maxFPS > 0 ? 1000 / ticker.maxFPS : 0),
    preset: () => graphicsPresetOf(getCamera3dSettings()),
    suggested: () => getCamera3dHints().slowSuggested,
    suggest: (p) => { queueMicrotask(() => { if (on) offer(p); }); },
  });
  const offFrame = rt.onFrame(probe.onFrame);
  const offExit = rt.onExit(probe.reset);
  return { probe, off: () => { on = false; offFrame(); offExit(); } };
}
