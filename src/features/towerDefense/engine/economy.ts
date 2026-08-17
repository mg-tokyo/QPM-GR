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
