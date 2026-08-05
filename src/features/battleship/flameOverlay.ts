import type { Coord } from './types';
import { tileWorldPosition, type GridSide } from './gardenStage';
import { getPixiRuntime, findByLabel, walkScene } from '../../core/pixiScene';
import { createNamedLogger } from '../../diagnostics/logger';
import { pageWindow } from '../../core/pageContext';

const log = createNamedLogger('battleship');

// Flame overlay for HIT markers. Sits as a child of the Camera container so
// pan/zoom apply automatically — flames render in world coordinates. Tile
// pitch = 256 world px (spike findings §6 + live check 2026-08-04: two Tile
// nodes 12 cols apart had wt.tx diff 720 screen px at camera scale 0.234375
// → 3072 world px / 12 = 256/col). Anchor 0.5 + centered position places the
// sprite at the tile center; scale 1 makes it exactly tile-sized.

const CONTAINER_LABEL = '__qpm_bs-flames';
const WORLD_PX_PER_TILE = 256;

type PixiNode = Record<string, unknown>;
type SpriteCtor = new (tex: unknown) => PixiNode & {
  anchor?: { set: (x: number, y: number) => void };
  scale?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};
type TextureCtor = { from: (source: unknown) => unknown };
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
  children?: PixiNode[];
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
  eventMode?: string;
};

interface FlameOverlayState {
  camera: ContainerNode;
  container: ContainerNode;
  spriteCtor: SpriteCtor;
  texture: unknown;
  flames: Map<string, PixiNode>;
}

let state: FlameOverlayState | null = null;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function findSpriteCtors(stage: unknown): { Sprite: SpriteCtor; Texture: TextureCtor } | null {
  const P = (pageWindow as Record<string, unknown>).PIXI as Record<string, unknown> | undefined;
  if (isObject(P) && typeof P.Sprite === 'function' && isObject(P.Texture) && typeof P.Texture.from === 'function') {
    return { Sprite: P.Sprite as unknown as SpriteCtor, Texture: P.Texture as unknown as TextureCtor };
  }
  // Walk the stage for any Sprite instance and grab constructors from it.
  // Matches sprite-v2/utils.ts::getCtors strategy. Skip Rive-backed subclasses
  // (SharedRiveSprite / RiveSprite) — `new SharedRiveSprite(tex)` throws with
  // 'Cannot read properties of undefined (reading advance)' during the game's
  // backing acquisition, verified live 2026-08-04 (QPM-BS-FLAME-007). Rive
  // sprites are identified by a `draw(timeMs)` method (arity 1) that plain
  // PIXI.Sprite lacks — see src/features/standalone/textureSwapper/rive/detection.ts.
  let candidateSprite: SpriteCtor | null = null;
  let candidateTexture: TextureCtor | null = null;
  walkScene(stage, (node): boolean | void => {
    const n = node as {
      texture?: { constructor?: unknown; frame?: unknown };
      constructor?: unknown;
      draw?: unknown;
    };
    if (!n.texture || !n.texture.frame) return;
    if (typeof n.draw === 'function' && (n.draw as { length: number }).length === 1) return;
    const S = n.constructor;
    const T = n.texture.constructor as { from?: unknown } | undefined;
    if (typeof S === 'function' && T && typeof T.from === 'function') {
      candidateSprite = S as unknown as SpriteCtor;
      candidateTexture = T as unknown as TextureCtor;
      return true;
    }
  }, { maxNodes: 8000 });
  if (candidateSprite && candidateTexture) {
    return { Sprite: candidateSprite, Texture: candidateTexture };
  }
  return null;
}

function loadFlameCanvas(): HTMLCanvasElement | null {
  const svc = (pageWindow as Record<string, unknown>).__MG_SPRITE_SERVICE__ as
    | { renderToCanvas?: (opts: { category: string; id: string; mutations: string[] }) => HTMLCanvasElement | null }
    | undefined;
  if (!svc || typeof svc.renderToCanvas !== 'function') return null;
  try {
    const c = svc.renderToCanvas({ category: 'any', id: 'sprite/ui/FlameIcon', mutations: [] });
    return c ?? null;
  } catch {
    return null;
  }
}

export function initFlameOverlay(): boolean {
  if (state) return true;
  const rt = getPixiRuntime();
  if (!rt.ready || !rt.stage) {
    log.warn('QPM-BS-FLAME-001', { reason: 'pixi_not_ready' });
    return false;
  }
  const camera = findByLabel(rt.stage, 'Camera') as ContainerNode | null;
  if (!camera || typeof camera.addChild !== 'function') {
    log.warn('QPM-BS-FLAME-002', { reason: 'no_camera_container' });
    return false;
  }
  const ctors = findSpriteCtors(rt.stage);
  if (!ctors) {
    log.warn('QPM-BS-FLAME-003', { reason: 'no_sprite_ctors' });
    return false;
  }
  const canvas = loadFlameCanvas();
  if (!canvas) {
    log.warn('QPM-BS-FLAME-004', { reason: 'no_flame_canvas' });
    return false;
  }
  let texture: unknown;
  try {
    texture = ctors.Texture.from(canvas);
  } catch (err) {
    log.warn('QPM-BS-FLAME-005', { reason: 'texture_create_failed' }, err);
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
      log.warn('QPM-BS-FLAME-006', { reason: 'container_ctor_failed' });
      return false;
    }
    container.label = CONTAINER_LABEL;
    container.eventMode = 'none';
    camera.addChild(container);
  }
  state = { camera, container, spriteCtor: ctors.Sprite, texture, flames: new Map() };
  return true;
}

function key(slotIdx: number, grid: GridSide, c: Coord): string {
  return `${slotIdx}:${grid}:${c.col},${c.row}`;
}

export function markFlameAt(slotIdx: number, grid: GridSide, c: Coord): boolean {
  const s = state;
  if (!s) return false;
  const world = tileWorldPosition(slotIdx, grid, c);
  if (!world) return false;
  const k = key(slotIdx, grid, c);
  if (s.flames.has(k)) return true;
  let sprite: InstanceType<SpriteCtor>;
  try {
    sprite = new s.spriteCtor(s.texture) as InstanceType<SpriteCtor>;
  } catch (err) {
    log.warn('QPM-BS-FLAME-007', { reason: 'sprite_ctor_failed' }, err);
    return false;
  }
  sprite.anchor?.set?.(0.5, 0.5);
  sprite.scale?.set?.(1, 1);
  sprite.position?.set?.(
    (world.col + 0.5) * WORLD_PX_PER_TILE,
    (world.row + 0.5) * WORLD_PX_PER_TILE,
  );
  s.container.addChild?.(sprite);
  s.flames.set(k, sprite);
  return true;
}

export function clearAllFlames(): void {
  const s = state;
  if (!s) return;
  for (const sprite of s.flames.values()) {
    try {
      s.container.removeChild?.(sprite);
      (sprite as { destroy?: (opts?: { children?: boolean; texture?: boolean }) => void }).destroy?.({
        children: false,
        texture: false,
      });
    } catch {
      /* ignore */
    }
  }
  s.flames.clear();
}

export function destroyFlameOverlay(): void {
  const s = state;
  if (!s) return;
  clearAllFlames();
  try {
    s.camera.removeChild?.(s.container);
    s.container.destroy?.({ children: true, texture: false });
  } catch {
    /* ignore */
  }
  state = null;
}

export function isFlameOverlayActive(): boolean {
  return state !== null;
}
