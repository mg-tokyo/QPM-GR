import type {
  Balloon,
  DamageType,
  PendingPlacement,
  Point,
  Projectile,
  TargetPriority,
  Tower,
  TowerId,
  UpgradePath,
} from '../types';
import { PLOT_COLS, PLOT_ROWS, CHILLED_DURATION_MS, CHILLED_SPEED_MULTIPLIER } from '../constants';
import {
  getMatchSnapshot,
  notify,
  setPendingPlacement,
  setSelectedTower,
  setTowers,
  setTargetPriority as stateSetTargetPriority,
} from '../state';
import { refund, spend } from './economy';
import { isOnPath, positionAt } from './path';
import { isBalloonDetected, type OwlCoverageEntry } from './detection';
import type { TowerStats } from '../data/towerDefs';
import { getTowerDef } from '../data/towerDefs';
import { tdPlay } from '../sounds';

export interface TowerShotInfo {
  readonly towerId: string;
  readonly kind: TowerId;
  // Tile-space positions; render code converts via tileToPixel.
  readonly from: Point;
  readonly to: Point;
}

const shotListeners = new Set<(info: TowerShotInfo) => void>();

export function onTowerShot(cb: (info: TowerShotInfo) => void): () => void {
  shotListeners.add(cb);
  return () => shotListeners.delete(cb);
}

function emitTowerShot(info: TowerShotInfo): void {
  for (const cb of shotListeners) {
    try { cb(info); } catch { /* listener errors never break the tick */ }
  }
}

let towerCounter = 0;
let projectileCounter = 0;

function tileToPixel(tile: Point): Point {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

// Tower sprites are anchored (0.5, 1.0) — tower.pixel is at the sprite's feet.
// Lift the muzzle half a tile so projectiles + shot effects emerge from the
// tower's mid-body rather than the ground line.
const TOWER_MUZZLE_Y_OFFSET = -0.5;
function towerMuzzle(t: Tower): Point {
  return { x: t.pixel.x, y: t.pixel.y + TOWER_MUZZLE_Y_OFFSET };
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function getEffectiveStats(t: Tower): TowerStats {
  const def = getTowerDef(t.kind);
  let stats: TowerStats = def.baseStats;
  for (let i = 0; i < t.upgradesA; i++) {
    const u = def.pathA[i];
    if (u) stats = u.apply(stats);
  }
  for (let i = 0; i < t.upgradesB; i++) {
    const u = def.pathB[i];
    if (u) stats = u.apply(stats);
  }
  // Gnome Alchemist aura: per-tier bonuses per addendum §3.3 (was §6.2.8).
  // Fire-rate cap applied AFTER the fold, not per-tier, so Village Elder's
  // +3% stack cannot push a single Alchemist past 25% and multi-Alchemist
  // overlap also caps at 25% total. Range and pierce stack additively.
  // T4A Master Alchemist raises the cap to 40% and grants a double-shot chance
  // to towers in aura; T4B Cosmic Sage bypasses the range check but scales
  // contributions by globalAuraScale (60%).
  if (t.kind !== 'gnomeAlchemist') {
    let fireRateBonus = 0;
    let rangeBonus = 0;
    let pierceBonus = 0;
    let damageBonus = 0;
    let doubleShotBonus = 0;
    let capMax = 0.25;
    const towers = getMatchSnapshot().towers;
    for (const g of towers) {
      if (g.kind !== 'gnomeAlchemist') continue;
      if (g.id === t.id) continue;
      const gDef = getTowerDef(g.kind);
      let gEffective: TowerStats = gDef.baseStats;
      for (let i = 0; i < g.upgradesB; i++) {
        const u = gDef.pathB[i];
        if (u) gEffective = u.apply(gEffective);
      }
      const aura = gEffective.range;
      const isGlobal = gEffective.globalAura === true;
      if (!isGlobal) {
        const dx = t.pixel.x - g.pixel.x;
        const dy = t.pixel.y - g.pixel.y;
        if (dx * dx + dy * dy > aura * aura) continue;
      }
      const scale = isGlobal ? (gEffective.globalAuraScale ?? 1) : 1;
      let fr = 0, rn = 0, pi = 0, dm = 0;
      switch (g.upgradesA) {
        case 0: fr = 0.10; rn = 0.05; break;
        case 1: fr = 0.15; rn = 0.08; break;
        case 2: fr = 0.20; rn = 0.12; pi = 1; break;
        case 3: fr = 0.25; rn = 0.20; pi = 2; dm = 1; break;
        case 4: fr = 0.40; rn = 0.30; pi = 3; dm = 3; break;
      }
      fireRateBonus += fr * scale;
      rangeBonus += rn * scale;
      pierceBonus += Math.floor(pi * scale);
      damageBonus += Math.floor(dm * scale);
      if (g.upgradesB >= 2) fireRateBonus += 0.03 * scale;
      if (gEffective.fireRateCapOverride && gEffective.fireRateCapOverride > capMax) {
        capMax = gEffective.fireRateCapOverride;
      }
      if (gEffective.adjacencyDoubleShotChance) {
        doubleShotBonus += gEffective.adjacencyDoubleShotChance * scale;
      }
    }
    fireRateBonus = Math.min(capMax, fireRateBonus);
    if (fireRateBonus > 0 || rangeBonus > 0 || pierceBonus > 0 || damageBonus > 0 || doubleShotBonus > 0) {
      stats = {
        ...stats,
        fireIntervalMs: stats.fireIntervalMs / (1 + fireRateBonus),
        range: stats.range * (1 + rangeBonus),
        pierce: stats.pierce + pierceBonus,
        damage: stats.damage + damageBonus,
      };
      if (doubleShotBonus > 0) {
        stats = { ...stats, doubleFireChance: (stats.doubleFireChance ?? 0) + doubleShotBonus };
      }
    }
  }
  // Grove-B adjacency fold: 8-direction Moore neighbours per spec §6.1.
  // Grove upgrades are inlined here (not via getEffectiveStats(g)) because
  // Grove's own effective stats do not cascade — recursion would be pointless
  // and could risk infinite loops in future Grove-buff-Groves designs.
  if (t.kind !== 'bananaGrove') {
    let groveDamageBonus = 0;
    let groveRangeBonus = 0;
    let groveFireRateBonus = 0;
    for (const g of getMatchSnapshot().towers) {
      if (g.kind !== 'bananaGrove') continue;
      if (g.id === t.id) continue;
      const dx = Math.abs(g.tile.x - t.tile.x);
      const dy = Math.abs(g.tile.y - t.tile.y);
      if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) continue;
      const gDef = getTowerDef(g.kind);
      let gEffective: TowerStats = gDef.baseStats;
      for (let i = 0; i < g.upgradesA; i++) {
        const u = gDef.pathA[i];
        if (u) gEffective = u.apply(gEffective);
      }
      for (let i = 0; i < g.upgradesB; i++) {
        const u = gDef.pathB[i];
        if (u) gEffective = u.apply(gEffective);
      }
      if (gEffective.adjacencyDamageBonus) groveDamageBonus += gEffective.adjacencyDamageBonus;
      if (gEffective.adjacencyRangeBonus) groveRangeBonus += gEffective.adjacencyRangeBonus;
      if (gEffective.adjacencyFireRateBonus) groveFireRateBonus += gEffective.adjacencyFireRateBonus;
    }
    if (groveDamageBonus > 0 || groveRangeBonus > 0 || groveFireRateBonus > 0) {
      stats = {
        ...stats,
        damage: stats.damage * (1 + groveDamageBonus),
        range: stats.range * (1 + groveRangeBonus),
        fireIntervalMs: groveFireRateBonus > 0 ? stats.fireIntervalMs / (1 + groveFireRateBonus) : stats.fireIntervalMs,
      };
    }
  }
  return stats;
}

// Spec §6.1: once T3 lands on either path, the other path is CAPPED AT T2
// (not locked entirely) — T1/T2 on the capped path remain buyable, only the
// next-would-be-T3 purchase is blocked. Selling refunds and resets the lock.
export function isPathLocked(t: Tower, path: UpgradePath): boolean {
  const thisPathTier = path === 'a' ? t.upgradesA : t.upgradesB;
  const otherPathTier = path === 'a' ? t.upgradesB : t.upgradesA;
  return otherPathTier >= 3 && thisPathTier >= 2;
}

export function getUpgradeCost(t: Tower, path: UpgradePath): number | null {
  const def = getTowerDef(t.kind);
  const tier = path === 'a' ? t.upgradesA : t.upgradesB;
  const list = path === 'a' ? def.pathA : def.pathB;
  const next = list[tier];
  if (!next) return null;
  if (tier >= 2 && isPathLocked(t, path)) return null;
  return next.cost;
}

export function buyUpgrade(towerId: string, path: UpgradePath): boolean {
  const snap = getMatchSnapshot();
  const idx = snap.towers.findIndex((t) => t.id === towerId);
  if (idx < 0) return false;
  const existing = snap.towers[idx];
  if (!existing) return false;

  if (isPathLocked(existing, path)) return false;

  const cost = getUpgradeCost(existing, path);
  if (cost === null) return false;
  if (!spend(cost)) return false;

  const nextA = path === 'a' ? Math.min(4, existing.upgradesA + 1) : existing.upgradesA;
  const nextB = path === 'b' ? Math.min(4, existing.upgradesB + 1) : existing.upgradesB;
  const updated: Tower = {
    ...existing,
    upgradesA: nextA as Tower['upgradesA'],
    upgradesB: nextB as Tower['upgradesB'],
    totalSpent: existing.totalSpent + cost,
  };
  const next = snap.towers.slice();
  next[idx] = updated;
  setTowers(next);
  notify();
  return true;
}

// User-triggered mutations must notify() so UI catches up outside the tick
// loop — the loop's own notify only fires when phase === 'inRound'.
export function beginPlacement(kind: TowerId): void {
  const placement: PendingPlacement = { kind, hoverTile: null, isValid: false };
  setPendingPlacement(placement);
  // Clear any current selection so its range circle doesn't overlap the ghost preview.
  setSelectedTower(null);
  notify();
}

function isTileWithinPlot(tile: Point): boolean {
  return (
    Number.isInteger(tile.x) &&
    Number.isInteger(tile.y) &&
    tile.x >= 0 &&
    tile.x < PLOT_COLS &&
    tile.y >= 0 &&
    tile.y < PLOT_ROWS
  );
}

function isTileFree(tile: Point, towers: readonly Tower[]): boolean {
  for (const t of towers) {
    if (t.tile.x === tile.x && t.tile.y === tile.y) return false;
  }
  return true;
}

// Called by playerInput as the player's tile changes (null when off-plot).
// Updates PendingPlacement.hoverTile + isValid so towerRender can preview.
export function updatePlacementTile(tile: Point | null): void {
  const snap = getMatchSnapshot();
  const pending = snap.pendingPlacement;
  if (!pending) return;
  if (tile === null) {
    if (pending.hoverTile === null && !pending.isValid) return;
    setPendingPlacement({ kind: pending.kind, hoverTile: null, isValid: false });
    notify();
    return;
  }
  const inBounds = isTileWithinPlot(tile);
  const free = inBounds && isTileFree(tile, snap.towers);
  const offPath = inBounds && !isOnPath(tile, 0.5);
  const isValid = inBounds && free && offPath;
  const prev = pending.hoverTile;
  if (prev && prev.x === tile.x && prev.y === tile.y && pending.isValid === isValid) return;
  setPendingPlacement({ kind: pending.kind, hoverTile: tile, isValid });
  notify();
}

export type PlacementResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unaffordable' | 'invalid_tile' | 'no_placement' };

export function confirmPlacement(): PlacementResult {
  const snap = getMatchSnapshot();
  const p = snap.pendingPlacement;
  if (!p) return { ok: false, reason: 'no_placement' };
  if (!p.hoverTile || !p.isValid) return { ok: false, reason: 'invalid_tile' };

  const def = getTowerDef(p.kind);
  if (snap.cash < def.baseCost) return { ok: false, reason: 'unaffordable' };
  if (!spend(def.baseCost)) return { ok: false, reason: 'unaffordable' };

  const tile = p.hoverTile;
  const tower: Tower = {
    id: `t_${towerCounter++}`,
    kind: p.kind,
    tile,
    pixel: tileToPixel(tile),
    fireCooldownMs: 0,
    targetPriority: 'first',
    upgradesA: 0,
    upgradesB: 0,
    totalSpent: def.baseCost,
  };
  setTowers([...snap.towers, tower]);
  setPendingPlacement(null);
  tdPlay('towerPlace');
  notify();
  return { ok: true };
}

export function cancelPlacement(): void {
  setPendingPlacement(null);
  notify();
}

export function selectTower(id: string | null): void {
  setSelectedTower(id);
  notify();
}

export function sellTower(id: string): void {
  const snap = getMatchSnapshot();
  const target = snap.towers.find((t) => t.id === id);
  if (!target) return;
  refund(target.totalSpent);
  setTowers(snap.towers.filter((t) => t.id !== id));
  if (snap.selectedTowerId === id) setSelectedTower(null);
  tdPlay('towerSell');
  notify();
}

export function setTargetPriority(id: string, p: TargetPriority): void {
  stateSetTargetPriority(id, p);
  notify();
}

const stickyTargetIds = new Map<string, string>();

export function pickTarget(
  tower: Tower,
  stats: TowerStats,
  balloons: readonly Balloon[],
): Balloon | null {
  if (stats.range <= 0 || balloons.length === 0) return null;

  const inRange: Balloon[] = [];
  const towers = getMatchSnapshot().towers;
  // Owl coverage uses effective range so Sharp Eyes / Night Hunter widen it.
  const owlCoverage: OwlCoverageEntry[] = [];
  for (const t of towers) {
    if (t.kind !== 'owlPerch') continue;
    owlCoverage.push({ tower: t, range: getEffectiveStats(t).range });
  }
  for (const b of balloons) {
    const pos = positionAt(b.distance);
    if (distanceBetween(pos, tower.pixel) > stats.range) continue;
    if (
      b.modifiers.includes('camo') &&
      !stats.selfDetectsCamo &&
      !isBalloonDetected(b, owlCoverage)
    ) continue;
    inRange.push(b);
  }
  if (inRange.length === 0) {
    stickyTargetIds.delete(tower.id);
    return null;
  }

  const priority = tower.targetPriority;
  if (priority === 'lastTrack') {
    const stickyId = stickyTargetIds.get(tower.id);
    if (stickyId) {
      const stillHere = inRange.find((b) => b.id === stickyId);
      if (stillHere) return stillHere;
    }
    const pick = inRange.reduce((min, b) => (b.distance < min.distance ? b : min), inRange[0] as Balloon);
    stickyTargetIds.set(tower.id, pick.id);
    return pick;
  }

  switch (priority) {
    case 'first':
      return inRange.reduce((max, b) => (b.distance > max.distance ? b : max), inRange[0] as Balloon);
    case 'last':
      return inRange.reduce((min, b) => (b.distance < min.distance ? b : min), inRange[0] as Balloon);
    case 'strong':
      return inRange.reduce((max, b) => (b.hp > max.hp ? b : max), inRange[0] as Balloon);
    case 'close':
      return inRange.reduce((best, b) => {
        const bPos = positionAt(b.distance);
        const bDist = distanceBetween(bPos, tower.pixel);
        const bestPos = positionAt(best.distance);
        const bestDist = distanceBetween(bestPos, tower.pixel);
        return bDist < bestDist ? b : best;
      }, inRange[0] as Balloon);
    default:
      return inRange[0] ?? null;
  }
}

interface MakeProjectileOverride {
  readonly angleOffsetRad?: number;
  readonly damageOverride?: number;
  readonly splashOverride?: number;
  readonly pierceOverride?: number;
  readonly damageTypeOverride?: DamageType;
}

function makeProjectile(
  tower: Tower,
  stats: TowerStats,
  target: Balloon,
  opts: MakeProjectileOverride = {},
): Projectile {
  const targetPos = positionAt(target.distance);
  const muzzle = towerMuzzle(tower);
  const dx = targetPos.x - muzzle.x;
  const dy = targetPos.y - muzzle.y;
  const baseAngle = Math.atan2(dy, dx);
  const angle = baseAngle + (opts.angleOffsetRad ?? 0);
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const base: Projectile = {
    id: `p_${projectileCounter++}`,
    ownerId: tower.id,
    damageType: opts.damageTypeOverride ?? stats.damageType,
    damage: opts.damageOverride ?? stats.damage,
    position: { x: muzzle.x, y: muzzle.y },
    velocity: { x: nx * stats.projectileSpeed, y: ny * stats.projectileSpeed },
    pierceRemaining: opts.pierceOverride ?? stats.pierce,
    hitBalloonIds: new Set<string>(),
    aliveMs: 0,
    maxLifetimeMs: 4000,
    splashRadius: opts.splashOverride ?? stats.splashRadius,
    ignoresArmor: stats.ignoresArmor ?? false,
    bossDamageBonus: stats.bossDamageBonus ?? 0,
    chilledDamageBonus: stats.chilledDamageBonus ?? 0,
    armorBonusMult: stats.armorBonusMult ?? 0,
    chillDurationBonus: stats.chillDurationBonus ?? 0,
    chillSpeedMultiplier: stats.chillOverride?.speedMultiplier ?? CHILLED_SPEED_MULTIPLIER,
    chillDurationMs: stats.chillOverride?.durationMs ?? CHILLED_DURATION_MS,
    ...(stats.shattersFrozen ? { shattersFrozen: true } : {}),
    ...(stats.bossStunMs !== undefined ? { bossStunMs: stats.bossStunMs } : {}),
    ...(stats.pullOnImpactChance !== undefined ? { pullOnImpactChance: stats.pullOnImpactChance } : {}),
    ...(stats.pullRadius !== undefined ? { pullRadius: stats.pullRadius } : {}),
    ...(stats.pullDurationMs !== undefined ? { pullDurationMs: stats.pullDurationMs } : {}),
    ...(stats.statusDurationMs !== undefined ? { statusDurationMs: stats.statusDurationMs } : {}),
    ...(stats.statusDoTPerSec !== undefined ? { statusDoTPerSec: stats.statusDoTPerSec } : {}),
    ...(stats.wiltDamageBonus !== undefined ? { statusDmgTakenBonus: stats.wiltDamageBonus } : {}),
    ...(stats.stickySpeedMultiplier !== undefined ? { statusSpeedMultiplier: stats.stickySpeedMultiplier } : {}),
  };
  if (stats.appliesStatus !== undefined) {
    return { ...base, appliesStatus: stats.appliesStatus };
  }
  return base;
}

export function tickTowers(deltaMs: number): readonly Projectile[] {
  const snap = getMatchSnapshot();
  const spawned: Projectile[] = [];

  for (const t of snap.towers) {
    const stats = getEffectiveStats(t);
    if (!Number.isFinite(stats.fireIntervalMs)) continue;
    t.fireCooldownMs -= deltaMs;
    if (t.fireCooldownMs > 0) continue;
    const target = pickTarget(t, stats, snap.balloons);
    if (!target) {
      t.fireCooldownMs = 0;
      continue;
    }
    const bombs = Math.max(1, Math.floor(stats.bombsPerShot ?? 1));
    const count = Math.max(1, Math.floor(stats.projectilesPerShot ?? 1));
    const spreadRad = stats.projectileSpreadRad ?? 0;
    // Rotating elements (Cauldron T4B) — cycle damageType per fire event.
    let damageTypeOverride: DamageType | undefined;
    if (stats.rotatingElements && stats.rotatingElements.length > 0) {
      const idx = (t.nextElementIdx ?? 0) % stats.rotatingElements.length;
      damageTypeOverride = stats.rotatingElements[idx];
      t.nextElementIdx = (t.nextElementIdx ?? 0) + 1;
    }
    const projOpts = damageTypeOverride !== undefined ? { damageTypeOverride } : {};
    for (let bomb = 0; bomb < bombs; bomb++) {
      for (let i = 0; i < count; i++) {
        const offset = count > 1 ? (i - (count - 1) / 2) * spreadRad : 0;
        spawned.push(makeProjectile(t, stats, target, { ...projOpts, angleOffsetRad: offset }));
      }
    }
    // Double-fire proc (Straw B T3 Full-Auto). Second burst mirrors the outer
    // bombs × count fan; one emitTowerShot per tick, matching Cauldron multi-bomb.
    if (stats.doubleFireChance && Math.random() < stats.doubleFireChance) {
      for (let bomb = 0; bomb < bombs; bomb++) {
        for (let i = 0; i < count; i++) {
          const offset = count > 1 ? (i - (count - 1) / 2) * spreadRad : 0;
          spawned.push(makeProjectile(t, stats, target, { ...projOpts, angleOffsetRad: offset }));
        }
      }
    }
    // Proc-nuke (T4 Sprout A / Marble A / Straw B): every Nth shot, spawn an
    // oversized projectile with its own damage/splash/pierce overrides.
    if (stats.procEveryNthShot && stats.procEveryNthShot > 0) {
      t.shotCounter = (t.shotCounter ?? 0) + 1;
      if (t.shotCounter % stats.procEveryNthShot === 0) {
        const nukeOpts: MakeProjectileOverride = {
          ...(stats.procNukeDamage !== undefined ? { damageOverride: stats.procNukeDamage } : {}),
          ...(stats.procNukeSplash !== undefined ? { splashOverride: stats.procNukeSplash } : {}),
          ...(stats.procNukePierce !== undefined ? { pierceOverride: stats.procNukePierce } : {}),
        };
        spawned.push(makeProjectile(t, stats, target, nukeOpts));
      }
    }
    emitTowerShot({
      towerId: t.id,
      kind: t.kind,
      from: towerMuzzle(t),
      to: positionAt(target.distance),
    });
    t.fireCooldownMs = stats.fireIntervalMs;
  }

  return spawned;
}

export function resetTowerEngine(seedFromTowers: readonly Tower[] = []): void {
  stickyTargetIds.clear();
  projectileCounter = 0;
  // Seed above the highest saved `t_<n>` id so post-resume placements can't
  // collide with restored towers — collision would make find-by-id in the
  // upgrade panel resolve to the loaded tower on the wrong tile.
  let maxIdx = -1;
  for (const t of seedFromTowers) {
    if (!t.id.startsWith('t_')) continue;
    const n = Number.parseInt(t.id.slice(2), 10);
    if (Number.isFinite(n) && n > maxIdx) maxIdx = n;
  }
  towerCounter = maxIdx + 1;
}
