// The art for a panel's header and resize grip: canvas-painted textures on the game's own sprite class.
import { getDecor } from '../../catalogs/gameCatalogs';
import { walkScene } from '../../core/pixiScene';
import { resolveBaseSpriteCtor } from '../../sprite-v2/utils';
import { isRecord } from '../../utils/typeGuards';
import { HEADER_HEIGHT_PX } from './layout';
import type { PixiNode } from './gameHooks';

export const GRIP_SIZE_PX = 18;

export interface TextureLike { destroy(destroySource?: boolean): void }
export interface PointerLike { global: { x: number; y: number }; stopPropagation(): void }
export interface ArtSprite extends PixiNode {
  texture: unknown;
  width: number;
  height: number;
  eventMode: string;
  cursor: string;
  position: { set(x: number, y: number): void };
  on(event: string, handler: (event: PointerLike) => void): unknown;
}
interface TextureClass { from(source: HTMLCanvasElement, skipCache?: boolean): TextureLike; EMPTY?: unknown; WHITE?: unknown }
export interface SpriteKit { Sprite: new (texture: unknown) => ArtSprite; Texture: TextureClass }

/** wood: header body; light: its top highlight; edge: the line under it; inner: text shadow and grip dots. */
export interface FrameColors { light: string; wood: string; edge: string; inner: string }

interface ExtractLike { pixels(target: unknown): { pixels: ArrayLike<number>; width: number; height: number } }
interface FrameLike { getLocalBounds(): { width: number; height: number } }

const SCAN_LIMIT = 3000;

function kitFrom(node: Record<string, unknown>): SpriteKit | null {
  const texture = node.texture;
  if (!isRecord(texture)) return null;
  const Texture = texture.constructor as unknown as TextureClass | undefined;
  // Climbs past game subclasses (Rive-backed sprites throw on a bare texture) to PIXI's own Sprite.
  const Sprite = resolveBaseSpriteCtor(node.constructor);
  if (typeof Sprite !== 'function' || typeof Texture?.from !== 'function') return null;
  return { Sprite: Sprite as SpriteKit['Sprite'], Texture };
}

/** The game's sprite and texture classes, taken from a plain sprite inside one of the panels (never the stage). */
export function findSpriteKit(roots: readonly PixiNode[]): SpriteKit | null {
  for (const root of roots) {
    let kit: SpriteKit | null = null;
    walkScene(root, (node): boolean | void => {
      if ((node as Record<string, unknown>).renderPipeId !== 'sprite') return;
      kit = kitFrom(node as Record<string, unknown>);
      return kit !== null;
    }, { maxNodes: SCAN_LIMIT });
    if (kit) return kit;
  }
  return null;
}

/** The game's own name for the storage building, else its id split into words. */
export function storageTitle(storageId: string): string {
  const name = getDecor(storageId)?.name;
  return typeof name === 'string' && name.length > 0 ? name : storageId.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export function paint(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  draw(ctx);
  return canvas;
}

/**
 * Reads the header's colours down the middle of the panel's own frame: top highlight, wood border, its dark
 * inner edge, the panel inside. Null: not drawn yet, ask next frame. 'unreadable': sampling failed for good.
 */
export function sampleFrameColors(extract: unknown, frame: unknown): FrameColors | null | 'unreadable' {
  if (!isRecord(frame) || typeof frame.getLocalBounds !== 'function') return null;
  const bounds = (frame as unknown as FrameLike).getLocalBounds();
  if (!(bounds.width > 0) || !(bounds.height > 30)) return null;
  if (!isRecord(extract) || typeof extract.pixels !== 'function') return 'unreadable';
  try {
    const { pixels, width, height } = (extract as unknown as ExtractLike).pixels(frame);
    const scale = width / bounds.width;
    const at = (y: number): string | null => {
      const i = (Math.min(height - 1, Math.round(y * scale)) * width + Math.floor(width / 2)) * 4;
      return (pixels[i + 3] ?? 0) > 200 ? `rgb(${pixels[i] ?? 0}, ${pixels[i + 1] ?? 0}, ${pixels[i + 2] ?? 0})` : null;
    };
    const light = at(0);
    const wood = at(3);
    const edge = at(12);
    const inner = at(24);
    return light && wood && edge && inner ? { light, wood, edge, inner } : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

// Used only when the frame cannot be sampled: a plain dark header, not a guess at the game's colours.
export const NEUTRAL_COLORS: FrameColors = {
  light: 'rgba(255, 255, 255, 0.25)', wood: 'rgba(20, 16, 12, 0.82)', edge: 'rgba(0, 0, 0, 0.6)', inner: 'rgba(0, 0, 0, 0.9)',
};

/**
 * A panel whose own top corners are rounded: the header takes their radius and reaches that far down behind
 * the panel in its top colour, filling the corners the panel leaves open under the header's square bottom.
 */
export interface HeaderJoin { radius: number; color: string }

export type HeaderContext = Pick<CanvasRenderingContext2D,
  'fillStyle' | 'beginPath' | 'roundRect' | 'fill' | 'fillRect' | 'save' | 'clip' | 'restore' | 'globalAlpha' | 'arc' | 'font'
  | 'textBaseline' | 'shadowColor' | 'shadowOffsetY' | 'fillText'>;

/** A piece of the panel's wooden frame, so it reads as the panel's own header. */
export function drawHeader(
  ctx: HeaderContext, width: number, title: string, colors: FrameColors, radius: number, font: string, join?: HeaderJoin | null,
): void {
  const h = HEADER_HEIGHT_PX;
  if (join) {
    ctx.fillStyle = join.color;
    ctx.fillRect(0, h, width, join.radius);
  }
  ctx.fillStyle = colors.wood;
  ctx.beginPath();
  if (join) {
    ctx.roundRect(0, 0, width, h, [join.radius, join.radius, 0, 0]);
    ctx.fill();
    ctx.save();
    // The highlight would otherwise run past the wide corners.
    ctx.clip();
  } else {
    // Taller than the canvas, so only the top corners come out rounded.
    ctx.roundRect(0, 0, width, h + 12, radius);
    ctx.fill();
  }
  ctx.fillStyle = colors.light;
  ctx.fillRect(4, 0, width - 8, 1.5);
  ctx.fillStyle = colors.edge;
  ctx.fillRect(0, h - 1, width, 1);
  if (join) ctx.restore();
  ctx.fillStyle = colors.inner;
  ctx.globalAlpha = 0.7;
  for (let col = 0; col < 2; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      ctx.beginPath();
      ctx.arc(11 + col * 5, h / 2 - 5 + row * 5, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = colors.inner;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = 'rgb(255, 244, 222)';
  ctx.fillText(title, 26, h / 2, Math.max(10, width - 34));
}

/** The header's art: `HEADER_HEIGHT_PX` tall, plus the join's radius below it when there is one. */
export function paintHeader(width: number, title: string, colors: FrameColors, radius = 5, join?: HeaderJoin | null): HTMLCanvasElement | null {
  const font = `700 13px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
  return paint(width, headerArtHeight(join), ctx => drawHeader(ctx, width, title, colors, radius, font, join));
}

export function headerArtHeight(join?: HeaderJoin | null): number {
  return HEADER_HEIGHT_PX + (join ? join.radius : 0);
}

export function paintGrip(): HTMLCanvasElement | null {
  const size = GRIP_SIZE_PX;
  return paint(size, size, (ctx) => {
    ctx.lineCap = 'round';
    const strokes: Array<[string, number]> = [['rgba(0, 0, 0, 0.55)', 3.2], ['rgba(255, 255, 255, 0.9)', 1.6]];
    for (const [style, lineWidth] of strokes) {
      ctx.strokeStyle = style;
      ctx.lineWidth = lineWidth;
      for (const inset of [4, 9, 14]) {
        ctx.beginPath();
        ctx.moveTo(size - 3, inset);
        ctx.lineTo(inset, size - 3);
        ctx.stroke();
      }
    }
  });
}

function isOwnTexture(kit: SpriteKit, texture: unknown): texture is TextureLike {
  return isRecord(texture) && texture !== kit.Texture.EMPTY && texture !== kit.Texture.WHITE && typeof texture.destroy === 'function';
}

/** Swaps in new art and frees the old; the game's shared blank and white textures are never destroyed. */
export function setArt(kit: SpriteKit, sprite: ArtSprite, canvas: HTMLCanvasElement | null, width: number, height: number): boolean {
  if (!canvas) return false;
  const old = sprite.texture;
  sprite.texture = kit.Texture.from(canvas, true);
  sprite.width = width;
  sprite.height = height;
  if (isOwnTexture(kit, old)) old.destroy(true);
  return true;
}

export function makeArtSprite(kit: SpriteKit, label: string, cursor: string, zIndex: number): ArtSprite {
  const sprite = new kit.Sprite(kit.Texture.EMPTY);
  sprite.label = label;
  sprite.eventMode = 'static';
  sprite.cursor = cursor;
  sprite.zIndex = zIndex;
  sprite.visible = false;
  return sprite;
}

export function destroyArtSprite(kit: SpriteKit, sprite: ArtSprite): void {
  if (sprite.destroyed) return;
  const own = isOwnTexture(kit, sprite.texture);
  sprite.destroy({ texture: own, textureSource: own });
}
