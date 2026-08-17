import type { Balloon, BalloonId, BalloonModifier, DamageType, StatusEffectState, Tower } from '../types';
import { getBalloonDef } from '../data/balloonDefs';
import { getPathLength, positionAt } from './path';
import { getMatchSnapshot, setBalloons, setLives } from '../state';
import { REGEN_DELAY_MS, REGEN_HP_PER_SEC } from '../constants';
import { earn } from './economy';
import { getEffectiveStats } from './tower';

let balloonCounter = 0;

export interface SpawnOpts {
  readonly distance?: number;
  readonly modifiers?: readonly BalloonModifier[];
}

// Step-based endless HP scaling, BTD6-freeplay-shaped: predictable "wall"
// moments the player can plan around. Prescripted 1-20 unchanged; endless
// starts biting at R21 so there's no grace period. Steps: R21-30 ×1.25,
// R31-40 ×1.5, R41-50 ×2, R51-60 ×3, then +1× per 10 rounds thereafter.
function endlessHpMult(round: number): number {
  if (round <= 20) return 1;
  if (round <= 30) return 1.25;
  if (round <= 40) return 1.5;
  if (round <= 50) return 2;
  return Math.floor((round - 51) / 10) + 3;
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
    baseSpeed: def.speed,
    armorDR: def.armorDR ?? 0,
    statuses: [],
    immunities: def.immunities,
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
  const existing = b.statuses.find((s) => s.kind === status.kind);
  if (existing) {
    existing.remainingMs = Math.max(existing.remainingMs, status.remainingMs);
    return;
  }
  b.statuses.push(status);
}

export function getWiltMultiplier(b: Balloon): number {
  let bonus = 0;
  for (const s of b.statuses) {
    if (s.kind === 'wilt' && s.dmgTakenBonus) bonus += s.dmgTakenBonus;
  }
  return bonus;
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
  const armorApplies = type === 'standard' && b.armorDR > 0 && !ctx.ignoresArmor;
  const effectiveDmg = armorApplies
    ? Math.max(1, Math.ceil(scaledDmg * (1 - b.armorDR)))
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
function kindRbe(kind: BalloonId): number {
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

export function shouldSuppressRegenFor(
  b: Balloon,
  towers: readonly Tower[],
): boolean {
  if (!b.modifiers.includes('camo')) return false;
  const pos = positionAt(b.distance);
  for (const t of towers) {
    const s = getEffectiveStats(t);
    if (!s.suppressCamoRegen) continue;
    const range = s.range;
    const dx = pos.x - t.pixel.x;
    const dy = pos.y - t.pixel.y;
    if (dx * dx + dy * dy <= range * range) return true;
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

  for (const b of snap.balloons) {
    if (b.stunRemainingMs !== undefined && b.stunRemainingMs > 0) {
      b.stunRemainingMs = Math.max(0, b.stunRemainingMs - deltaMs);
    }
    let dotDamage = 0;
    if (b.statuses.length > 0) {
      for (let i = b.statuses.length - 1; i >= 0; i--) {
        const s = b.statuses[i];
        if (!s) continue;
        if (s.dotPerSec && s.dotPerSec > 0) dotDamage += s.dotPerSec * (deltaMs / 1000);
        s.remainingMs -= deltaMs;
        if (s.remainingMs <= 0) b.statuses.splice(i, 1);
      }
    }
    if (dotDamage > 0 && !b.immunities.includes('standard')) {
      b.hp -= dotDamage;
      b.msSinceDamage = 0;
      if (b.hp <= 0) {
        const def = getBalloonDef(b.kind);
        earn(def.popReward);
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
      !shouldSuppressRegenFor(b, snap.towers)
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
