import type { Balloon, BalloonId, BalloonModifier, DamageType, StatusEffectState } from '../types';
import { BOSS_KINDS, getBalloonDef } from '../data/balloonDefs';
import { getPathLength, positionAt } from './path';
import { getMatchSnapshot, setBalloons, setLives } from '../state';
import { REGEN_DELAY_MS, REGEN_HP_PER_SEC } from '../constants';
import { earnPopReward } from './economy';
import { getEffectiveStats } from './tower';

let balloonCounter = 0;

export interface SpawnOpts {
  readonly distance?: number;
  readonly modifiers?: readonly BalloonModifier[];
}

// Smooth-with-floor endless HP per docs/superpowers/plans/2026-08-18-tower-defense-endless-threat-layer-7.md §1.1.
// Base 1.05 solved backwards from "R61 must be ~2× current 4×" → 8 = k^41 → k ≈ 1.052.
// steppedFloor keeps R21-R25 pinned at 1.25× so no round regresses vs Layer 5.
export function endlessHpMult(round: number): number {
  if (round <= 20) return 1;
  return Math.max(steppedFloor(round), Math.pow(1.05, round - 20));
}
function steppedFloor(round: number): number {
  if (round <= 30) return 1.25;
  if (round <= 40) return 1.5;
  if (round <= 50) return 2;
  return Math.floor((round - 51) / 10) + 3;
}

// Layer 8 §D.3 — BTD6-style speed ramping: +0.8%/cycle, capped 2.0× (R145).
// Raises HP/s pressure with zero extra bodies and shortens rounds.
export function endlessSpeedMult(round: number): number {
  if (round <= 20) return 1;
  return Math.min(2.0, 1 + (round - 20) * 0.008);
}

export function spawnBalloon(kind: BalloonId, opts: SpawnOpts = {}): Balloon {
  const def = getBalloonDef(kind);
  const round = getMatchSnapshot().round;
  const scaledHp = Math.max(1, Math.round(def.hp * endlessHpMult(round)));
  return {
    id: `b_${balloonCounter++}`,
    kind,
    distance: opts.distance ?? 0,
    hp: scaledHp,
    maxHp: scaledHp,
    baseSpeed: def.speed * endlessSpeedMult(round),
    armorDR: def.armorDR ?? 0,
    statuses: [],
    immunities: def.immunities,
    statusImmune: def.statusImmune === true,
    modifiers: opts.modifiers ?? [],
    msSinceDamage: 0,
  };
}

export function getCurrentSpeed(b: Balloon): number {
  if (b.stunRemainingMs !== undefined && b.stunRemainingMs > 0) return 0;
  let mult = 1;
  for (const s of b.statuses) mult *= s.speedMultiplier;
  return b.baseSpeed * mult;
}

export function applyStatus(b: Balloon, status: StatusEffectState): void {
  // Single choke point for every status write (frost/forge/lantern/pull) —
  // Rainbow elites never receive chill, burn, static, wilt, sticky or pull.
  if (b.statusImmune) return;
  const existing = b.statuses.find((s) => s.kind === status.kind);
  if (existing) {
    // Refresh keeps the STRONGEST values, so a T4 forge's burn upgrades a T1
    // forge's burn on the same balloon instead of waiting for it to expire.
    existing.remainingMs = Math.max(existing.remainingMs, status.remainingMs);
    if (status.dotPerSec !== undefined && status.dotPerSec > (existing.dotPerSec ?? 0)) existing.dotPerSec = status.dotPerSec;
    if (status.dmgTakenBonus !== undefined && status.dmgTakenBonus > (existing.dmgTakenBonus ?? 0)) existing.dmgTakenBonus = status.dmgTakenBonus;
    if (status.armorStrip !== undefined && status.armorStrip > (existing.armorStrip ?? 0)) existing.armorStrip = status.armorStrip;
    if (status.dotBossMult !== undefined && status.dotBossMult > (existing.dotBossMult ?? 1)) existing.dotBossMult = status.dotBossMult;
    return;
  }
  b.statuses.push(status);
}

// Sum of dmgTakenBonus across ALL active statuses (Wilt, Static, T4 Burn…).
export function getStatusDmgTakenBonus(b: Balloon): number {
  let bonus = 0;
  for (const s of b.statuses) {
    if (s.dmgTakenBonus) bonus += s.dmgTakenBonus;
  }
  return bonus;
}

// Strongest armor strip among active statuses, clamped to [0, 1].
export function getStatusArmorStrip(b: Balloon): number {
  let strip = 0;
  for (const s of b.statuses) {
    if (s.armorStrip && s.armorStrip > strip) strip = s.armorStrip;
  }
  return Math.min(1, strip);
}

export interface DamageResult {
  readonly popped: boolean;
  readonly damageDealt: number;
  readonly children: readonly Balloon[];
}

export interface DamageContext {
  readonly ignoresArmor?: boolean;
  readonly damageMultiplier?: number;
}

export function applyDamageToBalloon(
  b: Balloon,
  dmg: number,
  type: DamageType,
  ctx: DamageContext = {},
): DamageResult {
  if (b.immunities.includes(type)) {
    return { popped: false, damageDealt: 0, children: [] };
  }
  const mult = ctx.damageMultiplier ?? 1;
  const scaledDmg = dmg * mult;
  // Armor only reduces standard damage; explosive and cold ignore it per spec §4.2.
  // ctx.ignoresArmor lets Marble Charge (T3B) bypass armor DR entirely.
  const effectiveDR = b.armorDR * (1 - getStatusArmorStrip(b));
  const armorApplies = type === 'standard' && effectiveDR > 0 && !ctx.ignoresArmor;
  const effectiveDmg = armorApplies
    ? Math.max(1, Math.ceil(scaledDmg * (1 - effectiveDR)))
    : scaledDmg;
  const damageDealt = Math.min(effectiveDmg, b.hp);
  if (damageDealt > 0) b.msSinceDamage = 0;
  b.hp -= effectiveDmg;
  if (b.hp > 0) {
    return { popped: false, damageDealt, children: [] };
  }
  const def = getBalloonDef(b.kind);
  // Children inherit parent modifiers so camo/regen persist through pops (spec §4.2).
  const children: Balloon[] = def.children.map((kind) =>
    spawnBalloon(kind, { distance: b.distance, modifiers: b.modifiers }),
  );
  return { popped: true, damageDealt, children };
}

// Full intact RBE (red-balloon-equivalents) per kind: HP + sum of children RBE
// recursively. Cached because balloon defs are static.
const kindRbeCache = new Map<BalloonId, number>();
export function kindRbe(kind: BalloonId): number {
  const hit = kindRbeCache.get(kind);
  if (hit !== undefined) return hit;
  const def = getBalloonDef(kind);
  let total = def.hp;
  for (const child of def.children) total += kindRbe(child);
  kindRbeCache.set(kind, total);
  return total;
}

// A leak deals remaining HP of the leaking balloon plus the FULL RBE of every
// child it would have spawned — BTD6 semantics. A partially-popped balloon
// leaks less than an intact one.
export function computeLeakDamage(b: Balloon): number {
  const def = getBalloonDef(b.kind);
  let total = Math.max(0, b.hp);
  for (const child of def.children) total += kindRbe(child);
  return total;
}

export interface RegenSuppressor { readonly x: number; readonly y: number; readonly rangeSq: number }

export function shouldSuppressRegenFor(
  b: Balloon,
  suppressors: readonly RegenSuppressor[],
): boolean {
  if (!b.modifiers.includes('camo')) return false;
  if (suppressors.length === 0) return false;
  const pos = positionAt(b.distance);
  for (const s of suppressors) {
    const dx = pos.x - s.x;
    const dy = pos.y - s.y;
    if (dx * dx + dy * dy <= s.rangeSq) return true;
  }
  return false;
}

export interface AdvanceResult {
  readonly livesLost: number;
}

export function advanceBalloons(deltaMs: number): AdvanceResult {
  const snap = getMatchSnapshot();
  const survivors: Balloon[] = [];
  const length = getPathLength();
  let livesLost = 0;
  const suppressors: RegenSuppressor[] = [];
  for (const t of snap.towers) {
    const s = getEffectiveStats(t);
    if (!s.suppressCamoRegen) continue;
    suppressors.push({ x: t.pixel.x, y: t.pixel.y, rangeSq: s.range * s.range });
  }

  for (const b of snap.balloons) {
    if (b.stunRemainingMs !== undefined && b.stunRemainingMs > 0) {
      b.stunRemainingMs = Math.max(0, b.stunRemainingMs - deltaMs);
    }
    let dotDamage = 0;
    if (b.statuses.length > 0) {
      const isBoss = BOSS_KINDS.includes(b.kind);
      for (let i = b.statuses.length - 1; i >= 0; i--) {
        const s = b.statuses[i];
        if (!s) continue;
        if (s.dotPerSec && s.dotPerSec > 0) {
          const mult = isBoss && s.dotBossMult ? s.dotBossMult : 1;
          dotDamage += s.dotPerSec * mult * (deltaMs / 1000);
        }
        s.remainingMs -= deltaMs;
        if (s.remainingMs <= 0) b.statuses.splice(i, 1);
      }
    }
    if (dotDamage > 0 && !b.immunities.includes('standard')) {
      b.hp -= dotDamage;
      b.msSinceDamage = 0;
      if (b.hp <= 0) {
        const def = getBalloonDef(b.kind);
        earnPopReward(def.popReward);
        for (const kind of def.children) {
          survivors.push(spawnBalloon(kind, { distance: b.distance, modifiers: b.modifiers }));
        }
        continue;
      }
    } else {
      b.msSinceDamage += deltaMs;
    }
    if (
      b.modifiers.includes('regen') &&
      b.msSinceDamage >= REGEN_DELAY_MS &&
      b.hp < b.maxHp &&
      !shouldSuppressRegenFor(b, suppressors)
    ) {
      const healPerMs = REGEN_HP_PER_SEC / 1000;
      b.hp = Math.min(b.maxHp, b.hp + healPerMs * deltaMs);
    }
    b.distance += getCurrentSpeed(b) * (deltaMs / 1000);
    if (b.distance < 0) b.distance = 0;
    if (b.distance >= length) {
      livesLost += computeLeakDamage(b);
      continue;
    }
    survivors.push(b);
  }

  if (livesLost > 0) setLives(Math.max(0, snap.lives - livesLost));
  setBalloons(survivors);
  return { livesLost };
}
