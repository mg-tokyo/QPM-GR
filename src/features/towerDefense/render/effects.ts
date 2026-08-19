import type { BalloonId, Point } from '../types';
import { getBalloonDef } from '../data/balloonDefs';
import { onBalloonPopped, type BalloonPopInfo } from './balloonRender';
import { createNamedLogger } from '../../../diagnostics/logger';
import { onTowerShot, type TowerShotInfo } from '../engine/tower';
import { getMatchSnapshot } from '../state';
import { onIncomePayout, type IncomePayoutInfo } from '../engine/economy';
import { isInstantHitTower } from './projectileRender';
import {
  getStageContainer,
  getStageGraphicsCtor,
  getStageSpriteCtor,
  getStageTextureCtor,
  getWorldPxPerTile,
  tileToPixel,
  TD_Z_EFFECT,
} from './stage';
import { recordRenderTick } from '../debug/perfCounters';

const log = createNamedLogger('td');

type PixiNode = Record<string, unknown>;
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
};
export type GraphicsNode = PixiNode & {
  circle?: (x: number, y: number, r: number) => GraphicsNode;
  moveTo?: (x: number, y: number) => GraphicsNode;
  lineTo?: (x: number, y: number) => GraphicsNode;
  fill?: (opts: { color: number; alpha?: number }) => GraphicsNode;
  stroke?: (opts: { color: number; alpha?: number; width: number }) => GraphicsNode;
  clear?: () => GraphicsNode;
  zIndex?: number;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
  alpha?: number;
  position?: { set: (x: number, y: number) => void };
};
type SpriteNode = PixiNode & {
  anchor?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  alpha?: number;
  zIndex?: number;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

const EXPLOSION_MS = 400;
const POP_MS = 300;
const REFUND_MS = 1100;
const BEAM_MS = 140;
const POP_CIRCLE_COUNT = 4;
const POP_RADIUS_PX = 60;
const REFUND_FLOAT_PX = 140;
const REFUND_CANVAS_H = 100;
const REFUND_STROKE_WIDTH = 10;
const EXPLOSION_COLOR = 0xffaa33;
const SCARECROW_BEAM_COLOR = '#ffe28a';
const SCARECROW_BEAM_COLOR_T4A = '#ff5533';
const SCARECROW_BEAM_COLOR_T4B = '#c866ff';
const REFUND_TEXT_COLOR = '#7cff9e';
// Sized against WORLD_PX_PER_TILE (256) so grove income reads as ~28% of a
// tile — proportional to explosion visuals. Previous 24px looked tiny.
const REFUND_TEXT_FONT = 'bold 72px system-ui, sans-serif';
const REFUND_TEXT_STROKE = '#0a0a10';

// Numeric fallback tints for pop confetti when a caller passes a kind that
// balloonDefs didn't tint (yellowBee has no def.tint — uses this table).
const POP_KIND_FALLBACK: Record<BalloonId, number> = {
  redWorm:        0xe64545,
  blueWorm:       0x4589ff,
  greenWorm:      0x3fbf5f,
  yellowBee:      0xffdd44,
  rainbowWorm:    0xff88cc,
  stoneTurtle:    0x8a8a8a,
  bronzeCapybara: 0xb87333,
  goldMoab:       0xffcc33,
};

export interface ActiveEffect {
  readonly createdMs: number;
  readonly lifetimeMs: number;
  tick(nowMs: number): void;
  destroy(): void;
}

interface EffectsState {
  rafId: number | null;
  active: ActiveEffect[];
  popUnsubscribe: (() => void) | null;
  shotUnsubscribe: (() => void) | null;
  incomeUnsubscribe: (() => void) | null;
}

let state: EffectsState | null = null;

function parseHexTint(hex: string): number {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = Number.parseInt(s, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

function colorForPop(info: BalloonPopInfo): number {
  const def = getBalloonDef(info.kind);
  if (def.tint) return parseHexTint(def.tint);
  return POP_KIND_FALLBACK[info.kind];
}

export function makeEffectGraphics(): GraphicsNode | null {
  const Ctor = getStageGraphicsCtor();
  if (!Ctor) return null;
  try {
    return new Ctor() as GraphicsNode;
  } catch (err) {
    log.warn('QPM-TD-FX-001', { reason: 'graphics_ctor_failed' }, err);
    return null;
  }
}

function attachEffect(effect: ActiveEffect): void {
  const s = state;
  if (!s) { effect.destroy(); return; }
  s.active.push(effect);
}

function createExplosionEffect(container: ContainerNode, pixel: Point, radiusTiles: number): ActiveEffect | null {
  const g = makeEffectGraphics();
  if (!g) return null;
  const worldPx = getWorldPxPerTile();
  const maxRadius = radiusTiles * worldPx;
  g.zIndex = TD_Z_EFFECT;
  container.addChild?.(g);
  const createdMs = performance.now();
  return {
    createdMs,
    lifetimeMs: EXPLOSION_MS,
    tick(nowMs: number): void {
      const t = Math.min(1, (nowMs - createdMs) / EXPLOSION_MS);
      const radius = maxRadius * (0.2 + 0.8 * t);
      g.clear?.();
      g.circle?.(pixel.x, pixel.y, radius)
        .fill?.({ color: EXPLOSION_COLOR, alpha: 0.35 * (1 - t) })
        .stroke?.({ color: EXPLOSION_COLOR, alpha: 0.85 * (1 - t), width: 3 });
    },
    destroy(): void {
      try {
        container.removeChild?.(g);
        g.destroy?.({ children: false, texture: false });
      } catch { /* ignore */ }
    },
  };
}

function createPopEffect(container: ContainerNode, pixel: Point, color: number): ActiveEffect | null {
  const g = makeEffectGraphics();
  if (!g) return null;
  g.zIndex = TD_Z_EFFECT;
  container.addChild?.(g);
  const createdMs = performance.now();
  // Fixed angles avoid an RNG dependency; N spokes look uniformly radiant.
  const angles: number[] = [];
  for (let i = 0; i < POP_CIRCLE_COUNT; i++) {
    angles.push((i / POP_CIRCLE_COUNT) * Math.PI * 2);
  }
  return {
    createdMs,
    lifetimeMs: POP_MS,
    tick(nowMs: number): void {
      const t = Math.min(1, (nowMs - createdMs) / POP_MS);
      const alpha = 1 - t;
      const distance = POP_RADIUS_PX * t;
      const dotR = 10 * (1 - 0.5 * t);
      g.clear?.();
      for (const a of angles) {
        const cx = pixel.x + Math.cos(a) * distance;
        const cy = pixel.y + Math.sin(a) * distance;
        g.circle?.(cx, cy, dotR).fill?.({ color, alpha });
      }
    },
    destroy(): void {
      try {
        container.removeChild?.(g);
        g.destroy?.({ children: false, texture: false });
      } catch { /* ignore */ }
    },
  };
}

function renderTextCanvas(text: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = REFUND_TEXT_FONT;
  const metrics = ctx.measureText(text);
  const pad = 16;
  canvas.width = Math.ceil(metrics.width) + pad * 2;
  canvas.height = REFUND_CANVAS_H;
  const ctx2 = canvas.getContext('2d');
  if (!ctx2) return null;
  ctx2.font = REFUND_TEXT_FONT;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.lineWidth = REFUND_STROKE_WIDTH;
  ctx2.strokeStyle = REFUND_TEXT_STROKE;
  ctx2.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx2.fillStyle = REFUND_TEXT_COLOR;
  ctx2.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

function createBeamEffect(container: ContainerNode, fromPx: Point, toPx: Point, color: number, lifetimeMs: number): ActiveEffect | null {
  const g = makeEffectGraphics();
  if (!g) return null;
  g.zIndex = TD_Z_EFFECT;
  container.addChild?.(g);
  const createdMs = performance.now();
  return {
    createdMs,
    lifetimeMs,
    tick(nowMs: number): void {
      const t = Math.min(1, (nowMs - createdMs) / lifetimeMs);
      const alpha = 1 - t;
      g.clear?.();
      g.moveTo?.(fromPx.x, fromPx.y)
        .lineTo?.(toPx.x, toPx.y)
        .stroke?.({ color, alpha: 0.35 * alpha, width: 12 });
      g.moveTo?.(fromPx.x, fromPx.y)
        .lineTo?.(toPx.x, toPx.y)
        .stroke?.({ color, alpha, width: 3 });
    },
    destroy(): void {
      try {
        container.removeChild?.(g);
        g.destroy?.({ children: false, texture: false });
      } catch { /* ignore */ }
    },
  };
}

function createRefundEffect(container: ContainerNode, pixel: Point, amount: number): ActiveEffect | null {
  const SpriteCtor = getStageSpriteCtor();
  const TextureCtor = getStageTextureCtor();
  if (!SpriteCtor || !TextureCtor) return null;
  const canvas = renderTextCanvas(`+$${amount}`);
  if (!canvas) return null;
  let sprite: SpriteNode;
  try {
    const texture = TextureCtor.from(canvas);
    sprite = new SpriteCtor(texture) as SpriteNode;
  } catch (err) {
    log.warn('QPM-TD-FX-002', { reason: 'refund_sprite_ctor_failed' }, err);
    return null;
  }
  sprite.anchor?.set?.(0.5, 0.5);
  sprite.position?.set?.(pixel.x, pixel.y);
  sprite.zIndex = TD_Z_EFFECT;
  container.addChild?.(sprite);
  const createdMs = performance.now();
  return {
    createdMs,
    lifetimeMs: REFUND_MS,
    tick(nowMs: number): void {
      const t = Math.min(1, (nowMs - createdMs) / REFUND_MS);
      const y = pixel.y - REFUND_FLOAT_PX * t;
      sprite.position?.set?.(pixel.x, y);
      sprite.alpha = 1 - t;
    },
    destroy(): void {
      try {
        container.removeChild?.(sprite);
        sprite.destroy?.({ children: false, texture: true });
      } catch { /* ignore */ }
    },
  };
}

function tickFrame(nowMs: number): void {
  const s = state;
  if (!s) return;
  const surviving: ActiveEffect[] = [];
  for (const effect of s.active) {
    try {
      effect.tick(nowMs);
    } catch (err) {
      log.warn('QPM-TD-FX-003', { reason: 'effect_tick_threw' }, err);
    }
    if (nowMs - effect.createdMs >= effect.lifetimeMs) {
      try { effect.destroy(); } catch { /* ignore */ }
    } else {
      surviving.push(effect);
    }
  }
  s.active = surviving;
}

function frame(): void {
  const s = state;
  if (!s) return;
  const t0 = performance.now();
  tickFrame(t0);
  recordRenderTick(performance.now() - t0);
  s.rafId = requestAnimationFrame(frame);
}

export function spawnExplosionEffect(pixel: Point, radiusTiles: number): void {
  const s = state;
  if (!s) return;
  const container = getStageContainer() as ContainerNode | null;
  if (!container) return;
  const effect = createExplosionEffect(container, pixel, radiusTiles);
  if (effect) attachEffect(effect);
}

export function spawnPopEffect(pixel: Point, color: string): void {
  const s = state;
  if (!s) return;
  const container = getStageContainer() as ContainerNode | null;
  if (!container) return;
  const effect = createPopEffect(container, pixel, parseHexTint(color));
  if (effect) attachEffect(effect);
}

export function spawnRefundFloat(pixel: Point, amount: number): void {
  const s = state;
  if (!s) return;
  const container = getStageContainer() as ContainerNode | null;
  if (!container) return;
  const effect = createRefundEffect(container, pixel, amount);
  if (effect) attachEffect(effect);
}

export function spawnBeamEffect(fromPx: Point, toPx: Point, colorHex: string, lifetimeMs: number): void {
  const s = state;
  if (!s) return;
  const container = getStageContainer() as ContainerNode | null;
  if (!container) return;
  const effect = createBeamEffect(container, fromPx, toPx, parseHexTint(colorHex), lifetimeMs);
  if (effect) attachEffect(effect);
}

// Lets sibling render modules (stormForgeEffects.ts) run custom effects on
// this module's RAF loop and lifetime bookkeeping.
export function spawnActiveEffect(effect: ActiveEffect): void {
  if (!state) { effect.destroy(); return; }
  attachEffect(effect);
}

function handleBalloonPopped(info: BalloonPopInfo): void {
  const s = state;
  if (!s) return;
  const container = getStageContainer() as ContainerNode | null;
  if (!container) return;
  const effect = createPopEffect(container, info.pixel, colorForPop(info));
  if (effect) attachEffect(effect);
}

function handleTowerShot(info: TowerShotInfo): void {
  if (!isInstantHitTower(info.kind)) return;
  const fromPx = tileToPixel(info.from);
  const toPx = tileToPixel(info.to);
  let color = SCARECROW_BEAM_COLOR;
  const tower = getMatchSnapshot().towers.find((t) => t.id === info.towerId);
  if (tower) {
    if (tower.upgradesA >= 4) color = SCARECROW_BEAM_COLOR_T4A;
    else if (tower.upgradesB >= 4) color = SCARECROW_BEAM_COLOR_T4B;
  }
  spawnBeamEffect(fromPx, toPx, color, BEAM_MS);
}

function handleIncomePayout(info: IncomePayoutInfo): void {
  const pixel = tileToPixel(info.tilePosition);
  spawnRefundFloat(pixel, info.amount);
}

export function initEffects(): void {
  if (state) return;
  state = {
    rafId: null,
    active: [],
    popUnsubscribe: null,
    shotUnsubscribe: null,
    incomeUnsubscribe: null,
  };
  state.popUnsubscribe = onBalloonPopped(handleBalloonPopped);
  state.shotUnsubscribe = onTowerShot(handleTowerShot);
  state.incomeUnsubscribe = onIncomePayout(handleIncomePayout);
  state.rafId = requestAnimationFrame(frame);
}

export function stopEffects(): void {
  const s = state;
  if (!s) return;
  state = null;
  if (s.rafId !== null) {
    try { cancelAnimationFrame(s.rafId); } catch { /* ignore */ }
  }
  s.popUnsubscribe?.();
  s.shotUnsubscribe?.();
  s.incomeUnsubscribe?.();
  for (const effect of s.active) {
    try { effect.destroy(); } catch { /* ignore */ }
  }
  s.active = [];
}
