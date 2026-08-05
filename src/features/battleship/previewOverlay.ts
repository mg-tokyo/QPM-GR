import type { Coord } from './types';
import { tileWorldPosition, type GridSide } from './gardenStage';
import { getPixiRuntime, findByLabel, walkScene } from '../../core/pixiScene';
import { createNamedLogger } from '../../diagnostics/logger';

const log = createNamedLogger('battleship');

// Semi-transparent "ghost" of the ship the player is about to place. Same
// container-under-Camera pattern as flameOverlay so pan/zoom apply natively.
// Uses PIXI Graphics rects (no atlas texture needed for a solid tint).

const CONTAINER_LABEL = '__qpm_bs-preview';
const WORLD_PX_PER_TILE = 256;
// Purple, matches --qpm-accent so it reads as QPM-owned. RGB int for PIXI.
const FILL_COLOR = 0x8f82ff;
const FILL_ALPHA = 0.4;

type ContainerNode = Record<string, unknown> & {
  addChild?: (child: unknown) => void;
  removeChild?: (child: unknown) => void;
  children?: unknown[];
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
  eventMode?: string;
};

type GraphicsNode = Record<string, unknown> & {
  rect?: (x: number, y: number, w: number, h: number) => GraphicsNode;
  fill?: (opts: { color: number; alpha?: number }) => GraphicsNode;
  clear?: () => GraphicsNode;
  position?: { set: (x: number, y: number) => void };
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

type GraphicsCtor = new () => GraphicsNode;

interface PreviewOverlayState {
  camera: ContainerNode;
  container: ContainerNode;
  graphicsCtor: GraphicsCtor;
  cells: Map<string, GraphicsNode>;
}

let state: PreviewOverlayState | null = null;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

// core/pixiScene::getCtors requires BOTH Graphics AND Text; game stage may not
// have a visible Text node early in the walk (returned null live 2026-08-05,
// QPM-BS-PREVIEW-001). We only need Graphics + Container, so walk for that
// pair directly and skip Text entirely.
function findGraphicsCtor(stage: unknown): GraphicsCtor | null {
  let found: GraphicsCtor | null = null;
  walkScene(stage, (node): boolean | void => {
    const n = node as { rect?: unknown; constructor?: unknown };
    if (typeof n.rect === 'function' && typeof n.constructor === 'function') {
      found = n.constructor as GraphicsCtor;
      return true;
    }
  }, { maxNodes: 8000 });
  return found;
}

export function initPreviewOverlay(): boolean {
  if (state) return true;
  const rt = getPixiRuntime();
  if (!rt.ready || !rt.stage) return false;
  const camera = findByLabel(rt.stage, 'Camera') as ContainerNode | null;
  if (!camera || typeof camera.addChild !== 'function') return false;
  const graphicsCtor = findGraphicsCtor(rt.stage);
  if (!graphicsCtor) {
    log.warn('QPM-BS-PREVIEW-001', { reason: 'no_graphics_ctor' });
    return false;
  }
  let container = (camera.children ?? []).find(
    c => isObject(c) && (c as { label?: unknown }).label === CONTAINER_LABEL,
  ) as ContainerNode | undefined;
  if (!container) {
    const ContainerCtor = camera.constructor as new () => ContainerNode;
    try {
      container = new ContainerCtor();
    } catch {
      return false;
    }
    container.label = CONTAINER_LABEL;
    container.eventMode = 'none';
    camera.addChild(container);
  }
  state = { camera, container, graphicsCtor, cells: new Map() };
  return true;
}

function key(c: Coord): string {
  return `${c.col},${c.row}`;
}

export function setPreviewCells(slotIdx: number, grid: GridSide, cells: readonly Coord[]): void {
  const s = state;
  if (!s) return;
  const nextKeys = new Set(cells.map(key));
  for (const [k, node] of s.cells) {
    if (nextKeys.has(k)) continue;
    try {
      s.container.removeChild?.(node);
      node.destroy?.({ children: false, texture: false });
    } catch { /* ignore */ }
    s.cells.delete(k);
  }
  for (const c of cells) {
    const k = key(c);
    if (s.cells.has(k)) continue;
    const world = tileWorldPosition(slotIdx, grid, c);
    if (!world) continue;
    let g: GraphicsNode;
    try {
      g = new s.graphicsCtor();
    } catch { continue; }
    g.rect?.(0, 0, WORLD_PX_PER_TILE, WORLD_PX_PER_TILE).fill?.({ color: FILL_COLOR, alpha: FILL_ALPHA });
    g.position?.set?.(world.col * WORLD_PX_PER_TILE, world.row * WORLD_PX_PER_TILE);
    s.container.addChild?.(g);
    s.cells.set(k, g);
  }
}

export function clearPreview(): void {
  const s = state;
  if (!s) return;
  for (const node of s.cells.values()) {
    try {
      s.container.removeChild?.(node);
      node.destroy?.({ children: false, texture: false });
    } catch { /* ignore */ }
  }
  s.cells.clear();
}

export function destroyPreviewOverlay(): void {
  const s = state;
  if (!s) return;
  clearPreview();
  try {
    s.camera.removeChild?.(s.container);
    s.container.destroy?.({ children: true, texture: false });
  } catch { /* ignore */ }
  state = null;
}
