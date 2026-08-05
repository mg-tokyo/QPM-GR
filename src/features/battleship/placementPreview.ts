import type { Coord } from './types';
import { subscribeAtomValue, readAtomValueSync } from '../../core/atomRegistry';
import { boardToLocalIdx, worldToBoard, type GridSide } from './gardenStage';

// Placement preview tracks the player's tile reactively (position atom) and
// exposes the ship-shape they would place at their current tile. Rotation
// state is passed in from the panel; spacebar commits the placement upstream.
// No polling — subscribe to `position` (reactive, tier: 'client').

type OverlayView = {
  slotIdx: number;
  grid: GridSide;
};

export interface PreviewSnapshot {
  origin: Coord;
  horizontal: boolean;
  grid: GridSide;
  cells: readonly Coord[];
}

export interface PreviewController {
  update(shipLength: number, horizontal: boolean): void;
  destroy(): void;
  getCurrent(): PreviewSnapshot | null;
  onChange(cb: (snap: PreviewSnapshot | null) => void): () => void;
}

function computeCells(origin: Coord, length: number, horizontal: boolean): Coord[] {
  const cells: Coord[] = [];
  for (let i = 0; i < length; i++) {
    cells.push(horizontal ? { col: origin.col + i, row: origin.row } : { col: origin.col, row: origin.row + i });
  }
  return cells;
}

export function createPlacementPreview(view: OverlayView): PreviewController {
  let shipLength = 0;
  let horizontal = true;
  let current: PreviewSnapshot | null = null;
  const listeners = new Set<(s: PreviewSnapshot | null) => void>();
  let unsub: (() => void) | null = null;

  function recompute(tile: { x: number; y: number } | null): void {
    if (!tile || shipLength === 0) {
      if (current !== null) {
        current = null;
        for (const cb of listeners) cb(null);
      }
      return;
    }
    const b = worldToBoard(view.slotIdx, Math.round(tile.x), Math.round(tile.y));
    if (!b || b.grid !== view.grid) {
      if (current !== null) {
        current = null;
        for (const cb of listeners) cb(null);
      }
      return;
    }
    const cells = computeCells(b.coord, shipLength, horizontal);
    const next: PreviewSnapshot = { origin: b.coord, horizontal, grid: view.grid, cells };
    current = next;
    for (const cb of listeners) cb(next);
  }

  // Seed with the last-known synchronous value, then subscribe reactively.
  const initial = readAtomValueSync('position') ?? readAtomValueSync('localPosition');
  recompute(initial as { x: number; y: number } | null);
  void subscribeAtomValue('position', v => recompute(v as { x: number; y: number } | null)).then(stop => {
    unsub = stop;
  });

  return {
    update(nextLength: number, nextHorizontal: boolean): void {
      shipLength = nextLength;
      horizontal = nextHorizontal;
      const seed = readAtomValueSync('position') ?? readAtomValueSync('localPosition');
      recompute(seed as { x: number; y: number } | null);
    },
    destroy(): void {
      unsub?.();
      unsub = null;
      listeners.clear();
      current = null;
    },
    getCurrent(): PreviewSnapshot | null {
      return current;
    },
    onChange(cb: (snap: PreviewSnapshot | null) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/** Convenience: localIdx set that a preview at `origin` would occupy. */
export function previewLocalIndices(cells: readonly Coord[], grid: GridSide): number[] {
  return cells.map(c => boardToLocalIdx(grid, c));
}
