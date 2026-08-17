import type { BalloonId, BalloonModifier, Phase, Point, TowerId, UpgradePath } from './types';
import { spawnBalloon } from './engine/balloon';
import { getMatchSnapshot, notify, setBalloons, setCash as stateSetCash, setPhase as stateSetPhase } from './state';
import { setForceCamoDetectAll, isForceCamoDetectAll } from './engine/detection';
import {
  beginPlacement,
  buyUpgrade as engineBuyUpgrade,
  cancelPlacement,
  confirmPlacement,
  getEffectiveStats,
  getUpgradeCost,
  isPathLocked,
  sellTower as engineSellTower,
  updatePlacementTile,
} from './engine/tower';
import { getTowerDef } from './data/towerDefs';
import { positionAt } from './engine/path';
import { shareGlobal } from '../../core/pageContext';
import { isPerfOverlayEnabled, togglePerfOverlay } from './debug/perfOverlay';

interface TowerInspection {
  readonly id: string;
  readonly kind: TowerId;
  readonly tile: Point;
  readonly range: number;
  readonly damage: number;
  readonly fireIntervalMs: number;
  readonly upgradesA: number;
  readonly upgradesB: number;
}

interface OwlCoverage {
  readonly towerId: string;
  readonly range: number;
  readonly tileCentre: Point;
  readonly coversBalloonIds: readonly string[];
}

interface GnomeAuraInfo {
  readonly gnomeId: string;
  readonly tile: Point;
  readonly buffedTowerIds: readonly string[];
}

type PlaceResult = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: string };

interface TdDebugBridge {
  injectBalloon(
    kind: BalloonId,
    opts?: { modifiers?: readonly BalloonModifier[]; distance?: number },
  ): string;
  setCamoDetectAll(on: boolean): void;
  snapshot(): {
    balloons: number;
    withCamo: number;
    withRegen: number;
    armored: number;
    detectionOverride: boolean;
  };
  listTowers(): readonly TowerInspection[];
  getOwlCoverage(): readonly OwlCoverage[];
  getGnomeAura(): readonly GnomeAuraInfo[];
  // T13 verification primitives — see plan Task 13. Bypass player input.
  placeTower(kind: TowerId, tile: Point): PlaceResult;
  buyUpgrade(id: string, path: UpgradePath): boolean;
  sellTower(id: string): void;
  setCash(cash: number): void;
  setPhase(phase: Phase): void;
  isPathLocked(id: string, path: UpgradePath): boolean | null;
  getUpgradeCost(id: string, path: UpgradePath): number | null;
  matchSnapshot(): { phase: Phase; round: number; cash: number; lives: number; towerCount: number; balloonCount: number; projectileCount: number };
  listBalloons(): ReadonlyArray<{ id: string; kind: BalloonId; hp: number; maxHp: number; distance: number; armorDR: number; modifiers: readonly BalloonModifier[]; pos: Point }>;
  clearBalloons(): void;
  isPerfOverlayEnabled(): boolean;
  togglePerfOverlay(enable?: boolean): boolean;
}

let installed = false;

export function initTdDebugBridge(): void {
  if (installed) return;
  installed = true;
  const bridge: TdDebugBridge = {
    injectBalloon(kind, opts) {
      // exactOptionalPropertyTypes: build opts without undefined-valued keys.
      const spawnOpts: { distance?: number; modifiers?: readonly BalloonModifier[] } = {};
      if (opts?.distance !== undefined) spawnOpts.distance = opts.distance;
      if (opts?.modifiers !== undefined) spawnOpts.modifiers = opts.modifiers;
      const b = spawnBalloon(kind, spawnOpts);
      const snap = getMatchSnapshot();
      setBalloons([...snap.balloons, b]);
      notify();
      return b.id;
    },
    setCamoDetectAll(on) {
      setForceCamoDetectAll(on);
    },
    snapshot() {
      const snap = getMatchSnapshot();
      let withCamo = 0;
      let withRegen = 0;
      let armored = 0;
      for (const b of snap.balloons) {
        if (b.modifiers.includes('camo')) withCamo++;
        if (b.modifiers.includes('regen')) withRegen++;
        if (b.armorDR > 0) armored++;
      }
      return {
        balloons: snap.balloons.length,
        withCamo,
        withRegen,
        armored,
        detectionOverride: isForceCamoDetectAll(),
      };
    },
    listTowers() {
      const snap = getMatchSnapshot();
      const out: TowerInspection[] = [];
      for (const t of snap.towers) {
        const s = getEffectiveStats(t);
        out.push({
          id: t.id,
          kind: t.kind,
          tile: t.tile,
          range: s.range,
          damage: s.damage,
          fireIntervalMs: s.fireIntervalMs,
          upgradesA: t.upgradesA,
          upgradesB: t.upgradesB,
        });
      }
      return out;
    },
    getOwlCoverage() {
      const snap = getMatchSnapshot();
      const out: OwlCoverage[] = [];
      for (const t of snap.towers) {
        if (t.kind !== 'owlPerch') continue;
        const range = getEffectiveStats(t).range;
        const covers: string[] = [];
        for (const b of snap.balloons) {
          if (!b.modifiers.includes('camo')) continue;
          const pos = positionAt(b.distance);
          const dx = pos.x - t.pixel.x;
          const dy = pos.y - t.pixel.y;
          if (dx * dx + dy * dy <= range * range) covers.push(b.id);
        }
        out.push({ towerId: t.id, range, tileCentre: t.pixel, coversBalloonIds: covers });
      }
      return out;
    },
    getGnomeAura() {
      const snap = getMatchSnapshot();
      const out: GnomeAuraInfo[] = [];
      for (const g of snap.towers) {
        if (g.kind !== 'gnomeAlchemist') continue;
        const aura = getTowerDef(g.kind).baseStats.range;
        const buffed: string[] = [];
        for (const t of snap.towers) {
          if (t.kind === 'gnomeAlchemist') continue;
          if (t.id === g.id) continue;
          const dx = t.pixel.x - g.pixel.x;
          const dy = t.pixel.y - g.pixel.y;
          if (dx * dx + dy * dy <= aura * aura) buffed.push(t.id);
        }
        out.push({ gnomeId: g.id, tile: g.tile, buffedTowerIds: buffed });
      }
      return out;
    },
    placeTower(kind, tile) {
      // Bypass player-input: begin, hover on the target tile, commit.
      // updatePlacementTile validates & sets isValid; confirmPlacement charges cost.
      beginPlacement(kind);
      updatePlacementTile(tile);
      const before = getMatchSnapshot().towers;
      const res = confirmPlacement();
      if (!res.ok) {
        cancelPlacement();
        return { ok: false, reason: res.reason };
      }
      const after = getMatchSnapshot().towers;
      const added = after.find((t) => !before.some((b) => b.id === t.id));
      return added ? { ok: true, id: added.id } : { ok: false, reason: 'not_found' };
    },
    buyUpgrade(id, path) {
      return engineBuyUpgrade(id, path);
    },
    sellTower(id) {
      engineSellTower(id);
    },
    setCash(cash) {
      stateSetCash(cash);
    },
    setPhase(phase) {
      stateSetPhase(phase);
    },
    isPathLocked(id, path) {
      const t = getMatchSnapshot().towers.find((x) => x.id === id);
      if (!t) return null;
      return isPathLocked(t, path);
    },
    getUpgradeCost(id, path) {
      const t = getMatchSnapshot().towers.find((x) => x.id === id);
      if (!t) return null;
      return getUpgradeCost(t, path);
    },
    matchSnapshot() {
      const s = getMatchSnapshot();
      return {
        phase: s.phase,
        round: s.round,
        cash: s.cash,
        lives: s.lives,
        towerCount: s.towers.length,
        balloonCount: s.balloons.length,
        projectileCount: s.projectiles.length,
      };
    },
    listBalloons() {
      return getMatchSnapshot().balloons.map((b) => ({
        id: b.id,
        kind: b.kind,
        hp: b.hp,
        maxHp: b.maxHp,
        distance: b.distance,
        armorDR: b.armorDR,
        modifiers: b.modifiers,
        pos: positionAt(b.distance),
      }));
    },
    clearBalloons() {
      setBalloons([]);
      notify();
    },
    isPerfOverlayEnabled() {
      return isPerfOverlayEnabled();
    },
    togglePerfOverlay(enable) {
      const host = document.querySelector('.qpm-td-root');
      return togglePerfOverlay(host instanceof HTMLElement ? host : null, enable);
    },
  };
  shareGlobal('__QPM_TD_DEBUG__', bridge);
}
