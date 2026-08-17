import type { BalloonId, BalloonModifier, SpawnGroup, WaveDef } from '../types';
import { PRESCRIPTED_ROUNDS } from '../constants';
import { endlessCamoEnabled, resolveScriptedModifiers } from './waveModifiers';

// Wave content per docs/superpowers/plans/2026-08-15-tower-defense-btd-rebalance-addendum.md §2.1.
// RBE targets in that table are authoritative; counts here were derived to
// land within ±15% of each round's target. Structure: debut → learn →
// escalate → milestone (10, 15, 17, 19, 20).
export const SCRIPTED_WAVES: readonly WaveDef[] = [
  { round: 1,  groups: [
    { kind: 'redWorm',    count: 15, spacingMs: 800, startDelayMs: 0 },
  ]},
  { round: 2,  groups: [
    { kind: 'redWorm',    count: 20, spacingMs: 700, startDelayMs: 0 },
  ]},
  { round: 3,  groups: [
    { kind: 'redWorm',    count: 12, spacingMs: 600, startDelayMs: 0 },
    { kind: 'blueWorm',   count: 8,  spacingMs: 900, startDelayMs: 3000 },
  ]},
  { round: 4,  groups: [
    { kind: 'blueWorm',   count: 19, spacingMs: 700, startDelayMs: 0 },
  ]},
  { round: 5,  groups: [
    { kind: 'blueWorm',   count: 15, spacingMs: 600,  startDelayMs: 0 },
    { kind: 'greenWorm',  count: 3,  spacingMs: 1000, startDelayMs: 4000 },
  ]},
  { round: 6,  groups: [
    { kind: 'blueWorm',   count: 12, spacingMs: 500, startDelayMs: 0 },
    { kind: 'greenWorm',  count: 6,  spacingMs: 800, startDelayMs: 3000 },
  ]},
  { round: 7,  groups: [
    { kind: 'greenWorm',  count: 8,  spacingMs: 700, startDelayMs: 0 },
    { kind: 'yellowBee',  count: 3,  spacingMs: 500, startDelayMs: 4000 },
  ]},
  { round: 8,  groups: [
    { kind: 'greenWorm',  count: 8,  spacingMs: 500,  startDelayMs: 0 },
    { kind: 'yellowBee',  count: 3,  spacingMs: 500,  startDelayMs: 3000 },
    { kind: 'greenWorm',  count: 2,  spacingMs: 1200, startDelayMs: 5500, modifiers: resolveScriptedModifiers(['camo']) },
  ]},
  { round: 9,  groups: [
    { kind: 'greenWorm',  count: 12, spacingMs: 400, startDelayMs: 0 },
    { kind: 'yellowBee',  count: 4,  spacingMs: 500, startDelayMs: 3000 },
  ]},
  { round: 10, groups: [
    { kind: 'greenWorm',  count: 12, spacingMs: 500,  startDelayMs: 0 },
    { kind: 'stoneTurtle', count: 2, spacingMs: 3000, startDelayMs: 5000 },
  ]},
  { round: 11, groups: [
    { kind: 'greenWorm',  count: 10, spacingMs: 400, startDelayMs: 0 },
    { kind: 'yellowBee',  count: 6,  spacingMs: 400, startDelayMs: 3000 },
    { kind: 'stoneTurtle', count: 1, spacingMs: 1,   startDelayMs: 8000 },
  ]},
  { round: 12, groups: [
    { kind: 'greenWorm',  count: 12, spacingMs: 400, startDelayMs: 0 },
    { kind: 'yellowBee',  count: 10, spacingMs: 500, startDelayMs: 3000, modifiers: ['regen'] },
  ]},
  { round: 13, groups: [
    { kind: 'greenWorm',  count: 12, spacingMs: 400,  startDelayMs: 0 },
    { kind: 'yellowBee',  count: 10, spacingMs: 400,  startDelayMs: 3000 },
    { kind: 'rainbowWorm', count: 2, spacingMs: 2000, startDelayMs: 6000 },
  ]},
  { round: 14, groups: [
    { kind: 'yellowBee',  count: 12, spacingMs: 400,  startDelayMs: 0 },
    { kind: 'rainbowWorm', count: 4, spacingMs: 1500, startDelayMs: 3000 },
    { kind: 'rainbowWorm', count: 2, spacingMs: 2500, startDelayMs: 8000, modifiers: resolveScriptedModifiers(['camo']) },
  ]},
  { round: 15, groups: [
    { kind: 'yellowBee',  count: 20, spacingMs: 300,  startDelayMs: 0 },
    { kind: 'rainbowWorm', count: 4, spacingMs: 1000, startDelayMs: 3000 },
    { kind: 'stoneTurtle', count: 2, spacingMs: 4000, startDelayMs: 6000 },
  ]},
  { round: 16, groups: [
    { kind: 'yellowBee',  count: 20, spacingMs: 400,  startDelayMs: 0 },
    { kind: 'rainbowWorm', count: 5, spacingMs: 1000, startDelayMs: 3000 },
    { kind: 'stoneTurtle', count: 2, spacingMs: 2500, startDelayMs: 6000, modifiers: ['regen'] },
    { kind: 'stoneTurtle', count: 1, spacingMs: 1,    startDelayMs: 11000, modifiers: resolveScriptedModifiers(['camo']) },
  ]},
  { round: 17, groups: [
    { kind: 'yellowBee',    count: 30, spacingMs: 300,  startDelayMs: 0 },
    { kind: 'rainbowWorm',  count: 7,  spacingMs: 900,  startDelayMs: 3000 },
    { kind: 'bronzeCapybara', count: 1, spacingMs: 1,   startDelayMs: 8000 },
  ]},
  { round: 18, groups: [
    { kind: 'yellowBee',   count: 40, spacingMs: 300, startDelayMs: 0 },
    { kind: 'rainbowWorm', count: 3, spacingMs: 800, startDelayMs: 3000, modifiers: resolveScriptedModifiers(['camo']) },
    { kind: 'rainbowWorm', count: 3, spacingMs: 800, startDelayMs: 5400, modifiers: ['regen'] },
    { kind: 'rainbowWorm', count: 2, spacingMs: 800, startDelayMs: 7800 },
    { kind: 'stoneTurtle', count: 3, spacingMs: 3000, startDelayMs: 6000 },
  ]},
  { round: 19, groups: [
    { kind: 'yellowBee',      count: 40, spacingMs: 300, startDelayMs: 0 },
    { kind: 'rainbowWorm',    count: 12, spacingMs: 700, startDelayMs: 3000, modifiers: resolveScriptedModifiers(['camo']) },
    { kind: 'bronzeCapybara', count: 1,  spacingMs: 1,   startDelayMs: 8000 },
    { kind: 'bronzeCapybara', count: 1,  spacingMs: 1,   startDelayMs: 14000, modifiers: ['regen'] },
  ]},
  { round: 20, groups: [
    { kind: 'yellowBee',   count: 60, spacingMs: 300, startDelayMs: 0 },
    { kind: 'rainbowWorm', count: 15, spacingMs: 700, startDelayMs: 3000 },
    { kind: 'rainbowWorm', count: 5,  spacingMs: 700, startDelayMs: 14000, modifiers: resolveScriptedModifiers(['camo']) },
    { kind: 'goldMoab',    count: 1,  spacingMs: 1,   startDelayMs: 12000 },
  ]},
];

// Endless generator per spec §8.3 (+ §8.4 boss rounds). Composition, per-round
// count/spacing scaling, and camo/regen probability rolls all live here.
// Deterministic per-round RNG (mulberry32) so a given round's composition is
// stable across replays — modifier rolls don't shuffle if the player retries.

function endlessScale(cycle: number): { countMul: number; spacingMul: number } {
  // Compound 1.15^cycle per addendum §2.2 (was linear 1.08 in Layer 5 T4).
  // The new rate matches the smooth RBE curve so base counts + this multiplier
  // land within ±15% of smooth(n) — validated at round 21 in T4.
  return {
    countMul: Math.pow(1.15, cycle),
    spacingMul: Math.max(0.1, 1 - cycle * 0.025),
  };
}

function pCamo(cycle: number): number { return Math.min(0.30, 0.05 + cycle * 0.01); }
function pRegen(cycle: number): number { return Math.min(0.20, 0.03 + cycle * 0.008); }

function makeRng(seed: number): () => number {
  let a = (seed | 0) * 2654435761;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simplification vs spec §8.3's per-balloon roll: bucket each group into up to
// one clean + one regen + one camo sub-group. Preserves total density; keeps
// modifier bookkeeping shallow (one modifier array per SpawnGroup).
function makeEndlessGroups(
  kind: BalloonId,
  baseCount: number,
  baseSpacingMs: number,
  startDelayMs: number,
  scale: { countMul: number; spacingMul: number },
  rng: () => number,
  cycle: number,
): SpawnGroup[] {
  const count = Math.max(1, Math.floor(baseCount * scale.countMul));
  const spacingMs = Math.max(50, Math.floor(baseSpacingMs * scale.spacingMul));
  const camoPortion = endlessCamoEnabled() && rng() < pCamo(cycle)
    ? Math.max(1, Math.floor(count * pCamo(cycle)))
    : 0;
  const regenPortion = rng() < pRegen(cycle)
    ? Math.max(1, Math.floor(count * pRegen(cycle)))
    : 0;
  const cleanCount = Math.max(0, count - camoPortion - regenPortion);
  const groups: SpawnGroup[] = [];
  if (cleanCount > 0) {
    groups.push({ kind, count: cleanCount, spacingMs, startDelayMs });
  }
  if (regenPortion > 0) {
    groups.push({
      kind, count: regenPortion, spacingMs,
      startDelayMs: startDelayMs + (cleanCount * spacingMs),
      modifiers: ['regen'],
    });
  }
  if (camoPortion > 0) {
    groups.push({
      kind, count: camoPortion, spacingMs,
      startDelayMs: startDelayMs + ((cleanCount + regenPortion) * spacingMs),
      modifiers: ['camo'],
    });
  }
  return groups;
}

// Boss round tables per addendum §2.2. Counts increased vs Layer 5 (R30 was 2,
// R40 was 2, R50 was 3, R60 was 3) so the boss content matches spec §1.1's
// "on-top spike ×3-4" language. Camo entries route through
// resolveScriptedModifiers so the CAMO_IN_SCRIPTED_ROUNDS kill-switch can
// disable them without editing every literal.
const BOSS_ROUNDS: Readonly<Record<number, readonly SpawnGroup[]>> = {
  30: [{ kind: 'goldMoab', count: 3, spacingMs: 5000, startDelayMs: 0 }],
  40: [
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 0 },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 5000,  modifiers: resolveScriptedModifiers(['camo']) },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 10000 },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 15000, modifiers: resolveScriptedModifiers(['camo']) },
  ],
  50: [
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 0 },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 5000,  modifiers: resolveScriptedModifiers(['camo']) },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 10000, modifiers: ['regen'] },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 15000, modifiers: resolveScriptedModifiers(['camo', 'regen']) },
  ],
  60: [
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 0 },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 5000,  modifiers: resolveScriptedModifiers(['camo']) },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 10000, modifiers: ['regen'] },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 15000, modifiers: resolveScriptedModifiers(['camo', 'regen']) },
    { kind: 'goldMoab', count: 1, spacingMs: 1, startDelayMs: 20000, modifiers: resolveScriptedModifiers(['camo', 'regen']) },
  ],
};

function generateBossRound70Plus(round: number, rng: () => number): readonly SpawnGroup[] {
  const bossCount = 2 + Math.floor((round - 30) / 10);
  const groups: SpawnGroup[] = [];
  for (let i = 0; i < bossCount; i++) {
    const mods: BalloonModifier[] = [];
    if (endlessCamoEnabled() && rng() < 0.5) mods.push('camo');
    if (rng() < 0.5) mods.push('regen');
    const modifiers = mods.length > 0 ? mods : undefined;
    groups.push({
      kind: 'goldMoab',
      count: 1,
      spacingMs: 1,
      startDelayMs: i * 6000,
      ...(modifiers ? { modifiers } : {}),
    });
  }
  return groups;
}

export function isBossRound(round: number): boolean {
  return round >= 30 && round % 10 === 0;
}

export function generateEndlessWave(round: number): WaveDef {
  const rng = makeRng(round);
  if (isBossRound(round)) {
    const preset = BOSS_ROUNDS[round];
    const groups = preset ?? generateBossRound70Plus(round, rng);
    return { round, groups };
  }
  const cycle = round - PRESCRIPTED_ROUNDS;
  const scale = endlessScale(cycle);
  // BronzeCapybara joins from round 22 onward per spec §4.4.
  const capyCount = round >= 22 ? Math.min(4, 1 + Math.floor(cycle / 5)) : 0;
  const groups: SpawnGroup[] = [
    ...makeEndlessGroups('yellowBee',   50, 350,  0,     scale, rng, cycle),
    ...makeEndlessGroups('rainbowWorm', 20, 900,  3000,  scale, rng, cycle),
    ...makeEndlessGroups('stoneTurtle', 6,  2500, 6000,  scale, rng, cycle),
  ];
  if (capyCount > 0) {
    groups.push({
      kind: 'bronzeCapybara',
      count: capyCount,
      spacingMs: 4000,
      startDelayMs: 10000,
    });
  }
  return { round, groups };
}
