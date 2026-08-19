import type { Point, Tower } from '../types';
import { getMatchSnapshot } from '../state';
import { getEffectiveStats, onTowerShot, type TowerShotInfo } from '../engine/tower';
import { onChainResolved, type TowerChainInfo } from '../engine/projectile';
import { renderBySpriteKey } from '../../../sprite-v2/compat';
import {
  getStageContainer,
  getStageSpriteCtor,
  getStageTextureCtor,
  getWorldPxPerTile,
  tileToPixel,
  TD_Z_EFFECT,
} from './stage';
import { makeEffectGraphics, spawnActiveEffect, type ActiveEffect, type GraphicsNode } from './effects';

type PixiNode = Record<string, unknown>;
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
};
type SpriteNode = PixiNode & {
  anchor?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  scale?: { set: (x: number, y: number) => void };
  rotation?: number;
  alpha?: number;
  zIndex?: number;
  texture?: unknown;
  visible?: boolean;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

const BOLT_MS = 150;
const STAR_MS = 150;
const GROUND_MS = 300;
const PILLAR_MS = 220;
const STAR_KEY = 'sprite/mutation/Thunderstruck';
const GROUND_KEY = 'sprite/mutation/ThunderstruckGround';
const PILLAR_KEY = 'sprite/mutation/Dawncharged';
const LICK_KEY = 'sprite/mutation/Amberlit';
const LICK_KEY_T3 = 'sprite/mutation/Ambercharged';
const FIRE_PILLAR_KEY = 'sprite/mutation/Ambercharged';
const PUDDLE_MS = 300;
const PUDDLE_COLOR = 0xff7a1a;
const LICK_ALPHA = 0.9;
const LICK_START_OFFSET_TILES = 0.5;
const FLAME_PARTICLES_PER_SHOT = 4;
const FLAME_PARTICLE_MS = 250;
// Each particle marches through this fraction of range during its life —
// combined with staggered startPhase per particle, four particles form a
// chain stretched from muzzle to ~1.25× range at any moment.
const FLAME_TRAVEL_FRACTION = 0.5;
const FLAME_MIN_SPREAD_RAD = Math.PI / 18;
const FLAME_SPREAD_PER_SPLASH_RAD = Math.PI / 15;

interface BoltStyle {
  readonly core: number;
  readonly glow: number;
  readonly width: number;
  readonly segments: number;
  readonly jitterPx: number;
  readonly starEveryHop: boolean;
}

// Palette per spec §7: yellow/teal base, teal-heavy on Storm Front T3+, violet
// (Dawncharged) on Overcharge T3+. Path B wins the look when both are ≥ 3
// because T3 on B locks A at ≤ 2 anyway.
function boltStyleFor(t: Tower): BoltStyle {
  if (t.upgradesB >= 3) return { core: 0xffffff, glow: 0xc05cff, width: t.upgradesB >= 4 ? 9.75 : 8.25, segments: 4, jitterPx: 8, starEveryHop: false };
  if (t.upgradesA >= 3) return { core: 0xd8fff9, glow: 0x3fd6c4, width: t.upgradesA >= 4 ? 6 : 5.25, segments: 5, jitterPx: 16, starEveryHop: true };
  if (t.upgradesB >= 2) return { core: 0xffffff, glow: 0x8ff0e4, width: 6.75, segments: 4, jitterPx: 10, starEveryHop: false };
  return { core: 0xfff7b0, glow: 0x6fe3d6, width: t.upgradesA >= 2 ? 4.8 : 3.75, segments: 5, jitterPx: 16, starEveryHop: false };
}

function container(): ContainerNode | null {
  return getStageContainer() as ContainerNode | null;
}

// Jagged multi-point bolt. Jitter is re-rolled every frame on purpose — that
// flicker is what reads as electricity (approved mockup behaviour).
function createBoltEffect(parent: ContainerNode, pointsPx: readonly Point[], style: BoltStyle, lifetimeMs: number): ActiveEffect | null {
  const g = acquireEffectGraphics(parent);
  if (!g) return null;
  const createdMs = performance.now();
  const tracePath = (): void => {
    for (let i = 0; i < pointsPx.length - 1; i++) {
      const a = pointsPx[i];
      const b = pointsPx[i + 1];
      if (!a || !b) continue;
      g.moveTo?.(a.x, a.y);
      for (let s = 1; s < style.segments; s++) {
        const t = s / style.segments;
        g.lineTo?.(
          a.x + (b.x - a.x) * t + (Math.random() - 0.5) * style.jitterPx,
          a.y + (b.y - a.y) * t + (Math.random() - 0.5) * style.jitterPx,
        );
      }
      g.lineTo?.(b.x, b.y);
    }
  };
  return {
    createdMs,
    lifetimeMs,
    tick(nowMs: number): void {
      const t = Math.min(1, (nowMs - createdMs) / lifetimeMs);
      const alpha = 1 - t;
      g.clear?.();
      tracePath();
      g.stroke?.({ color: style.glow, alpha: 0.35 * alpha, width: style.width * 4 });
      tracePath();
      g.stroke?.({ color: style.core, alpha, width: style.width });
    },
    destroy(): void {
      releaseEffectGraphics(g);
    },
  };
}

// One texture per sprite key for the lifetime of the module — Texture.from on
// a fresh canvas every shot would leak GPU textures at 30 shots/s.
interface CachedTexture { readonly texture: unknown; readonly widthPx: number; readonly heightPx: number }
const textureCache = new Map<string, CachedTexture>();

function textureFor(key: string): CachedTexture | null {
  const TextureCtor = getStageTextureCtor();
  if (!TextureCtor) return null;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const canvas = renderBySpriteKey(key, []);
  if (!canvas) return null;
  try {
    const entry: CachedTexture = { texture: TextureCtor.from(canvas), widthPx: canvas.width, heightPx: canvas.height };
    textureCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

interface SpriteEffectOpts {
  readonly heightTiles: number;
  readonly lifetimeMs: number;
  readonly yOffsetTiles?: number;
  readonly anchor?: { x: number; y: number };
  readonly rotation?: number;
  // Optional per-frame hook for flicker; receives progress 0..1 and now.
  readonly onTick?: (sprite: SpriteNode, progress: number, nowMs: number) => void;
  readonly widthPx?: number;
}

// Sprite pool for all createSpriteEffect callers (flame particles, Storm/chain
// stars, ground/pillar sprites). Reused sprites stay in the effect container
// invisible when idle — cuts new SpriteCtor + addChild + removeChild + destroy
// per particle down to a texture reassign + visibility flip.
const spritePool: SpriteNode[] = [];
const SPRITE_POOL_MAX = 96;

// Graphics pool for bolt strokes + puddle ellipses. g.clear() fully resets the
// geometry buffer so a reused Graphics draws the same as a fresh one.
type GraphicsWithVisibility = GraphicsNode & { visible?: boolean };
const graphicsPool: GraphicsNode[] = [];
const GRAPHICS_POOL_MAX = 32;

function acquireEffectGraphics(parent: ContainerNode): GraphicsNode | null {
  const pooled = graphicsPool.pop();
  if (pooled) {
    (pooled as GraphicsWithVisibility).visible = true;
    pooled.alpha = 1;
    return pooled;
  }
  const g = makeEffectGraphics();
  if (!g) return null;
  g.zIndex = TD_Z_EFFECT;
  parent.addChild?.(g);
  return g;
}

function releaseEffectGraphics(g: GraphicsNode): void {
  g.clear?.();
  (g as GraphicsWithVisibility).visible = false;
  g.alpha = 0;
  if (graphicsPool.length < GRAPHICS_POOL_MAX) graphicsPool.push(g);
}

function acquireEffectSprite(parent: ContainerNode, texture: unknown): SpriteNode | null {
  const pooled = spritePool.pop();
  if (pooled) {
    pooled.texture = texture;
    pooled.visible = true;
    return pooled;
  }
  const SpriteCtor = getStageSpriteCtor();
  if (!SpriteCtor) return null;
  try {
    const sprite = new SpriteCtor(texture) as SpriteNode;
    sprite.zIndex = TD_Z_EFFECT;
    parent.addChild?.(sprite);
    return sprite;
  } catch {
    return null;
  }
}

function releaseEffectSprite(sprite: SpriteNode): void {
  sprite.visible = false;
  sprite.alpha = 0;
  if (spritePool.length < SPRITE_POOL_MAX) spritePool.push(sprite);
}

function createSpriteEffect(parent: ContainerNode, key: string, pixel: Point, opts: SpriteEffectOpts): ActiveEffect | null {
  const tex = textureFor(key);
  if (!tex) return null;
  const sprite = acquireEffectSprite(parent, tex.texture);
  if (!sprite) return null;
  const worldPx = getWorldPxPerTile();
  const scaleY = (opts.heightTiles * worldPx) / tex.heightPx;
  const scaleX = opts.widthPx !== undefined ? opts.widthPx / tex.widthPx : scaleY;
  sprite.anchor?.set?.(opts.anchor?.x ?? 0.5, opts.anchor?.y ?? 0.5);
  sprite.scale?.set?.(scaleX, scaleY);
  sprite.position?.set?.(pixel.x, pixel.y + (opts.yOffsetTiles ?? 0) * worldPx);
  sprite.rotation = opts.rotation ?? 0;
  const createdMs = performance.now();
  return {
    createdMs,
    lifetimeMs: opts.lifetimeMs,
    tick(nowMs: number): void {
      const t = Math.min(1, (nowMs - createdMs) / opts.lifetimeMs);
      sprite.alpha = 1 - t;
      opts.onTick?.(sprite, t, nowMs);
    },
    destroy(): void {
      releaseEffectSprite(sprite);
    },
  };
}

function spawnBolt(pointsPx: readonly Point[], style: BoltStyle): void {
  const parent = container();
  if (!parent) return;
  const fx = createBoltEffect(parent, pointsPx, style, BOLT_MS);
  if (fx) spawnActiveEffect(fx);
}

function spawnSpriteEffect(key: string, pixel: Point, opts: SpriteEffectOpts): void {
  const parent = container();
  if (!parent) return;
  const fx = createSpriteEffect(parent, key, pixel, opts);
  if (fx) spawnActiveEffect(fx);
}

function findTower(id: string): Tower | null {
  return getMatchSnapshot().towers.find((t) => t.id === id) ?? null;
}

function handleStormShot(tower: Tower, info: TowerShotInfo): void {
  const style = boltStyleFor(tower);
  const fromPx = tileToPixel(info.from);
  const toPx = tileToPixel(info.to);
  spawnBolt([fromPx, toPx], style);
  spawnSpriteEffect(STAR_KEY, toPx, { heightTiles: 0.55, lifetimeMs: STAR_MS });
  // T4A Thunderstrike: tickTowers increments shotCounter BEFORE emitting the
  // shot, so counter % N === 0 means THIS shot carried the proc-nuke.
  const stats = getEffectiveStats(tower);
  if (tower.upgradesA >= 4 && stats.procEveryNthShot && (tower.shotCounter ?? 0) % stats.procEveryNthShot === 0) {
    spawnSpriteEffect(GROUND_KEY, toPx, { heightTiles: 0.9, lifetimeMs: GROUND_MS, yOffsetTiles: 0.2 });
    spawnSpriteEffect(STAR_KEY, toPx, { heightTiles: 1.2, lifetimeMs: GROUND_MS });
  }
  if (tower.upgradesB >= 4) {
    spawnSpriteEffect(PILLAR_KEY, toPx, { heightTiles: 1.6, lifetimeMs: PILLAR_MS, yOffsetTiles: -0.5 });
  }
}

type EllipseGraphics = GraphicsNode & {
  ellipse?: (x: number, y: number, rx: number, ry: number) => GraphicsNode;
};

function spawnPuddle(pixel: Point): void {
  const parent = container();
  if (!parent) return;
  const g = acquireEffectGraphics(parent) as EllipseGraphics | null;
  if (!g) return;
  const worldPx = getWorldPxPerTile();
  const createdMs = performance.now();
  spawnActiveEffect({
    createdMs,
    lifetimeMs: PUDDLE_MS,
    tick(nowMs: number): void {
      const t = Math.min(1, (nowMs - createdMs) / PUDDLE_MS);
      g.clear?.();
      g.ellipse?.(pixel.x, pixel.y + worldPx * 0.15, worldPx * 0.5, worldPx * 0.12)
        .fill?.({ color: PUDDLE_COLOR, alpha: 0.35 * (1 - t) });
    },
    destroy(): void {
      releaseEffectGraphics(g);
    },
  });
}

// Flamethrower: N staggered particles per shot marching outward along the aim
// vector with a splash-scaled cone spread. Each particle's onTick advances
// its own position; staggered startPhase spreads the 4 particles along the
// range so they read as a moving chain rather than a puff.
function handleForgeShot(tower: Tower, info: TowerShotInfo): void {
  if (tower.upgradesA < 2) return;
  const worldPx = getWorldPxPerTile();
  const fromPx = tileToPixel(info.from);
  const toPx = tileToPixel(info.to);
  const dx = toPx.x - fromPx.x;
  const dy = toPx.y - fromPx.y;
  const baseAngle = Math.atan2(dy, dx);
  const stats = getEffectiveStats(tower);
  const anchorPx: Point = {
    x: fromPx.x + Math.cos(baseAngle) * LICK_START_OFFSET_TILES * worldPx,
    y: fromPx.y + Math.sin(baseAngle) * LICK_START_OFFSET_TILES * worldPx,
  };
  const spreadRad = Math.max(FLAME_MIN_SPREAD_RAD, stats.splashRadius * FLAME_SPREAD_PER_SPLASH_RAD);
  const travelPx = stats.range * worldPx;
  const particleHeight = Math.max(stats.splashRadius, 0.9);
  const key = tower.upgradesA >= 3 ? LICK_KEY_T3 : LICK_KEY;
  const anchorX = anchorPx.x;
  const anchorY = anchorPx.y;
  for (let i = 0; i < FLAME_PARTICLES_PER_SHOT; i++) {
    const startPhase = i / FLAME_PARTICLES_PER_SHOT;
    const angleOffset = (Math.random() * 2 - 1) * spreadRad;
    const particleAngle = baseAngle + angleOffset;
    const dxPerProgress = Math.cos(particleAngle) * travelPx;
    const dyPerProgress = Math.sin(particleAngle) * travelPx;
    spawnSpriteEffect(key, anchorPx, {
      heightTiles: particleHeight,
      lifetimeMs: FLAME_PARTICLE_MS,
      anchor: { x: 0.5, y: 0.5 },
      rotation: particleAngle,
      onTick(sprite, t) {
        const progress = startPhase + t * FLAME_TRAVEL_FRACTION;
        sprite.position?.set?.(anchorX + dxPerProgress * progress, anchorY + dyPerProgress * progress);
        sprite.alpha = LICK_ALPHA - LICK_ALPHA * t;
      },
    });
  }
  if (tower.upgradesA >= 3) spawnPuddle(tileToPixel(info.to));
  if (tower.upgradesA >= 4) {
    spawnSpriteEffect(FIRE_PILLAR_KEY, tileToPixel(info.to), { heightTiles: 1.4, lifetimeMs: PILLAR_MS, yOffsetTiles: -0.4 });
  }
}

function handleShot(info: TowerShotInfo): void {
  const tower = findTower(info.towerId);
  if (!tower) return;
  if (info.kind === 'stormLantern') handleStormShot(tower, info);
  if (info.kind === 'fairyForge') handleForgeShot(tower, info);
}

function handleChain(info: TowerChainInfo): void {
  const tower = findTower(info.ownerId);
  if (!tower || tower.kind !== 'stormLantern') return;
  const style = boltStyleFor(tower);
  const px = info.points.map((p) => tileToPixel(p));
  spawnBolt(px, { ...style, width: style.width * 0.75 });
  if (style.starEveryHop) {
    for (let i = 1; i < px.length; i++) {
      const p = px[i];
      if (p) spawnSpriteEffect(STAR_KEY, p, { heightTiles: 0.45, lifetimeMs: STAR_MS });
    }
  }
}

interface ModuleState {
  shotUnsubscribe: () => void;
  chainUnsubscribe: () => void;
}
let state: ModuleState | null = null;

export function initStormForgeEffects(): void {
  if (state) return;
  state = {
    shotUnsubscribe: onTowerShot(handleShot),
    chainUnsubscribe: onChainResolved(handleChain),
  };
}

export function stopStormForgeEffects(): void {
  const s = state;
  if (!s) return;
  state = null;
  s.shotUnsubscribe();
  s.chainUnsubscribe();
  textureCache.clear();
  spritePool.length = 0;
  graphicsPool.length = 0;
}
