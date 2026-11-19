// Panel layout maths for the floating game panels (multi-storage, multi-shop). No game objects in here.

export interface Screen { w: number; h: number }
export interface Cell { x: number; y: number; w: number; h: number }
/** A cell as shares of the screen, so it survives a window of another size. `z` is the front-order rank. */
export interface SavedCell { x: number; y: number; w: number; h: number; z?: number }
export type SavedLayout = Record<string, SavedCell>;
/** Where the visible panel sits inside its cell, once the game has built it. */
export interface SheetBox { left: number; width: number; top: number }

/** How one family of panels may be sized and placed. */
export interface PanelFit {
  minWidthPx: number;
  minHeightPx: number;
  /** The minimum height is also at least this share of the screen's height. */
  minHeightFraction: number;
  /** Until the panel's top is known, this share of the cell may sit above the screen. */
  unplacedAboveShare: number;
  /** Moved against the bottom edge the panel gets shorter (and grows back), instead of stopping there. */
  shortenAtBottom: boolean;
}

// Narrower than 220 the storage panel's bottom button strip no longer fits; short panels render badly,
// so a storage never goes below half the screen's height (320 px floor).
export const STORAGE_FIT: PanelFit = {
  minWidthPx: 220, minHeightPx: 320, minHeightFraction: 0.5, unplacedAboveShare: 0.5, shortenAtBottom: false,
};
export const MIN_PANEL_WIDTH_PX = STORAGE_FIT.minWidthPx;
export const HEADER_HEIGHT_PX = 24;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function minPanelSize(screen: Screen, fit: PanelFit = STORAGE_FIT): { w: number; h: number } {
  return {
    w: Math.min(fit.minWidthPx, screen.w),
    h: Math.min(screen.h, Math.max(fit.minHeightPx, Math.round(screen.h * fit.minHeightFraction))),
  };
}

/** One row starting at `left`. When the panels cannot all have the minimum width they overlap evenly. */
export function defaultCells(count: number, left: number, screen: Screen, fit: PanelFit = STORAGE_FIT): Cell[] {
  if (!(count > 0)) return [];
  const usable = Math.max(1, screen.w - left);
  const w = Math.min(usable, Math.max(fit.minWidthPx, Math.floor(usable / count)));
  const step = count > 1 ? Math.min(w, (usable - w) / (count - 1)) : 0;
  const cells: Cell[] = [];
  for (let i = 0; i < count; i += 1) cells.push({ x: Math.round(left + i * step), y: 0, w, h: screen.h });
  return cells;
}

export function cellToSaved(cell: Cell, screen: Screen, z: number): SavedCell | null {
  if (!(screen.w > 0) || !(screen.h > 0)) return null;
  return { x: cell.x / screen.w, y: cell.y / screen.h, w: cell.w / screen.w, h: cell.h / screen.h, z };
}

export function cellFromSaved(saved: SavedCell | null | undefined, screen: Screen): Cell | null {
  if (!saved) return null;
  const { x, y, w, h } = saved;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || !(w > 0) || !(h > 0)) return null;
  return { x: Math.round(x * screen.w), y: Math.round(y * screen.h), w: Math.round(w * screen.w), h: Math.round(h * screen.h) };
}

/**
 * Keeps the header and the panel's bottom strip on screen. Until the panel is built its top is unknown
 * (`sheet` null), so `fit.unplacedAboveShare` of the cell may sit above the screen; clamp again once it is known.
 */
export function clampCell(cell: Cell, screen: Screen, sheet: SheetBox | null, fit: PanelFit = STORAGE_FIT): Cell {
  const min = minPanelSize(screen, fit);
  const w = Math.round(clamp(cell.w, min.w, screen.w));
  const h = Math.round(clamp(cell.h, min.h, screen.h));
  const left = sheet ? sheet.left : 0;
  const width = sheet ? sheet.width : w;
  const lowestY = sheet ? Math.min(0, HEADER_HEIGHT_PX - sheet.top) : 0 - Math.round(h * fit.unplacedAboveShare);
  return {
    x: Math.round(clamp(cell.x, -left, screen.w - left - width)),
    y: Math.round(clamp(cell.y, lowestY, screen.h - h)),
    w,
    h,
  };
}

export function cellContains(rect: Cell, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/** The cell size while the grip is dragged by (dx, dy) from `start`; the bottom edge stops at the screen's. */
export function resizedSize(start: Cell, dx: number, dy: number, screen: Screen, fit: PanelFit = STORAGE_FIT): { w: number; h: number } {
  const min = minPanelSize(screen, fit);
  return {
    w: Math.round(clamp(start.w + dx, min.w, screen.w)),
    h: Math.round(clamp(start.h + dy, min.h, Math.max(min.h, screen.h - start.y))),
  };
}

/**
 * The cell while the header is dragged by (dx, dy) from `start`, before the clamp. With `fit.shortenAtBottom`
 * the panel gets shorter as it is pushed past the bottom edge and grows back, never past its starting height.
 */
export function movedCell(start: Cell, dx: number, dy: number, screen: Screen, fit: PanelFit = STORAGE_FIT): Cell {
  const x = start.x + dx;
  const y = start.y + dy;
  if (!fit.shortenAtBottom) return { x, y, w: start.w, h: start.h };
  const h = Math.round(Math.max(minPanelSize(screen, fit).h, Math.min(start.h, screen.h - y)));
  return { x, y, w: start.w, h };
}

/** Each panel's intended place (screen shares), ranked by its place in `order` (back to front). */
export function rankedLayout(places: ReadonlyMap<string, SavedCell>, order: readonly string[]): SavedLayout {
  const layout: SavedLayout = {};
  for (const [id, place] of places) layout[id] = { x: place.x, y: place.y, w: place.w, h: place.h, z: Math.max(0, order.indexOf(id)) };
  return layout;
}

/**
 * A panel's cell on a resized window, from its intended place rather than its current cell: a small window
 * clamps cells (minimum width, screen edges), and scaling a clamped cell back up would not return it.
 */
export function cellForScreen(place: SavedCell | null, current: Cell, from: Screen, to: Screen, fit: PanelFit = STORAGE_FIT): Cell {
  const intended = cellFromSaved(place, to);
  return intended ? clampCell(intended, to, null, fit) : rescaleCell(current, from, to, fit);
}

/** The same share of a screen of another size, for a resized game window. */
export function rescaleCell(cell: Cell, from: Screen, to: Screen, fit: PanelFit = STORAGE_FIT): Cell {
  const scaled = cellFromSaved(cellToSaved(cell, from, 0), to);
  return clampCell(scaled ?? cell, to, null, fit);
}

/** Saved place per storage where one is valid, else that storage's default cell. */
export function startingCells(ids: readonly string[], saved: SavedLayout, left: number, screen: Screen, fit: PanelFit = STORAGE_FIT): Cell[] {
  const defaults = defaultCells(ids.length, left, screen, fit);
  return ids.map((id, i) => clampCell(cellFromSaved(saved[id], screen) ?? defaults[i] ?? { x: left, y: 0, w: screen.w, h: screen.h }, screen, null, fit));
}

/** Ids back to front: by saved rank, a storage with no rank takes its open position. */
export function frontOrder(ids: readonly string[], saved: SavedLayout): string[] {
  const rank = (id: string, index: number): number => {
    const z = saved[id]?.z;
    return finite(z) ? z : index;
  };
  return ids
    .map((id, index) => ({ id, index, rank: rank(id, index) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.id);
}

/** Null when `id` is already in front or not in the order. */
export function raiseToFront(order: readonly string[], id: string): string[] | null {
  if (order[order.length - 1] === id || !order.includes(id)) return null;
  return [...order.filter(other => other !== id), id];
}

export interface PreviewCell { storageId: string; x: number; y: number; w: number; h: number }

/** Where each storage would open, as screen shares, back to front: what the settings card draws. */
export function previewCells(ids: readonly string[], saved: SavedLayout, left: number, screen: Screen, fit: PanelFit = STORAGE_FIT): PreviewCell[] {
  if (!(screen.w > 0) || !(screen.h > 0)) return [];
  const cells = startingCells(ids, saved, left, screen, fit);
  const byId = new Map(ids.map((id, i) => [id, cells[i]]));
  const out: PreviewCell[] = [];
  for (const id of frontOrder(ids, saved)) {
    const cell = byId.get(id);
    if (cell) out.push({ storageId: id, x: cell.x / screen.w, y: cell.y / screen.h, w: cell.w / screen.w, h: cell.h / screen.h });
  }
  return out;
}
