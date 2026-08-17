import type { Balloon, Point, Projectile, StatusEffect, Tower } from '../types';
import { applyDamageToBalloon, applyStatus, getWiltMultiplier, type DamageContext } from './balloon';
import { getMatchSnapshot, setBalloons, setProjectiles } from '../state';
import { earn } from './economy';
import { getBalloonDef, BOSS_KINDS } from '../data/balloonDefs';
import { positionAt } from './path';
import { getEffectiveStats } from './tower';
import { tdPlay } from '../sounds';

const STATUS_DEFAULT_DURATION_MS: Record<StatusEffect, number> = {
  chilled: 2000,
  wilt: 3000,
  frostbite: 3000,
  burn: 3000,
  sticky: 2000,
  pulled: 500,
};

const STATUS_DEFAULT_SPEED_MULT: Record<StatusEffect, number> = {
  chilled: 0.5,
  wilt: 1,
  frostbite: 1,
  burn: 1,
  sticky: 0.5,
  pulled: -1.5,
};

// Balloons render at ~1-tile scale; 0.5-tile hitbox = full-sprite collision without overshoot.
// Provisional; may be tuned in T20 live verification.
const COLLISION_RADIUS = 0.5;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function spawnProjectile(p: Projectile): void {
  const snap = getMatchSnapshot();
  setProjectiles([...snap.projectiles, p]);
}

// Owl A T2/T3 grants an aura bonus to camo victims. Overlapping Owls with
// different tiers pick the strongest (max, not sum) per spec §6.2.5 — additive
// stacking of two +100%s would trivially one-shot bosses.
function computeCamoAuraBonus(victim: Balloon, towers: readonly Tower[]): number {
  if (!victim.modifiers.includes('camo')) return 0;
  const pos = positionAt(victim.distance);
  let best = 0;
  for (const t of towers) {
    const s = getEffectiveStats(t);
    if (!s.camoAuraDamageBonus || s.camoAuraDamageBonus <= 0) continue;
    const range = s.range;
    const dx = pos.x - t.pixel.x;
    const dy = pos.y - t.pixel.y;
    if (dx * dx + dy * dy <= range * range) {
      if (s.camoAuraDamageBonus > best) best = s.camoAuraDamageBonus;
    }
  }
  return best;
}

export function tickProjectiles(deltaMs: number): void {
  const snap = getMatchSnapshot();
  if (snap.projectiles.length === 0) return;

  const balloons: Balloon[] = snap.balloons.slice();
  const surviving: Projectile[] = [];
  const dtSec = deltaMs / 1000;

  for (const p of snap.projectiles) {
    p.position = {
      x: p.position.x + p.velocity.x * dtSec,
      y: p.position.y + p.velocity.y * dtSec,
    };
    p.aliveMs += deltaMs;

    if (p.aliveMs >= p.maxLifetimeMs || p.pierceRemaining <= 0) continue;

    let impact: Balloon | null = null;
    for (const b of balloons) {
      if (p.hitBalloonIds.has(b.id)) continue;
      if (distance(p.position, positionAt(b.distance)) <= COLLISION_RADIUS) {
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
      for (const b of balloons) {
        if (p.hitBalloonIds.has(b.id)) continue;
        if (distance(impactPos, positionAt(b.distance)) <= p.splashRadius) {
          victims.push(b);
        }
      }
    } else {
      victims.push(impact);
    }

    for (const victim of victims) {
      p.hitBalloonIds.add(victim.id);
      const chilled = victim.statuses.some((s) => s.kind === 'chilled');
      const isFrozen = chilled && victim.statuses.some((s) => s.kind === 'chilled' && s.speedMultiplier === 0);
      const isBoss = BOSS_KINDS.includes(victim.kind);
      const isArmored = victim.armorDR > 0;
      let damageMultiplier = 1;
      if (chilled && p.chilledDamageBonus > 0) damageMultiplier += p.chilledDamageBonus;
      if (isBoss && p.bossDamageBonus > 0) damageMultiplier += p.bossDamageBonus;
      if (isArmored && p.armorBonusMult > 0) damageMultiplier += p.armorBonusMult;
      const camoBonus = computeCamoAuraBonus(victim, snap.towers);
      if (camoBonus > 0) damageMultiplier += camoBonus;
      const wilt = getWiltMultiplier(victim);
      if (wilt > 0) damageMultiplier += wilt;
      if (p.shattersFrozen && isFrozen && !isBoss) damageMultiplier += 1;
      const ctx: DamageContext = {
        ignoresArmor: p.ignoresArmor,
        damageMultiplier,
      };
      const result = applyDamageToBalloon(victim, p.damage, p.damageType, ctx);
      if (result.damageDealt > 0 && p.appliesStatus !== undefined) {
        applyAppliedStatus(victim, p);
      }
      if (result.damageDealt > 0 && p.bossStunMs && isBoss) {
        victim.stunRemainingMs = Math.max(victim.stunRemainingMs ?? 0, p.bossStunMs);
      }
      if (result.popped) {
        earn(getBalloonDef(victim.kind).popReward);
        tdPlay('balloonPop');
        const idx = balloons.findIndex((x) => x.id === victim.id);
        if (idx >= 0) balloons.splice(idx, 1, ...result.children);
      }
    }
    // Black-hole pull (Cauldron T4A) — on any impact with a pull-capable
    // projectile, roll the chance and pull nearby balloons backwards for a
    // short duration via a negative-speed 'pulled' status.
    if (p.pullOnImpactChance && p.pullOnImpactChance > 0 && Math.random() < p.pullOnImpactChance) {
      const impactPos = positionAt(impact.distance);
      const radius = p.pullRadius ?? 1.5;
      const durationMs = p.pullDurationMs ?? 500;
      for (const b of balloons) {
        if (distance(impactPos, positionAt(b.distance)) > radius) continue;
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
  };
  applyStatus(victim, status);
}
