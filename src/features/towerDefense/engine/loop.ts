import { SIM_STEP_MS, MAX_SIM_STEPS_PER_FRAME } from '../constants';
import { getMatchSnapshot, notify, setPhase } from '../state';
import { advanceBalloons } from './balloon';
import { tickTowers } from './tower';
import { tickProjectiles, spawnProjectile } from './projectile';
import { tickWaveSpawner } from './waves';
import { resetPositionCache } from './path';
import { bumpFrame, recordSimTick } from '../debug/perfCounters';
import { tdPlay } from '../sounds';

let rafId: number | null = null;
let lastFrame = 0;
let accumulator = 0;

function frame(now: number): void {
  bumpFrame();
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;

  const snap = getMatchSnapshot();
  if (!snap.paused && snap.phase === 'inRound') {
    accumulator += dt * snap.speed;
    let steps = 0;
    while (accumulator >= SIM_STEP_MS && steps < MAX_SIM_STEPS_PER_FRAME) {
      const t0 = performance.now();
      simTick(SIM_STEP_MS);
      recordSimTick(performance.now() - t0);
      accumulator -= SIM_STEP_MS;
      steps++;
      const after = getMatchSnapshot();
      if (after.phase !== 'inRound' || after.lives <= 0) break;
    }
    if (steps > 0) notify();
  }

  rafId = requestAnimationFrame(frame);
}

function simTick(deltaMs: number): void {
  // Clear at the top of every tick: positionAt is memoized per-tick so that
  // repeated lookups within pickTarget / tickProjectiles / advanceBalloons
  // share one Point object per distance value. Cache is invalidated here
  // because advanceBalloons is about to mutate b.distance for every balloon.
  resetPositionCache();
  advanceBalloons(deltaMs);
  const newProjectiles = tickTowers(deltaMs);
  for (const p of newProjectiles) spawnProjectile(p);
  tickProjectiles(deltaMs);
  tickWaveSpawner(deltaMs);

  const snap = getMatchSnapshot();
  if (snap.lives <= 0) {
    tdPlay('defeat');
    setPhase('ended');
  }
}

export function startLoop(): void {
  if (rafId !== null) return;
  lastFrame = performance.now();
  accumulator = 0;
  rafId = requestAnimationFrame(frame);
}

export function stopLoop(): void {
  if (rafId === null) return;
  cancelAnimationFrame(rafId);
  rafId = null;
}
