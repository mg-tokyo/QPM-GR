import type { Coord, FleetLayout, ShipSpec, ShotResult } from './types';
// .ts extension so scripts/check-battleship-logic.mjs can run this file under
// node --experimental-strip-types (same pattern as check-weather-parser.mjs).
import { BOARD_SIZE } from './constants.ts';

export function coordKey(c: Coord): string {
  return `${c.col},${c.row}`;
}

export function inBounds(c: Coord): boolean {
  return c.col >= 0 && c.col < BOARD_SIZE && c.row >= 0 && c.row < BOARD_SIZE;
}

export function shipCells(origin: Coord, length: number, horizontal: boolean): Coord[] | null {
  const cells: Coord[] = [];
  for (let i = 0; i < length; i++) {
    const c = horizontal
      ? { col: origin.col + i, row: origin.row }
      : { col: origin.col, row: origin.row + i };
    if (!inBounds(c)) return null;
    cells.push(c);
  }
  return cells;
}

export function canPlace(existing: FleetLayout, cells: Coord[]): boolean {
  const blocked = new Set<string>();
  for (const ship of existing) {
    for (const c of ship.cells) {
      // Cell plus orthogonal neighbors blocked — standard no-touching rule.
      blocked.add(coordKey(c));
      blocked.add(coordKey({ col: c.col + 1, row: c.row }));
      blocked.add(coordKey({ col: c.col - 1, row: c.row }));
      blocked.add(coordKey({ col: c.col, row: c.row + 1 }));
      blocked.add(coordKey({ col: c.col, row: c.row - 1 }));
    }
  }
  return cells.every(c => inBounds(c) && !blocked.has(coordKey(c)));
}

export function resolveShot(
  layout: FleetLayout,
  priorHits: ReadonlySet<string>,
  shot: Coord,
): ShotResult {
  const key = coordKey(shot);
  for (const ship of layout) {
    if (!ship.cells.some(c => coordKey(c) === key)) continue;
    const withShot = new Set(priorHits);
    withShot.add(key);
    const shipSunk = ship.cells.every(c => withShot.has(coordKey(c)));
    if (!shipSunk) return { verdict: 'hit', species: ship.species };
    return isFleetSunk(layout, withShot)
      ? { verdict: 'win', species: ship.species }
      : { verdict: 'sunk', species: ship.species };
  }
  return { verdict: 'miss' };
}

export function isFleetSunk(layout: FleetLayout, hits: ReadonlySet<string>): boolean {
  return layout.every(ship => ship.cells.every(c => hits.has(coordKey(c))));
}

export function randomFleet(
  specs: readonly ShipSpec[],
  speciesFor: (id: string) => string,
  rng: () => number = Math.random,
): FleetLayout {
  for (let attempt = 0; attempt < 100; attempt++) {
    const fleet: FleetLayout = [];
    let ok = true;
    for (const spec of specs) {
      let placedShip = false;
      for (let tries = 0; tries < 200; tries++) {
        const horizontal = rng() < 0.5;
        const origin = {
          col: Math.floor(rng() * BOARD_SIZE),
          row: Math.floor(rng() * BOARD_SIZE),
        };
        const cells = shipCells(origin, spec.length, horizontal);
        if (cells && canPlace(fleet, cells)) {
          fleet.push({ spec, species: speciesFor(spec.id), cells });
          placedShip = true;
          break;
        }
      }
      if (!placedShip) {
        ok = false;
        break;
      }
    }
    if (ok) return fleet;
  }
  throw new Error('randomFleet: could not place fleet');
}
