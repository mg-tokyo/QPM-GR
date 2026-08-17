interface PerfState {
  snapshots: number;
  positions: number;
  simTicks: number;
  renderTicks: number;
  frames: number;
  simDurations: Float64Array;
  simCursor: number;
  simFilled: number;
  renderMsSum: number;
  lastReadMs: number;
}

const SIM_RING_SIZE = 240;

function makeState(): PerfState {
  return {
    snapshots: 0,
    positions: 0,
    simTicks: 0,
    renderTicks: 0,
    frames: 0,
    simDurations: new Float64Array(SIM_RING_SIZE),
    simCursor: 0,
    simFilled: 0,
    renderMsSum: 0,
    lastReadMs: performance.now(),
  };
}

const state: PerfState = makeState();

export function bumpSnapshot(): void { state.snapshots++; }
export function bumpPosition(): void { state.positions++; }
export function bumpFrame(): void { state.frames++; }

export function recordSimTick(ms: number): void {
  state.simTicks++;
  state.simDurations[state.simCursor] = ms;
  state.simCursor = (state.simCursor + 1) % SIM_RING_SIZE;
  if (state.simFilled < SIM_RING_SIZE) state.simFilled++;
}

export function recordRenderTick(ms: number): void {
  state.renderTicks++;
  state.renderMsSum += ms;
}

export interface PerfSample {
  readonly fps: number;
  readonly simTicksPerSec: number;
  readonly simP95Ms: number;
  readonly renderAvgMs: number;
  readonly renderTicksPerSec: number;
  readonly snapshotsPerSec: number;
  readonly positionsPerSec: number;
}

function computeP95(): number {
  const n = state.simFilled;
  if (n === 0) return 0;
  const copy = new Float64Array(n);
  for (let i = 0; i < n; i++) copy[i] = state.simDurations[i] ?? 0;
  copy.sort();
  const idx = Math.min(n - 1, Math.floor(n * 0.95));
  return copy[idx] ?? 0;
}

// Returns rates over the interval since the last sample, resets per-second
// counters, and leaves the sim-duration ring untouched (p95 uses a rolling
// window independent of read cadence).
export function sampleAndReset(): PerfSample {
  const now = performance.now();
  const dtSec = Math.max(0.001, (now - state.lastReadMs) / 1000);
  const renderAvg = state.renderTicks > 0 ? state.renderMsSum / state.renderTicks : 0;
  const out: PerfSample = {
    fps: state.frames / dtSec,
    simTicksPerSec: state.simTicks / dtSec,
    simP95Ms: computeP95(),
    renderAvgMs: renderAvg,
    renderTicksPerSec: state.renderTicks / dtSec,
    snapshotsPerSec: state.snapshots / dtSec,
    positionsPerSec: state.positions / dtSec,
  };
  state.snapshots = 0;
  state.positions = 0;
  state.simTicks = 0;
  state.renderTicks = 0;
  state.frames = 0;
  state.renderMsSum = 0;
  state.lastReadMs = now;
  return out;
}
