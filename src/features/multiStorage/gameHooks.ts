// The game's storage system as multi-storage uses it: capability checks, stand-in renderers, hosts,
// and the two fixes a second copy of the storage panel needs. No session state in here.
// Shapes verified against beta client/.../systems/inventory/StorageSystem.ts:155-347 and live build 2065.
import { readSync } from '../../core/gameState';
import { getEngineSystem } from '../../utils/quinoaEngine';
import { isRecord } from '../../utils/typeGuards';
import type { Cell } from './layout';

export interface PixiBounds { x: number; y: number; width: number; height: number }
export interface PixiNode {
  label?: string;
  x: number;
  y: number;
  zIndex: number;
  visible: boolean;
  renderable: boolean;
  destroyed?: boolean;
  sortableChildren: boolean;
  children: PixiNode[];
  scale: { x: number; y: number; set(value: number): void };
  pivot: { x: number; y: number };
  addChild(...nodes: PixiNode[]): unknown;
  removeFromParent(): void;
  destroy(options?: unknown): void;
  getBounds(): PixiBounds;
  getGlobalPosition(): { x: number; y: number };
}
export interface GameRenderer { width: number; height: number; canvas?: HTMLCanvasElement }

export interface GridMetrics { columns: number; cellSizePx: number; gapPx: number; paddingXPx: number; paddingTopPx: number }
export interface CellBox { x: number; y: number; sizePx: number }
export interface Placement { cells: CellBox[]; contentHeightPx?: number }
export type LayoutFn = (entries: unknown) => Placement;
export interface SheetSection { entries: unknown[]; layout(mode: unknown): LayoutFn; heightPx?: number }
export interface SheetPresentation { sections: SheetSection[]; emptyState: Array<Record<string, unknown> | null> }

export interface ItemSheetLike {
  body: PixiNode | null;
  widthPx: number;
  lastViewportRevision: number;
  layout?: { heightPx?: number } | null;
  gridMetrics?: GridMetrics;
  present?: (presentation: SheetPresentation) => unknown;
  /** The panel's frame; the header samples its colours (beta itemSheet/ItemSheet.ts:254). */
  background?: unknown;
  /** The count strap on the sheet's top right; its button is a child of `body` (beta itemSheet/ItemSheet.ts:381). */
  strap?: { button?: StrapButtonLike | null } | null;
}
export interface StrapButtonLike { x: number; y: number; width: number; height: number; visible: boolean; destroyed?: boolean }
export interface StorageViewLike { itemSheet?: ItemSheetLike; present?: () => void }
export interface StorageSystemLike {
  uiContainer: PixiNode;
  renderer: GameRenderer;
  batchRenderer: unknown;
  modalView: StorageViewLike | null;
  closingView: StorageViewLike | null;
  activeStorageType: string | null;
  draw(context: unknown, deltaTimeMs: number): void;
  onModalChanged(storageType: string | null): void;
  forceCloseViews(): void;
  destroy(): void;
}
export type StorageSystemClass = new (ui: PixiNode, renderer: GameRenderer, batchRenderer: unknown) => StorageSystemLike;

export interface StorageHandles { sys: StorageSystemLike; proto: StorageSystemLike; SystemClass: StorageSystemClass }
export type CapabilityResult = ({ ok: true } & StorageHandles) | { ok: false; missing: string[] };

export const HOST_LABEL_PREFIX = 'MultiStorageHost:';

const isFn = (v: unknown): boolean => typeof v === 'function';
const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

export function findStorageSystem(): unknown {
  let engine: unknown;
  try { engine = readSync('quinoaEngine'); } catch { engine = null; }
  return getEngineSystem(engine, 'storage');
}

/** What multi-storage needs on the game's storage system; `missing` names each absent handle. */
export function checkStorageSystem(sys: unknown): CapabilityResult {
  if (!isRecord(sys)) return { ok: false, missing: ['system'] };
  const missing: string[] = [];
  const proto: unknown = Object.getPrototypeOf(sys);
  if (!isFn(sys.constructor) || sys.constructor === Object) missing.push('constructor');
  if (!isRecord(proto) || !isFn(proto.onModalChanged)) missing.push('onModalChanged');
  for (const name of ['draw', 'forceCloseViews', 'destroy']) if (!isFn(sys[name])) missing.push(name);
  const ui = sys.uiContainer;
  if (!isRecord(ui) || !Array.isArray(ui.children) || !isFn(ui.addChild) || !isFn(ui.constructor)) missing.push('uiContainer');
  const renderer = sys.renderer;
  if (!isRecord(renderer) || !finite(renderer.width) || !finite(renderer.height)) missing.push('renderer');
  if (sys.batchRenderer == null) missing.push('batchRenderer');
  for (const name of ['modalView', 'closingView', 'activeStorageType']) if (!(name in sys)) missing.push(name);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    sys: sys as unknown as StorageSystemLike,
    proto: proto as unknown as StorageSystemLike,
    SystemClass: sys.constructor as unknown as StorageSystemClass,
  };
}

/** What multi-storage needs on a built storage panel (move and resize read these). */
export function checkFirstView(view: unknown): string[] {
  if (!isRecord(view)) return ['view'];
  const sheet = view.itemSheet;
  if (!isRecord(sheet)) return ['view.itemSheet'];
  const missing: string[] = [];
  if (!isRecord(sheet.body)) missing.push('view.itemSheet.body');
  if (!finite(sheet.widthPx)) missing.push('view.itemSheet.widthPx');
  if (!('lastViewportRevision' in sheet)) missing.push('view.itemSheet.lastViewportRevision');
  return missing;
}

/** The game's panel id for a storage building (PetHutch → petHutch), from the game's own panel list. */
export function panelIdFor(storageId: string, panelIds: readonly string[]): string | null {
  const wanted = storageId.toLowerCase();
  return panelIds.find(id => id.toLowerCase() === wanted) ?? null;
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({ left, top, width, height }) };
}

type Override = { hit: false } | { hit: true; value: unknown };

function passThrough<T extends object>(target: T, override: (prop: string | symbol) => Override): T {
  return new Proxy(target, {
    get(obj, prop) {
      const over = override(prop);
      if (over.hit) return over.value;
      const value: unknown = Reflect.get(obj, prop, obj);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(obj) : value;
    },
    set(obj, prop, value) {
      return Reflect.set(obj, prop, value, obj);
    },
  });
}

/**
 * A renderer that reports one cell's size, so a panel lays itself out inside that cell. The game turns
 * mouse positions into renderer pixels with renderer.width / canvasRect.width, so the canvas rect shrinks
 * by the same ratio and that conversion still lands on true screen pixels.
 */
export function cellRenderer(real: GameRenderer, cell: Cell): GameRenderer {
  let cached: { canvas: HTMLCanvasElement; proxy: HTMLCanvasElement } | null = null;
  const cellCanvas = (): HTMLCanvasElement | undefined => {
    const canvas = real.canvas;
    if (!canvas) return canvas;
    if (cached?.canvas !== canvas) {
      const rect = (): DOMRect => {
        const r = canvas.getBoundingClientRect();
        return domRect(r.left, r.top, r.width * (cell.w / real.width), r.height * (cell.h / real.height));
      };
      const proxy = passThrough(canvas, prop => prop === 'getBoundingClientRect' ? { hit: true, value: rect } : { hit: false });
      cached = { canvas, proxy };
    }
    return cached.proxy;
  };
  return passThrough(real, (prop) => {
    if (prop === 'width') return { hit: true, value: cell.w };
    if (prop === 'height') return { hit: true, value: cell.h };
    if (prop === 'canvas') return { hit: true, value: cellCanvas() };
    return { hit: false };
  });
}

export function makeHost(ui: PixiNode, storageId: string, cell: Cell, labelPrefix = HOST_LABEL_PREFIX): PixiNode {
  const Container = ui.constructor as new () => PixiNode;
  const host = new Container();
  host.label = labelPrefix + storageId;
  host.sortableChildren = true;
  host.x = cell.x;
  host.y = cell.y;
  ui.addChild(host);
  return host;
}

/** The panel sits one band above the game's shared scrim; its host must take that band or the scrim eats input. */
export function liftHost(host: PixiNode): void {
  const panel = host.children[0];
  if (panel) host.zIndex = panel.zIndex;
}

export function destroyHost(host: PixiNode): void {
  if (host.destroyed) return;
  host.removeFromParent();
  host.destroy({ children: true });
}

/** The game's pet column stays on screen above the panels; the panels start to its right. */
export function petSidebarRightEdge(ui: PixiNode, gapPx: number): number {
  const sidebar = ui.children.find(child => child.label === 'PetSidebar');
  if (!sidebar?.visible) return 0;
  const bounds = sidebar.getBounds();
  return bounds.width > 0 ? Math.max(0, Math.ceil(bounds.x + bounds.width) + gapPx) : 0;
}

// The bag section of a storage panel (section 0 is the storage itself).
const BAG_SECTION_INDEX = 1;
const shiftedLayouts = new WeakMap<LayoutFn, LayoutFn>();

/** The bag grid re-laid from its first cell, which the game keeps for the tool pouch. */
export function withoutPouchCell(layout: LayoutFn, metrics: GridMetrics): LayoutFn {
  const known = shiftedLayouts.get(layout);
  if (known) return known;
  const shifted: LayoutFn = (entries) => {
    const placement = layout(entries);
    const first = placement.cells[0];
    if (!first || (first.x === metrics.paddingXPx && first.y === metrics.paddingTopPx)) return placement;
    const cells = [{ x: metrics.paddingXPx, y: metrics.paddingTopPx, sizePx: first.sizePx }, ...placement.cells.slice(0, -1)];
    const last = cells[cells.length - 1];
    return { ...placement, cells, contentHeightPx: last ? last.y + last.sizePx : 0 };
  };
  shiftedLayouts.set(layout, shifted);
  return shifted;
}

export function withoutPouchPresentation(presentation: SheetPresentation, metrics: GridMetrics): SheetPresentation {
  const bag = presentation.sections[BAG_SECTION_INDEX];
  if (!bag) return presentation;
  const columns = Math.max(1, metrics.columns);
  const rows = Math.max(1, Math.ceil(bag.entries.length / columns));
  const sections = presentation.sections.slice();
  sections[BAG_SECTION_INDEX] = {
    ...bag,
    layout: (mode: unknown) => withoutPouchCell(bag.layout(mode), metrics),
    heightPx: metrics.paddingTopPx + rows * metrics.cellSizePx + (rows - 1) * metrics.gapPx,
  };
  const emptyState = presentation.emptyState.map((state, index) =>
    index === BAG_SECTION_INDEX && state ? { ...state, leadingCellCount: 0 } : state);
  return { ...presentation, sections, emptyState };
}

/**
 * There is one tool pouch and it sits in one panel; in the others the bag's first cell is empty and refuses
 * drops. Wraps the sheet of a panel QPM built (it dies with that panel, so nothing is restored).
 */
export function dropPouchCell(view: StorageViewLike | null): void {
  const sheet = view?.itemSheet;
  const present = sheet?.present;
  if (!sheet || !present || !view.present) return;
  sheet.present = function (this: ItemSheetLike, presentation: SheetPresentation) {
    const metrics = this.gridMetrics;
    if (!metrics || !Array.isArray(presentation?.sections)) return present.call(this, presentation);
    return present.call(this, withoutPouchPresentation(presentation, metrics));
  };
  view.present();
}
