import type { Coord, ShotVerdict } from './types';
import { BOARD_SIZE } from './constants.ts';
import { coordKey, inBounds } from './board.ts';

export interface BattleshipAi {
  /** Next shot to fire. Never repeats a coordinate. */
  nextShot(): Coord;
  notifyResult(shot: Coord, verdict: ShotVerdict): void;
}

/** Classic hunt/target: parity-masked random hunt, then line-extension targeting. */
export function createAi(rng: () => number = Math.random): BattleshipAi {
  const fired = new Set<string>();
  let targetQueue: Coord[] = [];
  let lineHits: Coord[] = [];

  const neighbors = (c: Coord): Coord[] =>
    [
      { col: c.col + 1, row: c.row },
      { col: c.col - 1, row: c.row },
      { col: c.col, row: c.row + 1 },
      { col: c.col, row: c.row - 1 },
    ].filter(n => inBounds(n) && !fired.has(coordKey(n)));

  function huntShot(): Coord {
    const candidates: Coord[] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      for (let row = 0; row < BOARD_SIZE; row++) {
        if ((col + row) % 2 !== 0) continue;
        const c = { col, row };
        if (fired.has(coordKey(c))) continue;
        // Center-weighted: duplicate central cells into the pool.
        const centerWeight = 5 - Math.max(Math.abs(col - 4.5), Math.abs(row - 4.5));
        for (let w = 0; w < 1 + Math.floor(centerWeight); w++) candidates.push(c);
      }
    }
    if (candidates.length === 0) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        for (let row = 0; row < BOARD_SIZE; row++) {
          const c = { col, row };
          if (!fired.has(coordKey(c))) candidates.push(c);
        }
      }
    }
    const pick = candidates[Math.floor(rng() * candidates.length)];
    if (!pick) throw new Error('battleship AI: no cells left');
    return pick;
  }

  function extendLine(): Coord[] {
    if (lineHits.length < 2) return [];
    const a = lineHits[0];
    const b = lineHits[lineHits.length - 1];
    if (!a || !b) return [];
    const horizontal = a.row === b.row;
    const sorted = [...lineHits].sort((p, q) => (horizontal ? p.col - q.col : p.row - q.row));
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    if (!lo || !hi) return [];
    const ends = horizontal
      ? [{ col: lo.col - 1, row: lo.row }, { col: hi.col + 1, row: hi.row }]
      : [{ col: lo.col, row: lo.row - 1 }, { col: hi.col, row: hi.row + 1 }];
    return ends.filter(c => inBounds(c) && !fired.has(coordKey(c)));
  }

  return {
    nextShot(): Coord {
      const lineTargets = extendLine();
      const pool = lineTargets.length > 0
        ? lineTargets
        : targetQueue.filter(c => !fired.has(coordKey(c)));
      const fromPool = pool[Math.floor(rng() * pool.length)];
      return fromPool ?? huntShot();
    },
    notifyResult(shot: Coord, verdict: ShotVerdict): void {
      fired.add(coordKey(shot));
      if (verdict === 'hit') {
        lineHits.push(shot);
        targetQueue.push(...neighbors(shot));
      } else if (verdict === 'sunk' || verdict === 'win') {
        lineHits = [];
        targetQueue = [];
      }
    },
  };
}
