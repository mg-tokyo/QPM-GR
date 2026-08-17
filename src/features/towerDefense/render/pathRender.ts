import { getPath } from '../engine/path';
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

type PixiNode = Record<string, unknown>;
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
};
type GraphicsNode = PixiNode & {
  rect?: (x: number, y: number, w: number, h: number) => GraphicsNode;
  fill?: (opts: { color: number; alpha?: number }) => GraphicsNode;
  zIndex?: number;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

let tiles: GraphicsNode[] = [];
let unsubscribeContainer: (() => void) | null = null;

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
  // Re-add path graphics on container recreation (game rebuilt Camera subtree).
  // Old graphics are orphaned on the dead container; discard tracking and redraw.
  if (unsubscribeContainer === null) {
    unsubscribeContainer = onStageContainerRecreated(() => {
      tiles = [];
      renderPath();
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
  if (unsubscribeContainer) {
    try { unsubscribeContainer(); } catch { /* ignore */ }
    unsubscribeContainer = null;
  }
}
