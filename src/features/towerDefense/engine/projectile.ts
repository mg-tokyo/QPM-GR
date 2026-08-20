import type { Balloon, Point, Projectile, StatusEffect } from '../types';
import { applyDamageToBalloon, applyStatus, getStatusDmgTakenBonus, type DamageContext } from './balloon';
import { getMatchSnapshot, setBalloons, setProjectiles } from '../state';
import { earnPopReward } from './economy';
import { getBalloonDef, BOSS_KINDS } from '../data/balloonDefs';
import { positionAt } from './path';
import { getEffectiveStats } from './tower';
import { tdPlay } from '../sounds';
import { isBalloonDetected, type OwlCoverageEntry } from './detection';

const STATUS_DEFAULT_DURATION_MS: Record<StatusEffect, number> = {
  chilled: 2000,
  wilt: 3000,
  frostbite: 3000,
  burn: 3000,
  sticky: 2000,
  pulled: 500,
  static: 2000,
};

const STATUS_DEFAULT_SPEED_MULT: Record<StatusEffect, number> = {
  chilled: 0.5,
  wilt: 1,
  frostbite: 1,
  burn: 1,
  sticky: 0.5,
  pulled: -1.5,
  static: 1,
};

// Balloons render at ~1-tile scale; 0.5-tile hitbox = full-sprite collision without overshoot.
// Provisional; may be tuned in T20 live verification.
const COLLISION_RADIUS = 0.5;
const COLLISION_RADIUS_SQ = COLLISION_RADIUS * COLLISION_RADIUS;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Squared-distance for range gates in hot loops — Math.hypot's sqrt+abs is
// the top sim-tick cost. Compare against a pre-squared threshold; ordering
// is monotonic so target picks (`close` priority, chain nearest) unchanged.
function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function spawnProjectile(p: Projectile): void {
  const snap = getMatchSnapshot();
  setProjectiles([...snap.projectiles, p]);
}

export interface TowerChainInfo {
  readonly ownerId: string;
  // Tile-space; points[0] is the first impact, each later point a hop target.
  readonly points: readonly Point[];
}

const chainListeners = new Set<(info: TowerChainInfo) => void>();

export function onChainResolved(cb: (info: TowerChainInfo) => void): () => void {
  chainListeners.add(cb);
  return () => chainListeners.delete(cb);
}

function emitChainResolved(info: TowerChainInfo): void {
  for (const cb of chainListeners) {
    try { cb(info); } catch { /* listener errors never break the tick */ }
  }
}

interface CamoAuraEntry { readonly x: number; readonly y: number; readonly rangeSq: number; readonly bonus: number }

// Owl A T2/T3 grants an aura bonus to camo victims. Overlapping Owls with
// different tiers pick the strongest (max, not sum) per spec §6.2.5 — additive
// stacking of two +100%s would trivially one-shot bosses.
function computeCamoAuraBonus(victim: Balloon, auras: readonly CamoAuraEntry[]): number {
  if (!victim.modifiers.includes('camo')) return 0;
  const pos = positionAt(victim.distance);
  let best = 0;
  for (const a of auras) {
    const dx = pos.x - a.x;
    const dy = pos.y - a.y;
    if (dx * dx + dy * dy <= a.rangeSq) {
      if (a.bonus > best) best = a.bonus;
    }
  }
  return best;
}

interface HitContext {
  readonly balloons: Balloon[];
  // Lazily built once per tickProjectiles — non-camo hits never touch the list.
  readonly getCamoAuras: () => readonly CamoAuraEntry[];
  // Children spawned by pops during this tick — never valid chain-hop targets,
  // otherwise one bolt would eat every layer of a single balloon.
  readonly spawnedThisTick: Set<string>;
}

// One projectile hit on one balloon: multipliers, damage, status, boss stun,
// pop bookkeeping. Shared by direct/splash victims and chain hops.
function hitVictim(p: Projectile, victim: Balloon, damage: number, ctx: HitContext): void {
  p.hitBalloonIds.add(victim.id);
  const chilled = victim.statuses.some((s) => s.kind === 'chilled');
  const isFrozen = chilled && victim.statuses.some((s) => s.kind === 'chilled' && s.speedMultiplier === 0);
  const isBoss = BOSS_KINDS.includes(victim.kind);
  const isArmored = victim.armorDR > 0;
  let damageMultiplier = 1;
  if (chilled && p.chilledDamageBonus > 0) damageMultiplier += p.chilledDamageBonus;
  if (isBoss && p.bossDamageBonus > 0) damageMultiplier += p.bossDamageBonus;
  if (isArmored && p.armorBonusMult > 0) damageMultiplier += p.armorBonusMult;
  const camoBonus = computeCamoAuraBonus(victim, ctx.getCamoAuras());
  if (camoBonus > 0) damageMultiplier += camoBonus;
  const statusBonus = getStatusDmgTakenBonus(victim);
  if (statusBonus > 0) damageMultiplier += statusBonus;
  if (p.shattersFrozen && isFrozen && !isBoss) damageMultiplier += 1;
  const dmgCtx: DamageContext = { ignoresArmor: p.ignoresArmor, damageMultiplier };
  const result = applyDamageToBalloon(victim, damage, p.damageType, dmgCtx);
  if (result.damageDealt > 0 && p.appliesStatus !== undefined) {
    applyAppliedStatus(victim, p);
  }
  if (result.damageDealt > 0 && p.bossStunMs && isBoss && !victim.statusImmune) {
    victim.stunRemainingMs = Math.max(victim.stunRemainingMs ?? 0, p.bossStunMs);
  }
  if (result.popped) {
    earnPopReward(getBalloonDef(victim.kind).popReward);
    tdPlay('balloonPop');
    const idx = ctx.balloons.findIndex((x) => x.id === victim.id);
    if (idx >= 0) ctx.balloons.splice(idx, 1, ...result.children);
    for (const c of result.children) ctx.spawnedThisTick.add(c.id);
  }
}

// Storm Lantern: after the first impact, hop to the nearest un-hit balloon
// within chainRange, up to chainCount times, damage × decay per hop.
function resolveChain(p: Projectile, first: Balloon, ctx: HitContext, owls: readonly OwlCoverageEntry[]): void {
  const hops = p.chainCount ?? 0;
  const hopRange = p.chainRange ?? 1.5;
  const hopRangeSq = hopRange * hopRange;
  const decay = p.chainDecay ?? 1;
  const points: Point[] = [positionAt(first.distance)];
  let last: Balloon = first;
  let hopDamage = p.damage;
  for (let hop = 0; hop < hops; hop++) {
    hopDamage *= decay;
    const from = positionAt(last.distance);
    let next: Balloon | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const b of ctx.balloons) {
      if (p.hitBalloonIds.has(b.id) || ctx.spawnedThisTick.has(b.id)) continue;
      if (b.modifiers.includes('camo') && !isBalloonDetected(b, owls)) continue;
      const d2 = dist2(from, positionAt(b.distance));
      if (d2 <= hopRangeSq && d2 < bestD2) { bestD2 = d2; next = b; }
    }
    if (!next) break;
    hitVictim(p, next, hopDamage, ctx);
    points.push(positionAt(next.distance));
    last = next;
  }
  if (points.length > 1) emitChainResolved({ ownerId: p.ownerId, points });
}

export function tickProjectiles(deltaMs: number): void {
  const snap = getMatchSnapshot();
  if (snap.projectiles.length === 0) return;

  const balloons: Balloon[] = snap.balloons.slice();
  const surviving: Projectile[] = [];
  const dtSec = deltaMs / 1000;
  // Owl coverage only matters for chain hops onto camo; build lazily once/tick.
  let owls: OwlCoverageEntry[] | null = null;
  const getOwls = (): OwlCoverageEntry[] => {
    if (!owls) {
      owls = [];
      for (const t of snap.towers) {
        if (t.kind === 'owlPerch') owls.push({ tower: t, range: getEffectiveStats(t).range });
      }
    }
    return owls;
  };
  // Camo aura only affects camo victims; skip the fold for the common case.
  let auras: CamoAuraEntry[] | null = null;
  const getCamoAuras = (): readonly CamoAuraEntry[] => {
    if (!auras) {
      auras = [];
      for (const t of snap.towers) {
        const s = getEffectiveStats(t);
        if (!s.camoAuraDamageBonus || s.camoAuraDamageBonus <= 0) continue;
        auras.push({ x: t.pixel.x, y: t.pixel.y, rangeSq: s.range * s.range, bonus: s.camoAuraDamageBonus });
      }
    }
    return auras;
  };
  const ctx: HitContext = { balloons, getCamoAuras, spawnedThisTick: new Set<string>() };

  for (const p of snap.projectiles) {
    // pathDrop piles are stationary — skip the allocation for zero velocity.
    if (p.velocity.x !== 0 || p.velocity.y !== 0) {
      p.position = {
        x: p.position.x + p.velocity.x * dtSec,
        y: p.position.y + p.velocity.y * dtSec,
      };
    }
    p.aliveMs += deltaMs;

    if (p.aliveMs >= p.maxLifetimeMs || p.pierceRemaining <= 0) continue;

    let impact: Balloon | null = null;
    for (const b of balloons) {
      if (p.hitBalloonIds.has(b.id)) continue;
      if (dist2(p.position, positionAt(b.distance)) <= COLLISION_RADIUS_SQ) {
        impact = b;
        break;
      }
    }

    if (!impact) {
      surviving.push(p);
      continue;
    }

    const victims: Balloon[] = [];
    if (p.splashRadius > 0) {
      const impactPos = positionAt(impact.distance);
      const splashRadiusSq = p.splashRadius * p.splashRadius;
      for (const b of balloons) {
        if (p.hitBalloonIds.has(b.id)) continue;
        if (dist2(impactPos, positionAt(b.distance)) <= splashRadiusSq) {
          victims.push(b);
        }
      }
    } else {
      victims.push(impact);
    }

    for (const victim of victims) hitVictim(p, victim, p.damage, ctx);
    if (p.splashRadius === 0 && p.chainCount !== undefined && p.chainCount > 0) {
      resolveChain(p, impact, ctx, getOwls());
    }
    // Black-hole pull (Cauldron T4A) — on any impact with a pull-capable
    // projectile, roll the chance and pull nearby balloons backwards for a
    // short duration via a negative-speed 'pulled' status.
    if (p.pullOnImpactChance && p.pullOnImpactChance > 0 && Math.random() < p.pullOnImpactChance) {
      const impactPos = positionAt(impact.distance);
      const radius = p.pullRadius ?? 1.5;
      const radiusSq = radius * radius;
      const durationMs = p.pullDurationMs ?? 500;
      for (const b of balloons) {
        if (dist2(impactPos, positionAt(b.distance)) > radiusSq) continue;
        applyStatus(b, {
          kind: 'pulled',
          remainingMs: durationMs,
          speedMultiplier: STATUS_DEFAULT_SPEED_MULT.pulled,
        });
      }
    }

    // Splash projectiles detonate on first impact (BTD-bomb semantics) —
    // they never pierce. Pierce only applies to single-target darts.
    // Consuming the projectile here also drives projectileRender.ts:117-121
    // to spawn the explosion visual, since that fires on disappearance.
    if (p.splashRadius > 0) continue;
    p.pierceRemaining--;
    if (p.pierceRemaining > 0) surviving.push(p);
  }

  setProjectiles(surviving);
  setBalloons(balloons);
}

function applyAppliedStatus(victim: Balloon, p: Projectile): void {
  const kind = p.appliesStatus;
  if (kind === undefined) return;
  if (kind === 'chilled') {
    const status: import('../types').StatusEffectState = {
      kind,
      remainingMs: p.chillDurationMs * (1 + p.chillDurationBonus),
      speedMultiplier: p.chillSpeedMultiplier,
      ...(p.statusDoTPerSec !== undefined ? { dotPerSec: p.statusDoTPerSec } : {}),
    };
    applyStatus(victim, status);
    return;
  }
  const remainingMs = p.statusDurationMs ?? STATUS_DEFAULT_DURATION_MS[kind];
  const speedMultiplier = p.statusSpeedMultiplier ?? STATUS_DEFAULT_SPEED_MULT[kind];
  const status: import('../types').StatusEffectState = {
    kind,
    remainingMs,
    speedMultiplier,
    ...(p.statusDoTPerSec !== undefined ? { dotPerSec: p.statusDoTPerSec } : {}),
    ...(p.statusDmgTakenBonus !== undefined ? { dmgTakenBonus: p.statusDmgTakenBonus } : {}),
    ...(p.statusArmorStrip !== undefined ? { armorStrip: p.statusArmorStrip } : {}),
    ...(p.statusDotBossMult !== undefined ? { dotBossMult: p.statusDotBossMult } : {}),
  };
  applyStatus(victim, status);
}
