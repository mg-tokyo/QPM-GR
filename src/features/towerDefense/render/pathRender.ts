import { getPath } from '../engine/path';
import { getMatchSnapshot, onMatchChange } from '../state';
import {
  getStageContainer,
  getStageGraphicsCtor,
  getWorldPxPerTile,
  onStageContainerRecreated,
  tileToPixel,
  TD_Z_PATH,
} from './stage';

// Path uses translucent white so the underlying garden dirt still reads
// through — it's a hint of the route, not a hard overlay.
const PATH_COLOR = 0xffffff;
const PATH_ALPHA = 0.16;
const TILE_LABEL = '__qpm_td-pathTile';
const ARROW_LABEL = '__qpm_td-pathArrow';

// BTD6-style entry/exit indicators. Green enters, red exits. Sit one tier
// above path tiles so they read over the tile fill but under balloons.
const ENTRY_COLOR = 0x38d97e;
const EXIT_COLOR = 0xff5a5a;
const ARROW_OUTLINE = 0x000000;
const ARROW_OUTLINE_ALPHA = 0.6;
const ARROW_STROKE_PX = 12;
const ARROW_Z = TD_Z_PATH + 1;

type PixiNode = Record<string, unknown>;
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
};
type GraphicsNode = PixiNode & {
  rect?: (x: number, y: number, w: number, h: number) => GraphicsNode;
  moveTo?: (x: number, y: number) => GraphicsNode;
  lineTo?: (x: number, y: number) => GraphicsNode;
  fill?: (opts: { color: number; alpha?: number }) => GraphicsNode;
  stroke?: (opts: { color: number; alpha?: number; width: number }) => GraphicsNode;
  zIndex?: number;
  rotation?: number;
  visible?: boolean;
  position?: { set: (x: number, y: number) => void };
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

let tiles: GraphicsNode[] = [];
let arrows: GraphicsNode[] = [];
let unsubscribeContainer: (() => void) | null = null;
let unsubscribeMatch: (() => void) | null = null;
let arrowsVisible = true;

function applyArrowVisibility(): void {
  arrowsVisible = getMatchSnapshot().phase !== 'inRound';
  for (const g of arrows) g.visible = arrowsVisible;
}

function drawArrow(
  GraphicsCtorRef: new () => GraphicsNode,
  container: ContainerNode,
  cxPx: number,
  cyPx: number,
  angleRad: number,
  sizePx: number,
  color: number,
): GraphicsNode | null {
  let g: GraphicsNode;
  try {
    g = new GraphicsCtorRef();
  } catch {
    return null;
  }
  g.label = ARROW_LABEL;
  g.moveTo?.(sizePx, 0)
    .lineTo?.(-sizePx * 0.7, -sizePx * 0.7)
    .lineTo?.(-sizePx * 0.3, 0)
    .lineTo?.(-sizePx * 0.7, sizePx * 0.7)
    .lineTo?.(sizePx, 0)
    .fill?.({ color })
    .stroke?.({ color: ARROW_OUTLINE, alpha: ARROW_OUTLINE_ALPHA, width: ARROW_STROKE_PX });
  g.zIndex = ARROW_Z;
  g.position?.set(cxPx, cyPx);
  g.rotation = angleRad;
  container.addChild?.(g);
  return g;
}

function renderArrows(container: ContainerNode, GraphicsCtorRef: new () => GraphicsNode): void {
  const wps = getPath();
  if (wps.length < 2) return;
  const first = wps[0]!;
  const second = wps[1]!;
  const last = wps[wps.length - 1]!;
  const prevLast = wps[wps.length - 2]!;
  const worldPx = getWorldPxPerTile();
  const size = worldPx * 0.42;
  const entryAngle = Math.atan2(second.point.y - first.point.y, second.point.x - first.point.x);
  const exitAngle = Math.atan2(last.point.y - prevLast.point.y, last.point.x - prevLast.point.x);
  const entryPx = tileToPixel(first.point);
  const exitPx = tileToPixel(last.point);
  const entry = drawArrow(GraphicsCtorRef, container, entryPx.x, entryPx.y, entryAngle, size, ENTRY_COLOR);
  const exit = drawArrow(GraphicsCtorRef, container, exitPx.x, exitPx.y, exitAngle, size, EXIT_COLOR);
  if (entry) arrows.push(entry);
  if (exit) arrows.push(exit);
  applyArrowVisibility();
}

export function renderPath(): boolean {
  clearPath();
  const container = getStageContainer() as ContainerNode | null;
  const GraphicsCtorRef = getStageGraphicsCtor();
  if (!container || !GraphicsCtorRef) return false;
  const worldPx = getWorldPxPerTile();
  const half = worldPx / 2;
  for (const wp of getPath()) {
    let g: GraphicsNode;
    try {
      g = new GraphicsCtorRef();
    } catch {
      continue;
    }
    g.label = TILE_LABEL;
    const center = tileToPixel(wp.point);
    g.rect?.(center.x - half, center.y - half, worldPx, worldPx)
      .fill?.({ color: PATH_COLOR, alpha: PATH_ALPHA });
    g.zIndex = TD_Z_PATH;
    container.addChild?.(g);
    tiles.push(g);
  }
  renderArrows(container, GraphicsCtorRef as new () => GraphicsNode);
  // Re-add path graphics on container recreation (game rebuilt Camera subtree).
  // Old graphics are orphaned on the dead container; discard tracking and redraw.
  if (unsubscribeContainer === null) {
    unsubscribeContainer = onStageContainerRecreated(() => {
      tiles = [];
      arrows = [];
      renderPath();
    });
  }
  if (unsubscribeMatch === null) {
    unsubscribeMatch = onMatchChange((snap) => {
      const visible = snap.phase !== 'inRound';
      if (visible === arrowsVisible) return;
      arrowsVisible = visible;
      for (const g of arrows) g.visible = visible;
    });
  }
  return tiles.length > 0;
}

export function clearPath(): void {
  const container = getStageContainer() as ContainerNode | null;
  for (const g of tiles) {
    try {
      container?.removeChild?.(g);
      g.destroy?.({ children: false, texture: false });
    } catch { /* ignore */ }
  }
  tiles = [];
  for (const g of arrows) {
    try {
      container?.removeChild?.(g);
      g.destroy?.({ children: false, texture: false });
    } catch { /* ignore */ }
  }
  arrows = [];
  if (unsubscribeContainer) {
    try { unsubscribeContainer(); } catch { /* ignore */ }
    unsubscribeContainer = null;
  }
  if (unsubscribeMatch) {
    try { unsubscribeMatch(); } catch { /* ignore */ }
    unsubscribeMatch = null;
  }
}
