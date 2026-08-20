import type { BalloonId } from '../types';
import { getWaveFor } from '../engine/waves';
import { endlessHpMult, kindRbe } from '../engine/balloon';
import { getBalloonDef } from '../data/balloonDefs';

export interface EndlessRoundProfile {
  readonly round: number;
  readonly bodies: number;
  readonly spawnWindowMs: number;
  readonly totalRbe: number;
  readonly rbePerSec: number;
  readonly groups: number;
}

export function profileEndlessRounds(from: number, to: number): EndlessRoundProfile[] {
  const out: EndlessRoundProfile[] = [];
  for (let round = from; round <= to; round++) {
    const wave = getWaveFor(round);
    const hpMult = endlessHpMult(round);
    let bodies = 0;
    let totalRbe = 0;
    let windowMs = 0;
    for (const g of wave.groups) {
      bodies += g.count;
      totalRbe += g.count * kindRbe(g.kind) * hpMult;
      const end = g.startDelayMs + g.count * g.spacingMs;
      if (end > windowMs) windowMs = end;
    }
    out.push({
      round, bodies, spawnWindowMs: windowMs,
      totalRbe: Math.round(totalRbe),
      rbePerSec: Math.round(totalRbe / Math.max(1, windowMs / 1000)),
      groups: wave.groups.length,
    });
  }
  return out;
}

export function logEndlessProfile(from = 21, to = 100): void {
  // console.table keeps this copy-pasteable into task handoffs.
  console.table(profileEndlessRounds(from, to));
}

// Pre-tax pop payout projection: caller multiplies by popIncomeMult(round)
// post-T3 to compare against baseline.
export function projectPopIncome(round: number): number {
  const wave = getWaveFor(round);
  let total = 0;
  for (const g of wave.groups) total += g.count * chainPopReward(g.kind);
  return Math.round(total);
}

function chainPopReward(kind: BalloonId): number {
  const def = getBalloonDef(kind);
  let total = def.popReward;
  for (const child of def.children) total += chainPopReward(child);
  return total;
}
