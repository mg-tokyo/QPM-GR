import type { Point, TowerId, UpgradeTier } from '../types';
import { getMatchSnapshot } from '../state';
import { renderBySpriteKey } from '../../../sprite-v2/compat';
import { createNamedLogger } from '../../../diagnostics/logger';
import {
  getStageContainer,
  onStageContainerRecreated,
  getStageSpriteCtor,
  tileToPixel,
  TD_Z_PROJECTILE,
  TD_Z_PATH_DROP,
} from './stage';
import { getSharedTexture } from './textureCache';
import { spawnExplosionEffect } from './effects';
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
  rotation?: number;
  alpha?: number;
  tint?: number;
  zIndex?: number;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

type RotationMode = 'none' | 'directional' | 'spin';

type GeneratedSpriteKind = 'ember' | 'emberWhite';

interface ProjectileSpec {
  readonly key: string;
  // When set, the sprite comes from a generated canvas instead of `key`.
  readonly generated?: GeneratedSpriteKind;
  readonly overlays: readonly string[];
  // Per-tower render scale. Source canvases vary wildly in native size (plant
  // sprites are noticeably larger than item sprites), so each projectile needs
  // its own multiplier to read as ~1 tile in-world. Tune live.
  readonly scale: number;
  // Rotation behavior. 'directional' points the sprite along velocity every
  // frame; 'spin' rotates at a fixed rate; 'none' leaves it upright.
  readonly rotation: RotationMode;
  // 'directional' only. Radians added AFTER the base "sprite-up faces velocity"
  // angle. Use Math.PI for sprites whose visual "tip" is at the bottom (carrot
  // root, dart point) so the tip leads instead of the leafy tail.
  readonly rotationOffsetRad?: number;
  // 'spin' only. Radians/second (positive = clockwise on screen).
  readonly spinRadPerSec?: number;
}

// Per-tower base spec — what fires when NO upgrades have been purchased.
// strawScarecrow is instant-hit (no traveling sprite); bananaGrove and
// gnomeAlchemist never fire. Deliberately absent from this map — the
// `INSTANT_HIT_KINDS` set below governs the strawScarecrow beam path.
const PROJECTILE_BASE: Partial<Record<TowerId, ProjectileSpec>> = {
  // Carrot as dart — tip (root, natural bottom) leads.
  sproutSlinger:  { key: 'sprite/plant/BabyCarrot', overlays: [],           scale: 0.35, rotation: 'directional', rotationOffsetRad: Math.PI },
  // Bomb — slow tumble. Pumpkin plant sprite ships large; scale down so bomb
  // reads as roughly one tile wide against the balloons.
  witchsCauldron: { key: 'sprite/plant/Pumpkin',    overlays: ['Amberlit'], scale: 0.55, rotation: 'spin',        spinRadPerSec: 2.0 },
  // Snowball — faster tumble. Item sprites are already tile-sized natively.
  frostWizard:    { key: 'sprite/item/SnowBall',    overlays: [],           scale: 1.0,  rotation: 'spin',        spinRadPerSec: 4.0 },
  // Cactus as thrown projectile. Plant sprite is huge at 1.0; match dart size.
  marbleKnight:   { key: 'sprite/plant/Cactus',     overlays: [],           scale: 0.35, rotation: 'directional', rotationOffsetRad: 0 },
  // Owl Perch: reuses Sprout's baby-carrot dart as a placeholder — Layer 3
  // ships no unique owl projectile (spec §10, no new sprite art).
  owlPerch:       { key: 'sprite/plant/BabyCarrot', overlays: [],           scale: 0.35, rotation: 'directional', rotationOffsetRad: Math.PI },
  // Molten ember — generated radial gradient (spec §7). 96px canvas at scale 1
  // ≈ 0.375 tile against WORLD_PX_PER_TILE 256.
  fairyForge:     { key: 'generated:ember', generated: 'ember', overlays: [], scale: 1.0, rotation: 'none' },
};

// Towers whose "shot" is an instant beam rather than a traveling projectile.
// effects.ts reads this via `isInstantHitTower` to decide beam vs. sprite.
const INSTANT_HIT_KINDS: ReadonlySet<TowerId> = new Set<TowerId>(['strawScarecrow']);

// Resolves the final ProjectileSpec for a tower at its current upgrade state.
// Path A base-sprite / rotation identity wins over Path B when both paths
// propose a sprite swap; overlays layer additively (deduped) so a path-A
// base + path-B overlay reads as a hybrid. Multi-shot upgrades (Twin Vines,
// Twin Thorns) don't affect the per-projectile spec — the engine now spawns
// two Projectile records with angular spread and each renders independently.
function resolveProjectileSpec(
  kind: TowerId,
  upA: UpgradeTier,
  upB: UpgradeTier,
): ProjectileSpec | null {
  const base = PROJECTILE_BASE[kind];
  if (!base) return null;

  let key = base.key;
  let generated = base.generated;
  let scale = base.scale;
  let rotation = base.rotation;
  let rotationOffsetRad = base.rotationOffsetRad;
  let spinRadPerSec = base.spinRadPerSec;
  const overlays = new Set<string>(base.overlays);

  switch (kind) {
    case 'sproutSlinger':
      // Path A: Twin Vines (T1) → engine-side multi-shot, no sprite change;
      // Rainbow Volley (T2) → Ambershine sparkle (Rainbow itself is held back
      // for the endgame T3A); Pumpkin Slinger (T3) → base swap + Rainbow.
      // T4A Rainbow Overlord → keep Pumpkin+Rainbow, add Gold for endgame.
      if (upA >= 2) overlays.add('Ambershine');
      if (upA >= 3) { key = 'sprite/plant/Pumpkin'; scale = 0.55; overlays.add('Rainbow'); }
      if (upA >= 4) overlays.add('Gold');
      // Path B: Long Reach (T1) → no visual; Sharp Sprouts (T2) → Ambershine
      // pierce accent; Sunflower Sniper (T3) → base swap + Gold (endgame).
      // T4B Solar Ascendant → add Rainbow on top of Gold sunflower.
      if (upA >= 2 || upB >= 2) overlays.add('Ambershine');
      if (upB >= 3 && upB > upA) { key = 'sprite/plant/Sunflower'; scale = 0.5; overlays.add('Gold'); overlays.delete('Rainbow'); }
      if (upB >= 4 && upB > upA) overlays.add('Rainbow');
      break;

    case 'marbleKnight':
      // Path A: Twin Thorns (T1) → engine-side multi-shot, no sprite change;
      // Storm of Thorns (T2) → Thunderstruck; Cactus Rain (T3) → +Wet.
      // T4A Verdant Colossus → add Rainbow to the storm.
      if (upA >= 2) overlays.add('Thunderstruck');
      if (upA >= 3) overlays.add('Wet');
      if (upA >= 4) overlays.add('Rainbow');
      // Path B: Heavy Thorns (T1) → none; Armor Pierce (T2) → Ambershine;
      // Marble Charge (T3) → Gold (endgame ignores-armor identity). Gold
      // supersedes lower-tier accents on B; A-side thunder/wet stays.
      // T4B Adamant Lance → Gold + Rainbow.
      if (upB >= 2) overlays.add('Ambershine');
      if (upB >= 3) { overlays.add('Gold'); overlays.delete('Ambershine'); }
      if (upB >= 4) overlays.add('Rainbow');
      break;

    case 'frostWizard':
      // Path A: Faster Frost (T1) → none; Blizzard (T2) → Chilled aura.
      // Absolute Zero (T3) → swap to the MutationFrozen crystal shard
      // (same key the T3A/T4A preset scenes use) at 1.6× so the projectile
      // reads as a real ice bolt instead of a tiny white snowball. T4A
      // Eternal Winter → 2.0× + Thunderstruck + Rainbow (matches the
      // ThunderchargedGround + ThunderCelestialPlatform in the T4A scene).
      // Dominance guard: A owns the base swap only when A ≥ B — otherwise
      // path B's Glacial Lance identity wins (directional throw below).
      if (upA >= 2) overlays.add('Chilled');
      if (upA >= 3 && upA >= upB) {
        overlays.delete('Chilled');
        overlays.add('Frozen');
        key = 'sprite/ui/MutationFrozen';
        scale = 1.6;
      }
      if (upA >= 4 && upA >= upB) {
        scale = 2.0;
        overlays.add('Thunderstruck');
        overlays.add('Rainbow');
      }
      // Path B: Ice Shards (T1) → small "shard" scale, but only while the
      // base sprite is still the little snowball; once T3 swaps to the
      // crystal we want it big, not scaled back down.
      // Deep Freeze (T2) → Chilled; Glacial Lance (T3) → crystal thrown
      // point-first (directional rotation) at 1.6×; T4B Frozen Heart →
      // 2.0× + Rainbow.
      if (upB >= 1 && upA < 3 && upB < 3) scale = base.scale * 0.9;
      if (upB >= 2) overlays.add('Chilled');
      if (upB >= 3 && upB > upA) {
        overlays.delete('Chilled');
        overlays.add('Frozen');
        key = 'sprite/ui/MutationFrozen';
        scale = 1.6;
        rotation = 'directional';
        rotationOffsetRad = 0;
        spinRadPerSec = undefined;
      }
      if (upB >= 4 && upB > upA) {
        scale = 2.0;
        overlays.add('Rainbow');
      }
      break;

    case 'witchsCauldron':
      // Path A: Bigger Bombs (T1) → none; Heavier Brew (T2) → swap
      // Amberlit→Ambercharged (a hotter brew reads as heavier amber);
      // Amber Fury (T3) → Ambercharged + Thunderstruck.
      // T4A Doomsday Brew → add Rainbow for the black-hole endgame.
      if (upA >= 2) { overlays.delete('Amberlit'); overlays.add('Ambercharged'); }
      if (upA >= 3) overlays.add('Thunderstruck');
      if (upA >= 4) overlays.add('Rainbow');
      // Path B: Fast Boil / Extended Cauldron / Rapid Cauldron are all
      // fire-rate/range tunings with no per-projectile visual change.
      // T4B Witches' Coven → Rainbow tint on rotating bombs.
      if (upB >= 4) overlays.add('Rainbow');
      break;

    case 'owlPerch':
      // Path A is detection/aura — no projectile change; the aura visual
      // belongs on the coverage ring, out of scope for this pass.
      // Path B: Quicker Talons / Barn Owl → no visual; Eagle Talons (T3)
      // → Gold (endgame talon strike). T4B Phoenix Owl → Gold + Rainbow.
      if (upB >= 3) overlays.add('Gold');
      if (upB >= 4) overlays.add('Rainbow');
      break;

    case 'fairyForge':
      // Path B T3 White-Hot / T4 Star-Forge → white-core slag ball, larger.
      // Path A T2+ projectiles are invisible (speed 40, flame-lick effect
      // draws the shot instead) — handled by returning null below.
      if (upA >= 2) return null;
      if (upB >= 3) { generated = 'emberWhite'; scale = 1.15; }
      break;

    default:
      // Kinds outside PROJECTILE_BASE (strawScarecrow, bananaGrove,
      // gnomeAlchemist) never reach here because `base` is null above.
      break;
  }

  return {
    key,
    overlays: [...overlays],
    scale,
    rotation,
    ...(generated !== undefined ? { generated } : {}),
    ...(rotationOffsetRad !== undefined ? { rotationOffsetRad } : {}),
    ...(spinRadPerSec !== undefined ? { spinRadPerSec } : {}),
  };
}

interface ProjectileRecord {
  sprite: SpriteNode;
  lastPixel: Point;
  splashRadius: number;
  spec: ProjectileSpec;
  spawnedAtMs: number;
  baseAngleRad?: number;
  isPathDrop?: boolean;
  // pathDrop-only: per-pile scale wobble baked once on spawn (rotation goes
  // straight onto sprite). lastPierce/lastAlpha short-circuit redundant writes.
  wobbleScale?: number;
  lastPierce?: number;
  lastAlpha?: number;
  positioned?: boolean;
}

// Tint by owner upgrade tier — piles inherit the tower's visual identity.
// Perma-Spikes (A4) wins gold priority over any B tier because it marks
// permanent piles; else the highest B tier chooses.
function pathDropTintFor(upA: UpgradeTier, upB: UpgradeTier): number {
  if (upA >= 4) return 0xffcc44;
  if (upB >= 4) return 0xc088ff;
  if (upB >= 3) return 0xff9966;
  if (upB >= 2) return 0xd8d8d8;
  return 0xffffff;
}

// Individual pile scale — sized down so a stack of 5+ on one tile reads as a
// spread of nails, not one chunky blob. Wobble (±15%) and pierce-shrink
// (1.0 → 0.6) still multiply on top of this.
const PATH_DROP_SPEC: ProjectileSpec = {
  key: 'sprite/seed/Pinecone',
  overlays: [],
  scale: 0.5,
  rotation: 'none',
};

function buildPathDropSprite(): BuiltSprite | null {
  const tex = getSharedTexture(PATH_DROP_SPEC.key, () => renderBySpriteKey(PATH_DROP_SPEC.key, []));
  if (!tex) return null;
  const sprite = createSprite(tex.texture, PATH_DROP_SPEC.scale);
  if (!sprite) return null;
  return { sprite, spec: PATH_DROP_SPEC };
}

interface RenderState {
  rafId: number | null;
  sprites: Map<string, ProjectileRecord>;
  unsubscribeStage: (() => void) | null;
}

let state: RenderState | null = null;

function createSprite(texture: unknown, scale: number): SpriteNode | null {
  const SpriteCtor = getStageSpriteCtor();
  if (!SpriteCtor) return null;
  let sprite: SpriteNode;
  try {
    sprite = new SpriteCtor(texture) as SpriteNode;
  } catch (err) {
    log.warn('QPM-TD-PROJ-002', { reason: 'sprite_ctor_failed' }, err);
    return null;
  }
  sprite.anchor?.set?.(0.5, 0.5);
  sprite.scale?.set?.(scale, scale);
  return sprite;
}

interface BuiltSprite {
  sprite: SpriteNode;
  spec: ProjectileSpec;
}

const generatedCache = new Map<GeneratedSpriteKind, HTMLCanvasElement>();

function getGeneratedCanvas(kind: GeneratedSpriteKind): HTMLCanvasElement | null {
  const hit = generatedCache.get(kind);
  if (hit) return hit;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (kind === 'ember') {
    g.addColorStop(0, '#fff6d0');
    g.addColorStop(0.35, '#ffa02a');
    g.addColorStop(1, 'rgba(255,90,20,0)');
  } else {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#ffe08a');
    g.addColorStop(1, 'rgba(255,140,40,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  generatedCache.set(kind, canvas);
  return canvas;
}

function buildProjectileSprite(kind: TowerId, upA: UpgradeTier, upB: UpgradeTier): BuiltSprite | null {
  const spec = resolveProjectileSpec(kind, upA, upB);
  if (!spec) return null;
  const cacheKey = spec.generated !== undefined
    ? `proj:gen:${spec.generated}`
    : (spec.overlays.length > 0
        ? `${spec.key}|${[...spec.overlays].sort().join(',')}`
        : spec.key);
  const tex = getSharedTexture(cacheKey, () => spec.generated !== undefined
    ? getGeneratedCanvas(spec.generated)
    : renderBySpriteKey(spec.key, [...spec.overlays]));
  if (!tex) return null;
  const sprite = createSprite(tex.texture, spec.scale);
  if (!sprite) return null;
  return { sprite, spec };
}

// True for towers that fire without a traveling projectile sprite (currently
// just strawScarecrow). effects.ts uses this to draw an instant beam instead.
export function isInstantHitTower(kind: TowerId): boolean {
  return INSTANT_HIT_KINDS.has(kind);
}

interface OwnerInfo {
  readonly kind: TowerId;
  readonly upA: UpgradeTier;
  readonly upB: UpgradeTier;
}

function findOwnerInfo(ownerId: string): OwnerInfo | null {
  const snap = getMatchSnapshot();
  const tower = snap.towers.find((t) => t.id === ownerId);
  if (!tower) return null;
  return { kind: tower.kind, upA: tower.upgradesA, upB: tower.upgradesB };
}

// Base "sprite-up faces velocity" angle. Sprites are drawn upright (top toward
// canvas-top, which is screen-up = -y). PIXI rotation 0 leaves them upright;
// positive rotation is clockwise. To face velocity (vx, vy), we need to rotate
// so that -y direction lands on the velocity vector — that's atan2(vy, vx) + π/2.
function directionalAngle(vx: number, vy: number, offsetRad: number): number {
  return Math.atan2(vy, vx) + Math.PI / 2 + offsetRad;
}

function applyRotation(rec: ProjectileRecord, vx: number, vy: number, nowMs: number): void {
  const spec = rec.spec;
  if (spec.rotation === 'directional') {
    if (vx === 0 && vy === 0) return;
    rec.sprite.rotation = directionalAngle(vx, vy, spec.rotationOffsetRad ?? 0);
  } else if (spec.rotation === 'spin') {
    // Anchor spin to the initial shot direction so cauldron bombs, snowballs
    // etc. tumble away from the tower instead of always starting upright.
    if (rec.baseAngleRad === undefined && (vx !== 0 || vy !== 0)) {
      rec.baseAngleRad = directionalAngle(vx, vy, spec.rotationOffsetRad ?? 0);
    }
    const base = rec.baseAngleRad ?? 0;
    const rate = spec.spinRadPerSec ?? 0;
    rec.sprite.rotation = base + (rate * (nowMs - rec.spawnedAtMs)) / 1000;
  }
}

function tickFrame(): void {
  const s = state;
  if (!s) return;
  const container = getStageContainer() as ContainerNode | null;
  if (!container) return;
  const snap = getMatchSnapshot();
  const nowMs = performance.now();

  const seen = new Set<string>();
  for (const p of snap.projectiles) {
    seen.add(p.id);
    // p.position is plot-tile-space (seeded from tower.pixel, integer-tile
    // engine space). Convert to world pixels — passing raw tile values into
    // sprite.position places projectiles at world-pixel (x, y), effectively
    // at the map's top-left corner and invisible.
    const worldPixel = tileToPixel(p.position);
    let rec = s.sprites.get(p.id);
    if (!rec) {
      const info = p.isPathDrop ? findOwnerInfo(p.ownerId) : null;
      const built = p.isPathDrop
        ? buildPathDropSprite()
        : (() => {
            const info2 = findOwnerInfo(p.ownerId);
            return info2 ? buildProjectileSprite(info2.kind, info2.upA, info2.upB) : null;
          })();
      if (!built) continue;
      built.sprite.zIndex = p.isPathDrop ? TD_Z_PATH_DROP : TD_Z_PROJECTILE;
      container.addChild?.(built.sprite);
      rec = {
        sprite: built.sprite,
        lastPixel: worldPixel,
        splashRadius: p.splashRadius,
        spec: built.spec,
        spawnedAtMs: nowMs,
        ...(p.isPathDrop ? { isPathDrop: true } : {}),
      };
      if (p.isPathDrop) {
        // Bake per-pile visual variety once so a stack reads as many cones.
        rec.wobbleScale = 0.85 + Math.random() * 0.3;
        built.sprite.rotation = Math.random() * Math.PI * 2;
        if (info && built.sprite.tint !== undefined) {
          built.sprite.tint = pathDropTintFor(info.upA, info.upB);
        }
        built.sprite.position?.set?.(worldPixel.x, worldPixel.y);
        rec.positioned = true;
      }
      s.sprites.set(p.id, rec);
    }
    if (p.isPathDrop) {
      const initial = p.initialPierce > 0 ? p.initialPierce : 1;
      const shrink = 0.6 + 0.4 * Math.max(0, Math.min(1, p.pierceRemaining / initial));
      if (rec.lastPierce !== p.pierceRemaining) {
        const s2 = rec.spec.scale * shrink * (rec.wobbleScale ?? 1);
        rec.sprite.scale?.set?.(s2, s2);
        rec.lastPierce = p.pierceRemaining;
      }
      const remainingMs = p.maxLifetimeMs - p.aliveMs;
      const alpha = remainingMs >= 500 ? 1 : Math.max(0, remainingMs / 500);
      if (rec.lastAlpha !== alpha) {
        rec.sprite.alpha = alpha;
        rec.lastAlpha = alpha;
      }
      continue;
    }
    applyRotation(rec, p.velocity.x, p.velocity.y, nowMs);
    rec.sprite.position?.set?.(worldPixel.x, worldPixel.y);
    rec.lastPixel = worldPixel;
  }

  for (const [id, rec] of s.sprites) {
    if (seen.has(id)) continue;
    // Best-effort: expired projectiles (lifetime elapsed without hit) also
    // trigger the explosion visual. Acceptable — visually reads as a fizzle.
    // pathDrop piles fade out via alpha in tickFrame and never fizzle-explode.
    if (rec.splashRadius > 0 && !rec.isPathDrop) {
      spawnExplosionEffect(rec.lastPixel, rec.splashRadius);
    }
    try {
      container.removeChild?.(rec.sprite);
      rec.sprite.destroy?.({ children: false, texture: false });
    } catch { /* ignore */ }
    s.sprites.delete(id);
  }
}

function frame(): void {
  const s = state;
  if (!s) return;
  const t0 = performance.now();
  try {
    tickFrame();
  } catch (err) {
    log.warn('QPM-TD-PROJ-003', { reason: 'frame_threw' }, err);
  }
  recordRenderTick(performance.now() - t0);
  s.rafId = requestAnimationFrame(frame);
}

export function initProjectileRender(): void {
  if (state) return;
  state = {
    rafId: null,
    sprites: new Map(),
    unsubscribeStage: null,
  };
  state.unsubscribeStage = onStageContainerRecreated(() => {
    const s = state;
    if (!s) return;
    for (const rec of s.sprites.values()) {
      try { rec.sprite.destroy?.({ children: false, texture: false }); } catch { /* ignore */ }
    }
    s.sprites.clear();
  });
  state.rafId = requestAnimationFrame(frame);
}

export function stopProjectileRender(): void {
  const s = state;
  if (!s) return;
  state = null;
  s.unsubscribeStage?.();
  if (s.rafId !== null) {
    try { cancelAnimationFrame(s.rafId); } catch { /* ignore */ }
  }
  const container = getStageContainer() as ContainerNode | null;
  if (container) {
    for (const rec of s.sprites.values()) {
      try {
        container.removeChild?.(rec.sprite);
        rec.sprite.destroy?.({ children: false, texture: false });
      } catch { /* ignore */ }
    }
  }
  s.sprites.clear();
}
