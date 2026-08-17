import type { Balloon, BalloonId, Point } from '../types';
import { getMatchSnapshot } from '../state';
import { getBalloonDef } from '../data/balloonDefs';
import { positionAt } from '../engine/path';
import { getPetSpriteWithMutations, renderBySpriteKey } from '../../../sprite-v2/compat';
import { createNamedLogger } from '../../../diagnostics/logger';
import {
  getStageContainer,
  getStageGraphicsCtor,
  getStageSpriteCtor,
  getStageTextureCtor,
  getWorldPxPerTile,
  tileToPixel,
  TD_Z_BALLOON,
} from './stage';
import { recordRenderTick } from '../debug/perfCounters';

const log = createNamedLogger('td');

type PixiNode = Record<string, unknown>;
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
};
type SpriteNode = PixiNode & {
  anchor?: { set: (x: number, y: number) => void };
  scale?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  tint?: number;
  alpha?: number;
  zIndex?: number;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

const TINT_WHITE = 0xffffff;
const TINT_CHILLED = 0x88ccff;
const DAMAGE_FLASH_MS = 150;
const BEE_BOB_AMPLITUDE_PX = 24;
const BEE_BOB_HZ = 2.4;

interface BalloonSpriteRecord {
  sprite: SpriteNode;
  overlay: SpriteNode | null;
  outline: PixiNode | null;
  kind: BalloonId;
  baseTint: number;
  lastHp: number;
  flashUntilMs: number;
  lastPixel: Point;
  hasCamo: boolean;
  hasRegen: boolean;
}

const CAMO_ALPHA = 0.6;
const CAMO_OUTLINE_RADIUS = 28;
const CAMO_OUTLINE_DASHES = 12;
const CAMO_OUTLINE_WIDTH = 3;
const CAMO_OUTLINE_COLOR = 0xffffff;
const CAMO_OUTLINE_ALPHA = 0.7;
const REGEN_OVERLAY_KEY = 'sprite/ui/HeartSticker';
const REGEN_OVERLAY_SCALE = 0.5;
const REGEN_OVERLAY_Y_OFFSET = -16;
const REGEN_PULSE_HZ = 0.83;
const REGEN_PULSE_MID = 0.4;
const REGEN_PULSE_AMPLITUDE = 0.15;

export interface BalloonPopInfo {
  readonly pixel: Point;
  readonly kind: BalloonId;
}

interface RenderState {
  rafId: number | null;
  lastFrameMs: number;
  sprites: Map<string, BalloonSpriteRecord>;
  popListeners: Set<(info: BalloonPopInfo) => void>;
}

let state: RenderState | null = null;

function parseHexTint(hex: string | undefined): number {
  if (!hex) return TINT_WHITE;
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = Number.parseInt(s, 16);
  return Number.isFinite(n) ? n : TINT_WHITE;
}

function buildBalloonCanvas(kind: BalloonId): HTMLCanvasElement | null {
  const def = getBalloonDef(kind);
  const overlays = def.mutationOverlay ? [def.mutationOverlay] : [];
  return getPetSpriteWithMutations(def.spriteName, overlays);
}

function createSprite(canvas: HTMLCanvasElement): SpriteNode | null {
  const SpriteCtor = getStageSpriteCtor();
  const TextureCtor = getStageTextureCtor();
  if (!SpriteCtor || !TextureCtor) return null;
  let texture: unknown;
  try {
    texture = TextureCtor.from(canvas);
  } catch (err) {
    log.warn('QPM-TD-BALLOON-001', { reason: 'texture_from_failed' }, err);
    return null;
  }
  let sprite: SpriteNode;
  try {
    sprite = new SpriteCtor(texture) as SpriteNode;
  } catch (err) {
    log.warn('QPM-TD-BALLOON-002', { reason: 'sprite_ctor_failed' }, err);
    return null;
  }
  sprite.anchor?.set?.(0.5, 0.5);
  return sprite;
}

function buildRegenOverlay(pixel: Point): SpriteNode | null {
  const canvas = renderBySpriteKey(REGEN_OVERLAY_KEY);
  if (!canvas) return null;
  const sprite = createSprite(canvas);
  if (!sprite) return null;
  sprite.alpha = REGEN_PULSE_MID;
  sprite.scale?.set?.(REGEN_OVERLAY_SCALE, REGEN_OVERLAY_SCALE);
  sprite.position?.set?.(pixel.x, pixel.y + REGEN_OVERLAY_Y_OFFSET);
  return sprite;
}

type DashedGraphicsNode = PixiNode & {
  moveTo?: (x: number, y: number) => unknown;
  arc?: (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => unknown;
  stroke?: (opts: { color: number; width: number; alpha?: number }) => unknown;
  position?: { set: (x: number, y: number) => void };
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

function buildCamoOutline(pixel: Point): PixiNode | null {
  const GraphicsCtor = getStageGraphicsCtor();
  if (!GraphicsCtor) return null;
  let g: DashedGraphicsNode;
  try {
    g = new GraphicsCtor() as DashedGraphicsNode;
  } catch (err) {
    log.warn('QPM-TD-BALLOON-004', { reason: 'graphics_ctor_failed' }, err);
    return null;
  }
  // Dashed ring: N equal-length arcs with N equal gaps around the perimeter.
  // PIXI v8 pens each arc individually via moveTo→arc; a single stroke() paints them all.
  const step = (Math.PI * 2) / CAMO_OUTLINE_DASHES;
  const arcSpan = step * 0.5;
  for (let i = 0; i < CAMO_OUTLINE_DASHES; i++) {
    const start = i * step;
    const end = start + arcSpan;
    g.moveTo?.(Math.cos(start) * CAMO_OUTLINE_RADIUS, Math.sin(start) * CAMO_OUTLINE_RADIUS);
    g.arc?.(0, 0, CAMO_OUTLINE_RADIUS, start, end);
  }
  g.stroke?.({ color: CAMO_OUTLINE_COLOR, width: CAMO_OUTLINE_WIDTH, alpha: CAMO_OUTLINE_ALPHA });
  g.position?.set?.(pixel.x, pixel.y);
  return g;
}

function addSprite(
  container: ContainerNode,
  balloon: Balloon,
  pixel: Point,
): BalloonSpriteRecord | null {
  const def = getBalloonDef(balloon.kind);
  const canvas = buildBalloonCanvas(balloon.kind);
  if (!canvas) return null;
  const sprite = createSprite(canvas);
  if (!sprite) return null;
  const baseTint = parseHexTint(def.tint);
  sprite.tint = baseTint;
  sprite.position?.set?.(pixel.x, pixel.y);

  const hasCamo = balloon.modifiers.includes('camo');
  const hasRegen = balloon.modifiers.includes('regen');
  if (hasCamo) sprite.alpha = CAMO_ALPHA;

  sprite.zIndex = TD_Z_BALLOON;
  container.addChild?.(sprite);

  const overlay = hasRegen ? buildRegenOverlay(pixel) : null;
  if (overlay) {
    overlay.zIndex = TD_Z_BALLOON;
    container.addChild?.(overlay);
  }

  const outline = hasCamo ? buildCamoOutline(pixel) : null;
  if (outline) {
    (outline as SpriteNode).zIndex = TD_Z_BALLOON;
    container.addChild?.(outline);
  }

  return {
    sprite,
    overlay,
    outline,
    kind: balloon.kind,
    baseTint,
    lastHp: balloon.hp,
    flashUntilMs: 0,
    lastPixel: pixel,
    hasCamo,
    hasRegen,
  };
}

function destroyRecord(container: ContainerNode, rec: BalloonSpriteRecord): void {
  try {
    container.removeChild?.(rec.sprite);
    rec.sprite.destroy?.({ children: false, texture: false });
    if (rec.overlay) {
      container.removeChild?.(rec.overlay);
      rec.overlay.destroy?.({ children: false, texture: false });
    }
    if (rec.outline) {
      container.removeChild?.(rec.outline);
      const g = rec.outline as DashedGraphicsNode;
      g.destroy?.({ children: false, texture: false });
    }
  } catch { /* ignore */ }
}

function isChilled(b: Balloon): boolean {
  for (const s of b.statuses) if (s.kind === 'chilled') return true;
  return false;
}

// Bee flies over corners in the design, but corner detection needs path
// geometry lookup — deferred as polish; the vertical bob alone reads as flight.
function beeBobOffset(nowMs: number): number {
  return Math.sin((nowMs / 1000) * BEE_BOB_HZ * Math.PI * 2) * BEE_BOB_AMPLITUDE_PX;
}

function chooseTint(rec: BalloonSpriteRecord, balloon: Balloon, nowMs: number): number {
  if (nowMs < rec.flashUntilMs) return TINT_WHITE;
  if (isChilled(balloon)) return TINT_CHILLED;
  return rec.baseTint;
}

function emitPop(info: BalloonPopInfo): void {
  const s = state;
  if (!s) return;
  for (const cb of s.popListeners) {
    try { cb(info); } catch { /* listener errors never break the loop */ }
  }
}

function tickFrame(nowMs: number): void {
  const s = state;
  if (!s) return;
  const container = getStageContainer() as ContainerNode | null;
  if (!container) return;

  s.lastFrameMs = nowMs;

  const snap = getMatchSnapshot();

  const seen = new Set<string>();
  for (const balloon of snap.balloons) {
    seen.add(balloon.id);
    const pos = positionAt(balloon.distance);
    const pixel = tileToPixel(pos);
    let rec = s.sprites.get(balloon.id);
    if (!rec) {
      const created = addSprite(container, balloon, pixel);
      if (!created) continue;
      s.sprites.set(balloon.id, created);
      rec = created;
    }
    if (balloon.hp < rec.lastHp) {
      rec.flashUntilMs = nowMs + DAMAGE_FLASH_MS;
    }
    rec.lastHp = balloon.hp;
    const drawX = pixel.x;
    const drawY = balloon.kind === 'yellowBee' ? pixel.y + beeBobOffset(nowMs) : pixel.y;
    rec.sprite.position?.set?.(drawX, drawY);
    rec.sprite.tint = chooseTint(rec, balloon, nowMs);
    rec.lastPixel = { x: drawX, y: drawY };
    if (rec.overlay) {
      rec.overlay.position?.set?.(drawX, drawY + REGEN_OVERLAY_Y_OFFSET);
      const pulse = REGEN_PULSE_MID + REGEN_PULSE_AMPLITUDE * Math.sin((nowMs / 1000) * Math.PI * 2 * REGEN_PULSE_HZ);
      rec.overlay.alpha = pulse;
    }
    if (rec.outline) {
      (rec.outline as DashedGraphicsNode).position?.set?.(drawX, drawY);
    }
  }

  for (const [id, rec] of s.sprites) {
    if (seen.has(id)) continue;
    emitPop({ pixel: rec.lastPixel, kind: rec.kind });
    destroyRecord(container, rec);
    s.sprites.delete(id);
  }
}

function frame(): void {
  const s = state;
  if (!s) return;
  const t0 = performance.now();
  try {
    tickFrame(t0);
  } catch (err) {
    log.warn('QPM-TD-BALLOON-003', { reason: 'frame_threw' }, err);
  }
  recordRenderTick(performance.now() - t0);
  s.rafId = requestAnimationFrame(frame);
}

export function initBalloonRender(): void {
  if (state) return;
  // Reads world-tile pitch for parity with prior init behavior; kept accessible
  // for future sprite-scale tuning.
  void getWorldPxPerTile();
  state = {
    rafId: null,
    lastFrameMs: 0,
    sprites: new Map(),
    popListeners: new Set(),
  };
  state.rafId = requestAnimationFrame(frame);
}

export function stopBalloonRender(): void {
  const s = state;
  if (!s) return;
  state = null;
  if (s.rafId !== null) {
    try { cancelAnimationFrame(s.rafId); } catch { /* ignore */ }
  }
  const container = getStageContainer() as ContainerNode | null;
  if (container) {
    for (const rec of s.sprites.values()) destroyRecord(container, rec);
  }
  s.sprites.clear();
  s.popListeners.clear();
}

export function onBalloonPopped(cb: (info: BalloonPopInfo) => void): () => void {
  const s = state;
  if (!s) return () => {};
  s.popListeners.add(cb);
  return () => {
    const t = state;
    if (!t) return;
    t.popListeners.delete(cb);
  };
}
