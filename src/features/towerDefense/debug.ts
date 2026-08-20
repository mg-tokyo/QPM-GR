import type { BalloonId, BalloonModifier, Phase, Point, StatusEffect, TowerId, UpgradePath } from './types';
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
import { logEndlessProfile, profileEndlessRounds, projectPopIncome, type EndlessRoundProfile } from './debug/endlessProfile';
import { deleteSave as storeDeleteSave, getActiveSlot, getAutosave, listSlots, saveRunToSlot } from './saves/store';
import type { SaveEntry, SaveSlotRef } from './saves/types';
import { canSwitchTrack, switchTrack, type SwitchTrackResult } from './tracks/active';
import { getActiveTrack } from './engine/path';
import { getTrackDifficulty, getTrackDisplayName, getTrackLength, listTracks } from './tracks/registry';

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

interface SaveSummary {
  readonly round: number;
  readonly isEndless: boolean;
  readonly cash: number;
  readonly lives: number;
  readonly towers: number;
  readonly savedAt: number;
  readonly trackId: string;
}

export interface TdDebugHooks {
  readonly loadSave: (ref: SaveSlotRef) => void;
}

function summarize(e: SaveEntry | null): SaveSummary | null {
  if (!e) return null;
  return {
    round: e.snapshot.round,
    isEndless: e.snapshot.isEndless,
    cash: e.snapshot.cash,
    lives: e.snapshot.lives,
    towers: e.snapshot.towers.length,
    savedAt: e.savedAt,
    trackId: e.trackId,
  };
}

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
  listBalloons(): ReadonlyArray<{ id: string; kind: BalloonId; hp: number; maxHp: number; distance: number; armorDR: number; modifiers: readonly BalloonModifier[]; statusImmune: boolean; statuses: readonly StatusEffect[]; stunRemainingMs: number; pos: Point }>;
  clearBalloons(): void;
  isPerfOverlayEnabled(): boolean;
  togglePerfOverlay(enable?: boolean): boolean;
  // Layer 8 §T1 — static endless-generator analysis (spawn window / RBE·s / pop income).
  profileEndlessRounds(from: number, to: number): readonly EndlessRoundProfile[];
  logEndlessProfile(from?: number, to?: number): void;
  projectPopIncome(round: number): number;
  // Save system — see docs/superpowers/plans/2026-08-19-td-save-system.md.
  listSaves(): { auto: SaveSummary | null; slots: ReadonlyArray<SaveSummary | null>; active: SaveSlotRef | null };
  saveToSlot(index: number): boolean;
  loadSave(ref: SaveSlotRef): void;
  deleteSave(ref: SaveSlotRef): void;
  // Tracks — see docs/superpowers/plans/2026-08-19-td-tracks-p1-builtins-selector.md.
  tracks: {
    list(): ReadonlyArray<{ id: string; name: string; builtIn: boolean; lengthTiles: number; difficulty: string }>;
    active(): { id: string; name: string; lengthTiles: number; canSwitch: boolean };
    set(id: string): Promise<SwitchTrackResult>;
  };
}

let installed = false;

export function initTdDebugBridge(hooks: TdDebugHooks): void {
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
        statusImmune: b.statusImmune,
        statuses: b.statuses.map((s) => s.kind),
        stunRemainingMs: b.stunRemainingMs ?? 0,
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
    profileEndlessRounds(from, to) {
      return profileEndlessRounds(from, to);
    },
    logEndlessProfile(from, to) {
      logEndlessProfile(from, to);
    },
    projectPopIncome(round) {
      return projectPopIncome(round);
    },
    listSaves() {
      return {
        auto: summarize(getAutosave()),
        slots: listSlots().map(summarize),
        active: getActiveSlot(),
      };
    },
    saveToSlot(index) {
      return saveRunToSlot(index, getMatchSnapshot()) !== null;
    },
    loadSave(ref) {
      hooks.loadSave(ref);
    },
    deleteSave(ref) {
      storeDeleteSave(ref);
    },
    tracks: {
      list() {
        return listTracks().map((tr) => ({
          id: tr.id,
          name: getTrackDisplayName(tr),
          builtIn: tr.builtIn,
          lengthTiles: getTrackLength(tr),
          difficulty: getTrackDifficulty(tr),
        }));
      },
      active() {
        const tr = getActiveTrack();
        return { id: tr.id, name: getTrackDisplayName(tr), lengthTiles: getTrackLength(tr), canSwitch: canSwitchTrack() };
      },
      set(id) {
        return switchTrack(id);
      },
    },
  };
  shareGlobal('__QPM_TD_DEBUG__', bridge);
}
