// A header to drag each open panel by, a corner grip to resize it, press-to-front and the saved layout, for any
// family of floating game panels (storages, shops). Driven once a frame from the session's draw wrapper; walks
// only the open panels. What differs per family comes in through a `PanelKind`.
import {
  GRIP_SIZE_PX, destroyArtSprite, findSpriteKit, headerArtHeight, makeArtSprite, paintGrip, paintHeader, setArt,
  type ArtSprite, type FrameColors, type HeaderJoin, type PointerLike, type SpriteKit,
} from './chromeArt';
import {
  HEADER_HEIGHT_PX, cellContains, cellForScreen, cellToSaved, clampCell, defaultCells, frontOrder, movedCell, raiseToFront,
  rankedLayout, resizedSize, type Cell, type PanelFit, type SavedCell, type SavedLayout, type Screen, type SheetBox,
} from './layout';
import type { GameRenderer, PixiNode } from './gameHooks';

export interface ChromePanel {
  readonly id: string;
  /** Open position; reset lays the panels out in this order. */
  readonly index: number;
  readonly host: PixiNode;
  /** Mutable: move and resize change it, then move the host. */
  readonly cell: Cell;
}

/** Where the visible panel sits in its cell: `top`/`y` its top edge, `height` down from there. */
export interface PanelMetrics extends SheetBox { y: number; height: number }

export interface PanelKind<P extends ChromePanel> {
  fit: PanelFit;
  labels: { header: string; grip: string };
  /** Null until the panel has laid out. */
  metrics(panel: P): PanelMetrics | null;
  /** Makes the panel lay out again in its (changed) cell. */
  requestReflow(panel: P): void;
  /** The z of the panel's own root inside its host; the header goes just under it, the grip just over. */
  rootZ(panel: P): number;
  title(panel: P): string;
  /** Null: not known yet, ask next frame. */
  colors(panel: P, extract: unknown): FrameColors | null;
  headerRadius?: number;
  /** The panel's own top corners for the header to meet; null or absent: a square-bottomed header. */
  headerJoin?(panel: P): HeaderJoin | null;
  layout: { get(): SavedLayout; save(cells: SavedLayout): void };
  /** The cell width to use in place of `width` (whole content columns); absent: any width. */
  snapWidth?(panel: P, width: number, maxWidth: number): number;
}

interface Point { x: number; y: number }
interface UiLike extends PixiNode {
  toLocal(point: Point): Point;
  toGlobal?(point: Point): Point;
}

export interface ChromeContext<P extends ChromePanel> {
  /** The game's UI container: parent of every host, and the space pointer positions are taken in. */
  ui: PixiNode;
  real: GameRenderer & { extract?: unknown };
  /** The session's screen; updated in place when the game window is resized. */
  screen: Screen;
  panels: readonly P[];
  kind: PanelKind<P>;
  isLive(): boolean;
  /** Called with the ids back to front whenever the front order changes. */
  onOrder?(order: readonly string[]): void;
}

export interface PanelChrome {
  /** False when the header and grip could not be built (no sprite class or pointer mapping); panels still open. */
  readonly decorated: boolean;
  sync(): void;
  reset(left: number): void;
  /** Brings a panel to the front; false when it already is or is not dressed. */
  raise(id: string): boolean;
  /** Ids back to front. */
  order(): readonly string[];
  /** Dresses a panel opened after the others, at the back of the order so it does not take the keyboard. */
  add(panel: ChromePanel): void;
  /** Drops one panel (closed on its own) with its header and grip; its saved place is kept. */
  remove(id: string): void;
  dispose(): void;
  describe(): Record<string, unknown>;
}

interface Dressed<P extends ChromePanel> {
  panel: P;
  title: string;
  header: ArtSprite | null;
  grip: ArtSprite | null;
  headerWidth: number;
  colors: FrameColors | null;
  /** Undefined until asked. */
  join: HeaderJoin | null | undefined;
  /** Clamped against its built sheet since the last open, reset or window resize. */
  checked: boolean;
  /** The sheet's last size and how many frames in a row it has kept it. */
  size: string;
  stable: number;
  /** Where the user put it, as screen shares; the cell may be clamped away from it on a smaller window. */
  intent: SavedCell | null;
}
interface Drag<P extends ChromePanel> { dressed: Dressed<P>; kind: 'move' | 'resize'; from: Point; start: Cell }
/** A resized panel's left edge, held until its sheet width has stopped changing (it can land after the drop). */
interface Hold<P extends ChromePanel> { dressed: Dressed<P>; sheetLeft: number; width: number; stable: number; released: boolean }

const SETTLE_FRAMES = 3;

function place(panel: ChromePanel, next?: Cell): void {
  if (next) Object.assign(panel.cell, next);
  panel.host.x = panel.cell.x;
  panel.host.y = panel.cell.y;
}

function destroySprites(kit: SpriteKit | null, sprites: ReadonlyArray<ArtSprite | null>): void {
  if (!kit) return;
  for (const sprite of sprites) {
    try { if (sprite) destroyArtSprite(kit, sprite); } catch { /* torn down with the renderer */ }
  }
}

export function createPanelChrome<P extends ChromePanel>(ctx: ChromeContext<P>): PanelChrome {
  const ui = ctx.ui as UiLike;
  const { real, screen, kind } = ctx;
  const { fit } = kind;
  const canPoint = typeof ui.toLocal === 'function' && !!real.canvas;
  const kit: SpriteKit | null = canPoint ? findSpriteKit(ctx.panels.map(p => p.host)) : null;
  const baseZ = Math.max(0, ...ctx.panels.map(p => p.host.zIndex));
  const listeners: Array<[string, (event: PointerEvent) => void]> = [];
  const savedAtOpen = kind.layout.get();
  let order = frontOrder(ctx.panels.map(p => p.id), savedAtOpen);
  let dressed: Array<Dressed<P>> = [];
  let drag: Drag<P> | null = null;
  let hold: Hold<P> | null = null;
  let disposed = false;

  const metrics = (panel: P): PanelMetrics | null => kind.metrics(panel);
  /** The visible panel with its header, in UI space. */
  const panelRect = (panel: P): Cell => {
    const m = metrics(panel);
    const { cell } = panel;
    if (!m) return cell;
    return { x: cell.x + m.left, y: cell.y + m.top - HEADER_HEIGHT_PX, w: m.width, h: m.height + HEADER_HEIGHT_PX };
  };

  const listen = (type: string, handler: (event: PointerEvent) => void): void => {
    window.addEventListener(type, handler as EventListener, true);
    listeners.push([type, handler]);
  };
  const unlisten = (types: readonly string[]): void => {
    for (let i = listeners.length - 1; i >= 0; i -= 1) {
      const entry = listeners[i];
      if (!entry || !types.includes(entry[0])) continue;
      window.removeEventListener(entry[0], entry[1] as EventListener, true);
      listeners.splice(i, 1);
    }
  };

  const applyOrder = (): void => {
    order.forEach((id, rank) => {
      const d = dressed.find(entry => entry.panel.id === id);
      if (d && !d.panel.host.destroyed) d.panel.host.zIndex = baseZ + rank / 100;
    });
    ctx.onOrder?.(order);
  };
  const save = (): void => {
    const places = new Map<string, SavedCell>();
    for (const d of dressed) {
      const where = d.intent ?? cellToSaved(d.panel.cell, screen, 0);
      if (where) places.set(d.panel.id, where);
    }
    kind.layout.save(rankedLayout(places, order));
  };
  const raise = (id: string): boolean => {
    const next = raiseToFront(order, id);
    if (!next) return false;
    order = next;
    applyOrder();
    return true;
  };

  const pointerInUi = (clientX: number, clientY: number): Point | null => {
    const rect = real.canvas?.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    return ui.toLocal({ x: (clientX - rect.left) * (real.width / rect.width), y: (clientY - rect.top) * (real.height / rect.height) });
  };

  const settle = (d: Dressed<P>, persist: boolean): void => {
    const { panel } = d;
    if (panel.host.destroyed) return;
    place(panel, clampCell(panel.cell, screen, metrics(panel), fit));
    if (!persist) return;
    d.intent = cellToSaved(panel.cell, screen, 0);
    save();
  };
  const endHold = (persist: boolean): void => {
    const h = hold;
    hold = null;
    if (h?.released) settle(h.dressed, persist);
  };

  const endDrag = (persist: boolean): void => {
    const d = drag;
    if (!d) return;
    drag = null;
    unlisten(['pointermove', 'pointerup', 'pointercancel']);
    if (hold?.dressed === d.dressed && persist) {
      hold.released = true;
      return;
    }
    hold = null;
    settle(d.dressed, persist);
  };

  const moveDrag = (event: PointerEvent): void => {
    const d = drag;
    const point = d ? pointerInUi(event.clientX, event.clientY) : null;
    if (!d || !point) return;
    const { panel } = d.dressed;
    const dx = point.x - d.from.x;
    const dy = point.y - d.from.y;
    if (d.kind === 'move') {
      const moved = movedCell(d.start, dx, dy, screen, fit);
      const shortened = moved.h !== panel.cell.h;
      place(panel, clampCell(moved, screen, metrics(panel), fit));
      if (shortened) kind.requestReflow(panel);
      return;
    }
    const size = resizedSize(d.start, dx, dy, screen, fit);
    if (kind.snapWidth) size.w = kind.snapWidth(panel, size.w, screen.w);
    if (size.w === panel.cell.w && size.h === panel.cell.h) return;
    Object.assign(panel.cell, size);
    kind.requestReflow(panel);
  };

  const beginDrag = (d: Dressed<P>, dragKind: Drag<P>['kind'], event: PointerLike): void => {
    if (drag || disposed || !ctx.isLive()) return;
    event.stopPropagation();
    endHold(true);
    raise(d.panel.id);
    const { cell } = d.panel;
    drag = { dressed: d, kind: dragKind, from: ui.toLocal(event.global), start: { ...cell } };
    const m = metrics(d.panel);
    if (dragKind === 'resize' && m) hold = { dressed: d, sheetLeft: cell.x + m.left, width: m.width, stable: 0, released: false };
    listen('pointermove', moveDrag);
    const end = (): void => endDrag(true);
    listen('pointerup', end);
    listen('pointercancel', end);
  };

  // Runs before the game sees the press. The new order reaches the game's hit test on the next frame,
  // so this press still lands on the panel that was on top, which is the one being raised.
  const onPress = (event: PointerEvent): void => {
    if (disposed || !ctx.isLive() || event.target !== real.canvas) return;
    const point = pointerInUi(event.clientX, event.clientY);
    if (!point) return;
    for (let rank = order.length - 1; rank >= 0; rank -= 1) {
      const d = dressed.find(entry => entry.panel.id === order[rank]);
      if (!d || !cellContains(panelRect(d.panel), point)) continue;
      if (raise(d.panel.id)) save();
      return;
    }
  };

  const dressPanel = (panel: P, saved: SavedLayout): Dressed<P> => {
    const d: Dressed<P> = { panel, title: kind.title(panel), header: null, grip: null, headerWidth: 0, colors: null, join: undefined, checked: false, size: '', stable: 0,
      intent: saved[panel.id] ?? cellToSaved(panel.cell, screen, 0),
    };
    if (!kit) return d;
    const z = kind.rootZ(panel);
    // Under the panel, so anything of the game's that rides above the panel's top edge stays clickable.
    d.header = makeArtSprite(kit, kind.labels.header, 'grab', z - 0.5);
    d.grip = makeArtSprite(kit, kind.labels.grip, 'nwse-resize', z + 0.5);
    setArt(kit, d.grip, paintGrip(), GRIP_SIZE_PX, GRIP_SIZE_PX);
    d.header.on('pointerdown', event => beginDrag(d, 'move', event));
    d.grip.on('pointerdown', event => beginDrag(d, 'resize', event));
    panel.host.addChild(d.header, d.grip);
    return d;
  };
  dressed = ctx.panels.map(panel => dressPanel(panel, savedAtOpen));
  applyOrder();
  if (canPoint) listen('pointerdown', onPress);

  const followResize = (): void => {
    endDrag(false);
    endHold(false);
    const next = { w: real.width, h: real.height };
    for (const d of dressed) {
      place(d.panel, cellForScreen(d.intent, d.panel.cell, screen, next, fit));
      kind.requestReflow(d.panel);
      d.checked = false;
      d.stable = 0;
    }
    screen.w = next.w;
    screen.h = next.h;
  };

  const dress = (d: Dressed<P>, m: PanelMetrics | null): void => {
    const { header, grip } = d;
    if (!kit || !header || !grip) return;
    if (!m) {
      header.visible = false;
      grip.visible = false;
      return;
    }
    d.colors ??= kind.colors(d.panel, real.extract);
    if (d.join === undefined) d.join = kind.headerJoin?.(d.panel) ?? null;
    const { colors, join } = d;
    const art = colors && m.width !== d.headerWidth ? paintHeader(m.width, d.title, colors, kind.headerRadius, join) : null;
    if (art && setArt(kit, header, art, m.width, headerArtHeight(join))) d.headerWidth = m.width;
    header.visible = d.headerWidth > 0;
    grip.visible = true;
    header.position.set(m.left, m.y - HEADER_HEIGHT_PX);
    grip.position.set(m.left + m.width - GRIP_SIZE_PX - 3, m.y + m.height - GRIP_SIZE_PX - 3);
  };

  /** Snaps a settled panel's width (opened, restored, window resized), growing it about its centre. */
  const resnap = (d: Dressed<P>): boolean => {
    const { cell } = d.panel;
    const w = kind.snapWidth ? kind.snapWidth(d.panel, cell.w, screen.w) : cell.w;
    if (w === cell.w) return false;
    place(d.panel, { ...cell, x: cell.x - Math.round((w - cell.w) / 2), w });
    kind.requestReflow(d.panel);
    d.stable = 0;
    return true;
  };

  const sync = (): void => {
    if (disposed) return;
    if (real.width !== screen.w || real.height !== screen.h) followResize();
    // One snap reflow per frame: a shop reflow rebuilds every tile, and panels opened together settle together.
    let reflowed = false;
    for (const d of dressed) {
      const { panel } = d;
      if (panel.host.destroyed) continue;
      const m = metrics(panel);
      if (m && hold?.dressed === d) {
        // The game re-centres the panel in its new cell; hold its left edge where it was.
        place(panel, { ...panel.cell, x: Math.round(hold.sheetLeft - m.left) });
        hold.stable = m.width === hold.width ? hold.stable + 1 : 0;
        hold.width = m.width;
        if (hold.released && hold.stable >= SETTLE_FRAMES) endHold(true);
      }
      if (m) {
        const size = `${m.width}x${m.height}`;
        d.stable = size === d.size ? d.stable + 1 : 0;
        d.size = size;
      }
      // Clamped only once the sheet has settled: right after a reflow request it still reports its old size.
      if (m && !d.checked && !drag && !hold && d.stable >= SETTLE_FRAMES && !reflowed) {
        if (resnap(d)) {
          reflowed = true;
        } else {
          d.checked = true;
          place(panel, clampCell(panel.cell, screen, m, fit));
        }
      }
      dress(d, m);
    }
  };

  const reset = (left: number): void => {
    endDrag(false);
    hold = null;
    const byIndex = dressed.slice().sort((a, b) => a.panel.index - b.panel.index);
    const cells = defaultCells(byIndex.length, left, screen, fit);
    order = byIndex.map(d => d.panel.id);
    applyOrder();
    byIndex.forEach((d, i) => {
      const cell = cells[i];
      if (cell) place(d.panel, clampCell(cell, screen, null, fit));
      d.intent = cellToSaved(d.panel.cell, screen, 0);
      kind.requestReflow(d.panel);
      d.checked = false;
      d.stable = 0;
    });
  };

  const remove = (id: string): void => {
    const d = dressed.find(entry => entry.panel.id === id);
    if (!d) return;
    if (drag?.dressed === d) endDrag(false);
    if (hold?.dressed === d) hold = null;
    dressed = dressed.filter(entry => entry !== d);
    order = order.filter(other => other !== id);
    destroySprites(kit, [d.header, d.grip]);
    applyOrder();
  };

  const add = (panel: P): void => {
    if (disposed || dressed.some(entry => entry.panel.id === panel.id)) return;
    dressed.push(dressPanel(panel, kind.layout.get()));
    order = [panel.id, ...order.filter(other => other !== panel.id)];
    applyOrder();
  };

  const dispose = (): void => {
    if (disposed) return;
    // A resize still settling is saved as it stands.
    if (hold?.released) {
      hold.dressed.intent = cellToSaved(hold.dressed.panel.cell, screen, 0);
      save();
    }
    disposed = true;
    drag = null;
    hold = null;
    unlisten(listeners.map(([type]) => type));
    for (const d of dressed) destroySprites(kit, [d.header, d.grip]);
  };

  const toClient = (point: Point): Point | null => {
    const rect = real.canvas?.getBoundingClientRect();
    if (!rect || !(real.width > 0) || !(real.height > 0)) return null;
    const global = typeof ui.toGlobal === 'function' ? ui.toGlobal(point) : point;
    return { x: Math.round(rect.left + global.x * (rect.width / real.width)), y: Math.round(rect.top + global.y * (rect.height / real.height)) };
  };

  const describe = (): Record<string, unknown> => ({
    decorated: kit !== null && canPoint,
    screen: { ...screen },
    order: [...order],
    dragging: drag ? { id: drag.dressed.panel.id, kind: drag.kind } : null,
    settling: hold?.released ? hold.dressed.panel.id : null,
    panels: dressed.map((d) => {
      const m = metrics(d.panel);
      const { cell } = d.panel;
      return {
        id: d.panel.id,
        title: d.title,
        cell: { ...cell },
        rect: panelRect(d.panel),
        hostZ: d.panel.host.zIndex,
        header: d.header?.visible === true,
        headerWidth: d.headerWidth,
        join: d.join ?? null,
        headerAt: m ? toClient({ x: cell.x + m.left + m.width / 2, y: cell.y + m.y - HEADER_HEIGHT_PX / 2 }) : null,
        gripAt: m ? toClient({ x: cell.x + m.left + m.width - 3 - GRIP_SIZE_PX / 2, y: cell.y + m.y + m.height - 3 - GRIP_SIZE_PX / 2 }) : null,
      };
    }),
  });

  return {
    decorated: kit !== null && canPoint, sync, reset, raise, order: () => order, add, remove, dispose, describe,
  };
}
