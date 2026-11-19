// Shop panel widths that give the in-stock row whole columns near the game's in-stock tile size (L1). Every size
// comes from the panel's own grid: its methods are asked what they would draw at a width, through a probe object
// chained onto the grid, so the game's grid is never written. Beta systems/shop/grid/ShopGrid.ts:286-360, 945-985.
import { isRecord } from '../../utils/typeGuards';

interface ShopGridLike {
  viewportWidthPx: number;
  resolveTileSizePx(): number;
  resolveSectionTileSizePx(sectionId: string): number;
  resolveSectionGapPx(sectionId: string): number;
  getUsableWidthPx(): number;
}

// The game's section ids (beta grid/shopGridModel.ts): in-stock tiles are scaled up, sold-out ones are not.
const IN_STOCK = 'inStock';
const SOLD_OUT = 'noStock';
const GRID_METHODS = ['resolveTileSizePx', 'resolveSectionTileSizePx', 'resolveSectionGapPx', 'getUsableWidthPx'] as const;
const PROBE_WIDTH_PX = 1000;

export interface GridSizing {
  /** Sold-out tile edge and gap: the shop's own width snaps to whole columns of these. */
  basePx: number;
  gapPx: number;
  /** Inset either side of the tile block. */
  insetPx: number;
  /** The game's in-stock tile target, rounded as the grid reports it before it is sized. */
  targetPx: number;
  inStockAt(viewportPx: number): { columns: number; tilePx: number };
}

export interface SnapStop { cellW: number; viewportW: number; soldOutColumns: number; columns: number; tilePx: number }

function asGrid(list: unknown): ShopGridLike | null {
  if (!isRecord(list) || typeof list.viewportWidthPx !== 'number') return null;
  return GRID_METHODS.every(name => typeof list[name] === 'function') ? list as unknown as ShopGridLike : null;
}

const finitePositive = (v: number): boolean => Number.isFinite(v) && v > 0;

/** Null when the view has no tile grid (row-list view) or the grid lacks a method the snap asks. */
export function readGridSizing(view: unknown): GridSizing | null {
  const grid = isRecord(view) ? asGrid(view.list) : null;
  if (!grid) return null;
  const at = (viewportPx: number): ShopGridLike =>
    Object.create(grid, { viewportWidthPx: { value: viewportPx, writable: true } }) as ShopGridLike;
  try {
    const unsized = at(0);
    const basePx = unsized.resolveTileSizePx();
    const gapPx = unsized.resolveSectionGapPx(SOLD_OUT);
    const targetPx = unsized.resolveSectionTileSizePx(IN_STOCK);
    const insetPx = (PROBE_WIDTH_PX - at(PROBE_WIDTH_PX).getUsableWidthPx()) / 2;
    if (![basePx, gapPx, targetPx].every(finitePositive) || !(insetPx >= 0) || targetPx <= basePx) return null;
    const inStockAt = (viewportPx: number): { columns: number; tilePx: number } => {
      const probe = at(viewportPx);
      const tilePx = probe.resolveSectionTileSizePx(IN_STOCK);
      const gap = probe.resolveSectionGapPx(IN_STOCK);
      // The grid spreads the row's rounding over the gaps, so the row is filled exactly.
      return { tilePx, columns: Math.max(1, Math.round((probe.getUsableWidthPx() + gap) / (tilePx + gap))) };
    };
    return { basePx, gapPx, insetPx, targetPx, inStockAt };
  } catch {
    return null;
  }
}

/** The shop's own width with `columns` sold-out columns (beta ShopGrid.ts:306-326 `getShopGridFitWidthPx`). */
export function fitWidth(sizing: GridSizing, columns: number): number {
  return columns * sizing.basePx + (columns - 1) * sizing.gapPx + 2 * sizing.insetPx;
}

/**
 * The cell width that makes the shop take `fitWidth(columns)`: the game keeps a side padding inside the cell
 * (10 px, beta ShopModalView.ts:779) and fits columns of tile + gap, so a cell half a column past the
 * threshold holds for any padding under a quarter column.
 */
function cellWidthFor(sizing: GridSizing, columns: number): number {
  return Math.round(fitWidth(sizing, columns) + sizing.gapPx + (sizing.basePx + sizing.gapPx) / 2);
}

/** One stop per in-stock column count from two up: the sold-out fit nearest the target, ties to the narrower. */
export function snapStops(sizing: GridSizing, maxCellW: number): SnapStop[] {
  const best = new Map<number, SnapStop>();
  for (let soldOutColumns = 1; cellWidthFor(sizing, soldOutColumns) <= maxCellW; soldOutColumns += 1) {
    const viewportW = fitWidth(sizing, soldOutColumns);
    const { columns, tilePx } = sizing.inStockAt(viewportW);
    if (columns < 2) continue;
    const stop: SnapStop = { cellW: cellWidthFor(sizing, soldOutColumns), viewportW, soldOutColumns, columns, tilePx };
    const held = best.get(columns);
    if (!held || Math.abs(tilePx - sizing.targetPx) < Math.abs(held.tilePx - sizing.targetPx)) best.set(columns, stop);
  }
  return [...best.values()].sort((a, b) => a.cellW - b.cellW);
}

/** True when `shownPx` is a whole number of sold-out columns: the game still sizes shops the way the model says. */
export function isFitWidth(sizing: GridSizing, shownPx: number): boolean {
  const columns = (shownPx - 2 * sizing.insetPx + sizing.gapPx) / (sizing.basePx + sizing.gapPx);
  return columns >= 1 && Math.abs(columns - Math.round(columns)) < 0.01;
}

/**
 * The stop nearest `width`. Unchanged when the grid cannot be read, no stop fits, or the shop's current width
 * is not one the model predicts (the game changed how it sizes shops; the panel then sizes as before).
 */
export function snapShopWidth(view: unknown, width: number, maxCellW: number): number {
  const sizing = readGridSizing(view);
  const shown = isRecord(view) ? view.modalScreenW : undefined;
  if (!sizing || typeof shown !== 'number' || !isFitWidth(sizing, shown)) return width;
  let nearest: SnapStop | undefined;
  for (const stop of snapStops(sizing, maxCellW)) {
    if (!nearest || Math.abs(stop.cellW - width) < Math.abs(nearest.cellW - width)) nearest = stop;
  }
  return nearest ? nearest.cellW : width;
}
