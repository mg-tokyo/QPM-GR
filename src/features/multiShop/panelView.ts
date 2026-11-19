// A game shop view as one panel: capability check, cell-sized layout, the front-panel keyboard gate, and
// the overrides on the game's real shop view with their restore. No session state in here.
// Shapes: beta QuinoaCanvas/pixi/ModalView.ts:104-171, systems/shop/ShopModalView.ts:327-392, live build 2065.
import { isRecord } from '../../utils/typeGuards';
import type { PixiNode } from '../multiStorage/gameHooks';
import type { Cell } from '../multiStorage/layout';
import { checkShopView, type ModalHostLike, type ModalRequestLike, type ShopViewLike } from './quietBuild';

export interface ShopPanelView extends ShopViewLike {
  container: PixiNode;
  /** The base modal's own settings (scrim, z-index), not the shop's config. */
  config: Readonly<Record<string, unknown>>;
  isOpen: boolean;
  /** Built on each open; a shop that bails on its weather or opening-hours gate has none. */
  header?: unknown;
  cardView?: { container?: PixiNode | null } | null;
  onLayout(rendererWidth: number, rendererHeight: number): void;
  modalScreenX?: number;
  modalScreenY?: number;
  modalScreenW?: number;
  frame?: {
    contentContainer?: { hitArea?: { height?: number } | null } | null;
    /** The frame's construction options (beta pixi/ModalFrame.ts:12-54, systems/shop/ShopModalView.ts:399-409). */
    options?: { cornerRadius?: unknown; headerBand?: { color?: unknown } | null } | null;
  } | null;
}

/** Where the visible shop sits inside its cell. */
export interface PanelBox { left: number; top: number; width: number; height: number }

export interface RealBinding {
  view: ShopPanelView;
  renderer: unknown;
  onLayout: ShopPanelView['onLayout'];
  handleKeyDown: ShopPanelView['handleKeyDown'];
  card: PixiNode | null;
}

const isFn = (v: unknown): boolean => typeof v === 'function';

/** What a panel needs on a built shop view beyond `checkShopView`; empty when it is all there. */
export function checkPanelView(view: unknown): string[] {
  const missing = checkShopView(view);
  if (!isRecord(view)) return missing;
  const container = view.container;
  if (!isRecord(container) || typeof container.zIndex !== 'number' || !isFn(container.removeFromParent)) missing.push('view.container');
  if (!isRecord(view.config)) missing.push('view.config');
  if (!isFn(view.onLayout)) missing.push('view.onLayout');
  if (typeof view.isOpen !== 'boolean') missing.push('view.isOpen');
  return missing;
}

/** The base modal lays out with the game's frame size (beta ModalView.ts:233-236); the panel lays out in its cell. */
export function bindCellLayout(view: ShopPanelView, cell: Cell): void {
  const layout = view.onLayout;
  view.onLayout = function (this: ShopPanelView): void { layout.call(this, cell.w, cell.h); };
}

/**
 * Every open shop listens for arrows and Space on the window (beta ShopModalView.ts:663, 1328); without the
 * gate one Space press buys in every open shop. Must be in place before `open()`, which registers the handler.
 */
export function gateKeys(view: ShopPanelView, mayTake: () => boolean): void {
  const keys = view.handleKeyDown;
  view.handleKeyDown = (event: KeyboardEvent): void => { if (mayTake()) keys.call(view, event); };
}

/** A copy shows presence without dimming: the real shop's scrim dims the world once. */
export function clearScrim(view: ShopPanelView): void {
  view.config = { ...view.config, scrimAlpha: 0 };
}

export function panelBox(view: ShopPanelView): PanelBox | null {
  const { modalScreenX: left, modalScreenY: top, modalScreenW: width } = view;
  const height = view.frame?.contentContainer?.hitArea?.height;
  if (!view.isOpen || left === undefined || top === undefined || width === undefined || height === undefined) return null;
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

/** Moves the game's real shop view into `host` and sizes and gates it like a copy; `unbindRealView` undoes it. */
export function bindRealView(view: ShopPanelView, host: PixiNode, renderer: unknown, cell: Cell, mayTake: () => boolean): RealBinding {
  const card = view.cardView?.container ?? null;
  const binding: RealBinding = { view, renderer: view.renderer, onLayout: view.onLayout, handleKeyDown: view.handleKeyDown, card };
  host.addChild(view.container);
  if (card) host.addChild(card);
  view.renderer = renderer;
  bindCellLayout(view, cell);
  gateKeys(view, mayTake);
  return binding;
}

/** By assignment only (never delete on a game object). The view goes back under the game's UI container. */
export function unbindRealView(binding: RealBinding, ui: PixiNode): void {
  const { view, card } = binding;
  view.renderer = binding.renderer;
  view.onLayout = binding.onLayout;
  view.handleKeyDown = binding.handleKeyDown;
  try {
    if (!view.container.destroyed) ui.addChild(view.container);
    if (card && !card.destroyed) ui.addChild(card);
    view.invalidateLayout();
  } catch { /* torn down with the renderer */ }
}

/**
 * While installed, the view the host builds for `name` is handed to `onCreate` before the host opens it
 * (beta ModalHost.ts:171-205: read, create, cache, open). A shop the game never built gets its overrides in
 * time for its first open. Returns the restore; a view already cached is never passed.
 */
export function interceptCreate(modals: ModalHostLike, name: string, onCreate: (view: unknown) => void): () => void {
  const read = modals.read;
  if (!read) return () => undefined;
  const wrapper = (): ModalRequestLike | null => {
    const request: unknown = read.call(modals);
    if (!isRecord(request) || request.name !== name || !isFn(request.create)) return request as ModalRequestLike | null;
    const create = request.create as () => unknown;
    return { ...request, create: () => { const view = create(); onCreate(view); return view; } };
  };
  modals.read = wrapper;
  return () => { if (modals.read === wrapper) modals.read = read; };
}

/**
 * A room reconnect disposes the player systems and installs a new modal host on the same engine and renderer
 * (beta engine/scopes/bindPlayerViews.ts:24-27, SystemRegistry.ts:138-150, pixi/ModalHost.ts:235-243), so the
 * old host's draw stops and nothing else tells QPM. `onDestroy` runs first, while the host's views still exist.
 */
export function onHostDestroy(modals: ModalHostLike, onDestroy: () => void): () => void {
  const destroy = modals.destroy;
  if (!destroy) return () => undefined;
  const wrapper = function (this: unknown, ...args: unknown[]): void {
    try { onDestroy(); } finally { destroy.apply(this, args); }
  };
  modals.destroy = wrapper;
  return () => { if (modals.destroy === wrapper) modals.destroy = destroy; };
}
