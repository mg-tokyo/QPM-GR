import { getMatchSnapshot, setCash } from '../state';
import { SELL_REFUND_RATIO } from '../constants';
import type { Point } from '../types';
import { getEffectiveStats } from './tower';

export interface IncomePayoutInfo {
  readonly towerId: string;
  readonly tilePosition: Point;
  readonly amount: number;
}

const incomeListeners = new Set<(info: IncomePayoutInfo) => void>();

export function onIncomePayout(cb: (info: IncomePayoutInfo) => void): () => void {
  incomeListeners.add(cb);
  return () => incomeListeners.delete(cb);
}

function emitIncomePayout(info: IncomePayoutInfo): void {
  for (const cb of incomeListeners) {
    try { cb(info); } catch { /* ignore */ }
  }
}

export function canAfford(cost: number): boolean {
  return getMatchSnapshot().cash >= cost;
}

export function spend(cost: number): boolean {
  const snap = getMatchSnapshot();
  if (snap.cash < cost) return false;
  setCash(snap.cash - cost);
  return true;
}

export function earn(amount: number): void {
  const snap = getMatchSnapshot();
  setCash(snap.cash + amount);
}

// Layer 8 §D.3 — BTD6-style freeplay cash-per-pop tax. Pop income used to
// scale with balloon count (+15%/round) while threat grew +5%/round; the
// windowed generator caps counts and this tax removes the remaining overshoot.
export function popIncomeMult(round: number): number {
  if (round <= 30) return 1;
  if (round <= 40) return 0.8;
  if (round <= 50) return 0.6;
  if (round <= 60) return 0.4;
  if (round <= 80) return 0.25;
  return 0.15;
}

export function earnPopReward(baseReward: number): void {
  const round = getMatchSnapshot().round;
  earn(Math.max(1, Math.round(baseReward * popIncomeMult(round))));
}

export function refund(totalSpent: number): number {
  const refunded = Math.floor(totalSpent * SELL_REFUND_RATIO);
  earn(refunded);
  return refunded;
}

export function roundEndBonus(round: number, bonusMultiplier: number = 1): number {
  const snap = getMatchSnapshot();
  for (const tower of snap.towers) {
    const stats = getEffectiveStats(tower);
    const payout = stats.incomePerRound + (stats.cashOnWaveComplete ?? 0);
    if (payout <= 0) continue;
    earn(payout);
    emitIncomePayout({
      towerId: tower.id,
      tilePosition: tower.tile,
      amount: payout,
    });
  }
  // Round bonus is capped so late-game free income can't outpace balloon threat
  // and turn the plateau into a hoard. Boss multiplier still applies on top.
  const bonusBase = Math.min(250, 40 + round * 3);
  const bonus = Math.floor(bonusBase * bonusMultiplier);
  earn(bonus);
  return bonus;
}
