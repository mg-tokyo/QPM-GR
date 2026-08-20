import type { Balloon, WaveDef } from '../types';
import { PRESCRIPTED_ROUNDS } from '../constants';
import { spawnBalloon } from './balloon';
import {
  getMatchSnapshot,
  notify,
  setBalloons,
  setPhase,
  setProjectiles,
  setRound,
} from '../state';
import { roundEndBonus } from './economy';
import { autosaveRun } from '../saves/store';
import { SCRIPTED_WAVES, generateEndlessWave, isBossRound } from '../data/waveDefs';
import { tdPlay } from '../sounds';

interface GroupProgress {
  spawnedCount: number;
  msUntilNext: number;
  started: boolean;
}

let activeWave: WaveDef | null = null;
let groupProgress: GroupProgress[] = [];
let elapsedMs = 0;

export function getWaveFor(round: number): WaveDef {
  const idx = round - 1;
  if (idx >= 0 && idx < SCRIPTED_WAVES.length) {
    const wave = SCRIPTED_WAVES[idx];
    if (wave) return wave;
  }
  return generateEndlessWave(round);
}

export function isRoundActive(): boolean {
  return activeWave !== null;
}

export function startRound(): void {
  const snap = getMatchSnapshot();
  let round = snap.round;
  if (round < 1) {
    round = 1;
    setRound(round, false);
  }
  activeWave = getWaveFor(round);
  groupProgress = activeWave.groups.map(() => ({
    spawnedCount: 0,
    msUntilNext: 0,
    started: false,
  }));
  elapsedMs = 0;
  setPhase('inRound');
  tdPlay('waveStart');
  notify();
}

export function resetWaveEngine(): void {
  activeWave = null;
  groupProgress = [];
  elapsedMs = 0;
}

export function tickWaveSpawner(deltaMs: number): void {
  const wave = activeWave;
  if (!wave) return;
  elapsedMs += deltaMs;

  const snap = getMatchSnapshot();
  const toSpawn: Balloon[] = [];
  for (let i = 0; i < wave.groups.length; i++) {
    const group = wave.groups[i];
    const progress = groupProgress[i];
    if (!group || !progress) continue;
    if (progress.spawnedCount >= group.count) continue;
    if (elapsedMs < group.startDelayMs) continue;
    if (!progress.started) {
      progress.started = true;
      progress.msUntilNext = 0;
    } else {
      progress.msUntilNext -= deltaMs;
    }
    while (progress.msUntilNext <= 0 && progress.spawnedCount < group.count) {
      const opts = group.modifiers && group.modifiers.length > 0
        ? { modifiers: group.modifiers }
        : undefined;
      toSpawn.push(opts ? spawnBalloon(group.kind, opts) : spawnBalloon(group.kind));
      progress.spawnedCount++;
      progress.msUntilNext += group.spacingMs;
    }
  }
  if (toSpawn.length > 0) {
    setBalloons([...snap.balloons, ...toSpawn]);
  }

  const allSpawned = groupProgress.every((p, i) => {
    const g = wave.groups[i];
    return !g || p.spawnedCount >= g.count;
  });
  if (!allSpawned) return;
  if (getMatchSnapshot().balloons.length > 0) return;

  const currentRound = getMatchSnapshot().round;
  const isBoss = isBossRound(currentRound) && getMatchSnapshot().isEndless;
  roundEndBonus(currentRound, isBoss ? 2 : 1);
  const nextRound = currentRound + 1;
  setRound(nextRound, nextRound > PRESCRIPTED_ROUNDS);
  // In-flight projectiles freeze visually in preRound (sim loop is inRound-gated),
  // so clear them and reset tower cooldowns to give a clean start-of-round state.
  setProjectiles([]);
  for (const t of getMatchSnapshot().towers) t.fireCooldownMs = 0;
  setPhase('preRound');
  tdPlay('waveClear');
  resetWaveEngine();
  try { autosaveRun(getMatchSnapshot()); } catch { /* best-effort autosave */ }
  // Microtask defer avoids re-entering activeWave state inside the same tick.
  if (getMatchSnapshot().autoStart) {
    queueMicrotask(() => startRound());
  }
}
