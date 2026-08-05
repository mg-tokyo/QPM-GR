import type { Coord, EndReason, FleetLayout, MatchMode, MatchPhase, PlacedShip } from './types';
import {
  AI_THINK_MAX_MS,
  AI_THINK_MIN_MS,
  FLEET_SPECS,
} from './constants.ts';
import { canPlace, coordKey, isFleetSunk, randomFleet, resolveShot, shipCells } from './board.ts';
import { createAi, type BattleshipAi } from './ai.ts';
import {
  enterBattleStage,
  exitBattleStage,
  setOpponentStageAt,
  setMyFleet,
  markShotOnMyBoard,
  markShotOnOppBoard,
  pickFleetSpecies,
  isGardenStageActive,
  worldToBoard,
  type GridSide,
} from './gardenStage';
import { createPlacementPreview, type PreviewController, type PreviewSnapshot } from './placementPreview';
import { setPreviewCells, clearPreview } from './previewOverlay';
import { installSendGuard, removeSendGuard, getSendGuardStats } from '../../websocket/sendGuard';
import { readAtomValueSync } from '../../core/atomRegistry';
import { notify, notifyOncePerSession } from '../../core/notifications';
import { t } from '../../i18n';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { createNamedLogger } from '../../diagnostics/logger';
import { shareGlobal } from '../../core/pageContext';
import { selectSync } from '../../core/stateTree';
import { getPlayerIdSync } from '../../core/playerContext';
import type { PlayerAtomValue } from '../../types/gameAtoms';
import { openIdleChatWatcher, type MpSession, type MpRole } from './mpSession';
import { mpReady } from './mpBridge';
import { recordMatchOutcome } from './record';

const log = createNamedLogger('battleship');

// Garden-mutating types dropped while a match is active. Insta-Grow (Discord
// prompt) doesn't have its own type — it fires through HarvestCrop/HatchEgg
// which are already blocked. Egg pickup + storage moves included to prevent
// any real garden state change during the match.
const GARDEN_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'HarvestCrop',
  'PlantSeed',
  'GrowEgg',
  'HatchEgg',
  'WaterPlant',
  'PotPlant',
  'PlantGardenPlant',
  'RemoveGardenObject',
  'PlaceDecor',
  'PickupDecor',
  'SellAllCrops',
  'SellPet',
  'CropCleanser',
  'MutationPotion',
]);

// Firing is spacebar-driven (see the keydown handler in startSoloMatch) — the
// shovel path was removed because a stray dig could hit a real crop if the
// guard ever fails. All GARDEN_BLOCK_TYPES stay blocked; none are converted
// to shots.

export interface MatchSnapshot {
  phase: MatchPhase;
  mode: MatchMode | null;
  myTurn: boolean;
  myRowsLeft: number;
  theirRowsLeft: number;
  shotCount: number;
  opponentName: string | null;
  placement: { placed: number; total: number; horizontal: boolean; preview: PreviewSnapshot | null } | null;
  aim: Coord | null;
  endReason: EndReason | null;
  pendingChallenge: { playerId: string; playerName: string } | null;
  canClaimTimeoutWin: boolean;
  roomPlayers: Array<{ id: string; name: string }>;
}

export interface PlacementController {
  /** Commit the current preview as the next ship placement. Called by spacebar. */
  commitAtPlayer(): boolean;
  rotate(): void;
  randomize(): void;
  clearAll(): void;
  ready(): Promise<boolean>;
}

export interface MatchInternal {
  mode: MatchMode;
  phase: MatchPhase;
  mySlotIdx: number;
  myGrid: GridSide;
  oppSlotIdx: number;
  oppGrid: GridSide;
  species: Map<string, string>;
  myLayout: FleetLayout;
  placementHorizontal: boolean;
  preview: PreviewController | null;
  currentPreviewSnap: PreviewSnapshot | null;
  currentAim: Coord | null;
  hitsOnMe: Set<string>;
  hitsDealt: Set<string>;
  shotsAtMe: Set<string>;
  shotsAtThem: Set<string>;
  shotCount: number;
  myTurn: boolean;
  ai: BattleshipAi | null;
  aiLayout: FleetLayout | null;
  opponentName: string | null;
  endReason: EndReason | null;
  cleanups: Array<() => void>;
  mp: MpSession | null;
  mpRole: MpRole | null;
  oppReveal: { compact: string; salt: string } | null;
  canClaimTimeoutWin: boolean;
  oppSunkCount: number;
}

let match: MatchInternal | null = null;
let pendingChallenge: { playerId: string; playerName: string } | null = null;
let idleWatcherStop: (() => void) | null = null;
const listeners = new Set<(s: MatchSnapshot) => void>();

// Internal-only accessors used by mpBridge.ts (kept in one place to avoid
// spraying state mutations across files). Prefixed `_mp` to signal these are
// NOT part of the public feature API — index.ts does not re-export them.
export function _mpGetMatch(): MatchInternal | null { return match; }
export function _mpSetMatch(m: MatchInternal | null): void {
  match = m;
  refreshDebugBridge();
}
export function _mpGetPendingChallenge(): { playerId: string; playerName: string } | null {
  return pendingChallenge;
}
export function _mpSetPendingChallenge(p: { playerId: string; playerName: string } | null): void {
  pendingChallenge = p;
}
export function _mpEmit(): void { emit(); }
export function _mpEndMatch(reason: EndReason): void { endMatch(reason); }

function rowsLeft(layout: FleetLayout | null, hits: ReadonlySet<string>): number {
  if (!layout) return FLEET_SPECS.length;
  return layout.filter(ship => !ship.cells.every(c => hits.has(coordKey(c)))).length;
}

export function getMatchSnapshot(): MatchSnapshot {
  const roomPlayers = collectRoomPlayers();
  if (!match) {
    return {
      phase: 'idle',
      mode: null,
      myTurn: false,
      myRowsLeft: FLEET_SPECS.length,
      theirRowsLeft: FLEET_SPECS.length,
      shotCount: 0,
      opponentName: null,
      placement: null,
      aim: null,
      endReason: null,
      pendingChallenge,
      canClaimTimeoutWin: false,
      roomPlayers,
    };
  }
  // Solo tracks AI layout for theirRowsLeft; MP tracks by hits count since
  // opponent's layout isn't known until the reveal at match end.
  const theirRowsLeft =
    match.mode === 'solo'
      ? rowsLeft(match.aiLayout, match.hitsDealt)
      : Math.max(0, FLEET_SPECS.length - match.oppSunkCount);
  return {
    phase: match.phase,
    mode: match.mode,
    myTurn: match.myTurn,
    myRowsLeft: rowsLeft(match.myLayout.length === FLEET_SPECS.length ? match.myLayout : null, match.hitsOnMe),
    theirRowsLeft,
    shotCount: match.shotCount,
    opponentName: match.opponentName,
    placement:
      match.phase === 'placing'
        ? {
            placed: match.myLayout.length,
            total: FLEET_SPECS.length,
            horizontal: match.placementHorizontal,
            preview: match.currentPreviewSnap,
          }
        : null,
    aim: match.phase === 'battle' ? match.currentAim : null,
    endReason: match.endReason,
    pendingChallenge,
    canClaimTimeoutWin: match.canClaimTimeoutWin,
    roomPlayers,
  };
}

function collectRoomPlayers(): Array<{ id: string; name: string }> {
  const players = selectSync((s) => (s.data?.players ?? []) as PlayerAtomValue[]) ?? [];
  const myId = getPlayerIdSync();
  const out: Array<{ id: string; name: string }> = [];
  for (const p of players) {
    if (!p?.id || typeof p.id !== 'string') continue;
    if (p.id === myId) continue;
    const name = typeof p.name === 'string' && p.name.trim().length > 0 ? p.name : p.id.slice(0, 6);
    out.push({ id: p.id, name });
  }
  return out;
}

export function onMatchChange(cb: (s: MatchSnapshot) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(): void {
  const snap = getMatchSnapshot();
  refreshDebugBridge();
  for (const cb of listeners) {
    try {
      cb(snap);
    } catch {
      /* listener errors never break the match */
    }
  }
}

function track(cleanup: () => void): void {
  match?.cleanups.push(cleanup);
}

function delay(ms: number, fn: () => void): void {
  const id = setTimeout(fn, ms);
  track(() => clearTimeout(id));
}

// Debug bridge — proves the guard is active and reports blocked-count.
// Exposes enough of the match to verify placement, shots, and turn state via
// the live console.
function refreshDebugBridge(): void {
  const stats = getSendGuardStats();
  const snap = getMatchSnapshot();
  shareGlobal('__QPM_BATTLESHIP__', {
    match: match
      ? {
          phase: match.phase,
          mode: match.mode,
          mySlotIdx: match.mySlotIdx,
          myGrid: match.myGrid,
          myLayoutShips: match.myLayout.length,
          myLayoutCells: match.myLayout.reduce((n, s) => n + s.cells.length, 0),
          preview: match.currentPreviewSnap,
          myTurn: match.myTurn,
          shotsAtMe: match.shotsAtMe.size,
          shotsAtThem: match.shotsAtThem.size,
          hitsOnMe: match.hitsOnMe.size,
          hitsDealt: match.hitsDealt.size,
        }
      : null,
    snapshot: snap,
    guard: stats,
  });
}

export function endMatch(reason: EndReason): void {
  if (!match) return;
  const m = match;
  match = null;
  for (const cleanup of m.cleanups.splice(0)) {
    try {
      cleanup();
    } catch {
      /* ignore */
    }
  }
  try { m.preview?.destroy(); } catch { /* ignore */ }
  try { m.mp?.destroy(); } catch { /* ignore */ }
  removeSendGuard();
  exitBattleStage();
  // Persist W/L for finished-battle outcomes only. Skip aborts / stops /
  // pre-battle exits — those don't count for the record.
  const scored = reason === 'win' || reason === 'loss' || reason === 'opponentResign' || reason === 'opponentLeft' || reason === 'timeoutClaim';
  if (scored) {
    const outcome: 'win' | 'loss' = (reason === 'win' || reason === 'opponentResign' || reason === 'opponentLeft' || reason === 'timeoutClaim') ? 'win' : 'loss';
    recordMatchOutcome({ at: Date.now(), mode: m.mode, outcome, opponent: m.opponentName ?? 'AI' });
  }
  match = { ...m, phase: 'ended', endReason: reason, preview: null, currentPreviewSnap: null, cleanups: [], mp: null };
  emit();
  refreshDebugBridge();
  match = null;
  refreshDebugBridge();
  log.info('QPM-BS-END', { reason });
}

export function stopBattleship(): void {
  endMatch('featureStop');
  if (idleWatcherStop) {
    try { idleWatcherStop(); } catch { /* ignore */ }
    idleWatcherStop = null;
  }
  pendingChallenge = null;
}

const readMyPlayerNameLocal = (): string => {
  const me = (selectSync((s) => (s.data?.players ?? []) as PlayerAtomValue[]) ?? []).find(p => p?.id === getPlayerIdSync());
  return typeof me?.name === 'string' ? me.name : '';
};

export function initBattleship(): void {
  if (!idleWatcherStop) {
    idleWatcherStop = openIdleChatWatcher({
      getMyName: readMyPlayerNameLocal,
      onIncomingChallenge(fromPlayerId, fromName) {
        if (match && match.phase !== 'ended') return;
        pendingChallenge = { playerId: fromPlayerId, playerName: fromName };
        notify({
          feature: 'battleship',
          level: 'info',
          message: t('feature.battleship.challengeIncoming', { name: fromName }, '{name} wants to play Garden Battleship!'),
        });
        // Signal UI to auto-open the panel (listener wired in main.ts).
        try { window.dispatchEvent(new CustomEvent('qpm:battleship-incoming-challenge', { detail: { playerId: fromPlayerId, playerName: fromName } })); } catch { /* ignore */ }
        emit();
      },
    });
  }
  refreshDebugBridge();
}

function handleBlockedSend(_type: string): void {
  if (!match) return;
  notifyOncePerSession({
    key: 'battleship-guard',
    feature: 'battleship',
    level: 'info',
    message: t('feature.battleship.guardBlocked', undefined, 'Garden is in battle mode — action blocked'),
  });
}

function installGuards(): void {
  const guardOk = installSendGuard(GARDEN_BLOCK_TYPES, handleBlockedSend);
  if (!guardOk) log.warn('QPM-BS-004', { reason: 'send_guard_install_failed' });
  const stopWatch = visibleInterval('qpm-bs-conn-watch', () => {
    if (!isGardenStageActive()) {
      notify({
        feature: 'battleship',
        level: 'warn',
        message: t('feature.battleship.connectionLost', undefined, 'Connection changed — match ended, garden restored'),
      });
      endMatch('aborted');
      return;
    }
    refreshDebugBridge();
  }, 5000);
  track(stopWatch);
}

export function startSoloMatch(grid: GridSide): boolean {
  if (match && match.phase !== 'ended') return false;
  match = null;
  const staged = enterBattleStage(grid);
  if (!staged.ok) {
    notify({
      feature: 'battleship',
      level: 'warn',
      message: t('feature.battleship.stageFailed', undefined, 'Could not start — game systems not ready'),
    });
    return false;
  }
  const species = pickFleetSpecies();
  const aiGrid: GridSide = grid === 0 ? 1 : 0;
  match = {
    mode: 'solo',
    phase: 'placing',
    mySlotIdx: staged.mySlotIdx,
    myGrid: grid,
    oppSlotIdx: staged.mySlotIdx,
    oppGrid: aiGrid,
    species,
    myLayout: [],
    placementHorizontal: true,
    preview: null,
    currentPreviewSnap: null,
    currentAim: null,
    hitsOnMe: new Set(),
    hitsDealt: new Set(),
    shotsAtMe: new Set(),
    shotsAtThem: new Set(),
    shotCount: 0,
    myTurn: false,
    ai: null,
    aiLayout: null,
    opponentName: 'AI',
    endReason: null,
    cleanups: [],
    mp: null,
    mpRole: null,
    oppReveal: null,
    canClaimTimeoutWin: false,
    oppSunkCount: 0,
  };
  setOpponentStageAt(staged.mySlotIdx, aiGrid);
  installGuards();
  installBattleKeyHandler();
  startAimTracker();
  refreshDebugBridge();
  notify({
    feature: 'battleship',
    level: 'info',
    message: t('feature.battleship.gardenHidden', undefined, 'Your real garden is hidden while you play — it is safe and untouched'),
  });
  emit();
  return true;
}

function speciesFor(m: MatchInternal): (id: string) => string {
  return id => m.species.get(id) ?? 'Tomato';
}

type Vec2 = { x: number; y: number };

function updateAimFrom(pos: Vec2 | null): void {
  const cur = match;
  if (!cur || cur.phase !== 'battle') return;
  if (!pos) {
    if (cur.currentAim) { cur.currentAim = null; clearPreview(); emit(); }
    return;
  }
  const b = worldToBoard(cur.oppSlotIdx, Math.round(pos.x), Math.round(pos.y));
  const next = b && b.grid === cur.oppGrid ? b.coord : null;
  const same = next && cur.currentAim && next.col === cur.currentAim.col && next.row === cur.currentAim.row;
  if (same) return;
  cur.currentAim = next;
  if (next) setPreviewCells(cur.oppSlotIdx, cur.oppGrid, [next]);
  else clearPreview();
  emit();
}

function startAimTracker(): void {
  // Poll the position atom on rAF while a match is running. The reactive
  // subscription for 'position' fires on DOM events, but the game processes
  // movement AFTER the event dispatch, so the callback consistently sees the
  // PREVIOUS tile — causing a one-tile lag in the aim ghost. rAF reads the
  // atom AFTER the game's frame update, matching the live player position.
  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    const cur = match;
    if (cur && cur.phase === 'battle') {
      const pos = (readAtomValueSync('position') ?? readAtomValueSync('localPosition')) as Vec2 | null;
      updateAimFrom(pos);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  track(() => { stopped = true; });
}

function fireAtCurrentAim(m: MatchInternal): void {
  // Always resolve the fire target from the LIVE position atom, not the
  // cached aim ghost — the ghost repaints via an atom subscription which
  // lags real position by one event, so spacebar-firing off the ghost
  // would hit the previous tile.
  const pos = (readAtomValueSync('position') ?? readAtomValueSync('localPosition')) as Vec2 | null;
  const board = pos ? worldToBoard(m.oppSlotIdx, Math.round(pos.x), Math.round(pos.y)) : null;
  const target = board && board.grid === m.oppGrid ? board.coord : null;
  if (!target) {
    notifyOncePerSession({
      key: 'battleship-fire-off-enemy',
      feature: 'battleship',
      level: 'info',
      message: t(
        'feature.battleship.fireOnEnemy',
        undefined,
        'Walk onto the ENEMY plot to aim, then press SPACE.',
      ),
    });
    return;
  }
  // Force the ghost to catch up to the live position so the user sees where
  // the shot actually landed.
  if (!m.currentAim || m.currentAim.col !== target.col || m.currentAim.row !== target.row) {
    m.currentAim = target;
    setPreviewCells(m.oppSlotIdx, m.oppGrid, [target]);
  }
  const key = coordKey(target);
  if (m.shotsAtThem.has(key)) {
    notifyOncePerSession({
      key: 'battleship-fire-repeat',
      feature: 'battleship',
      level: 'info',
      message: t(
        'feature.battleship.fireRepeat',
        undefined,
        "You've already fired there. Move to a fresh tile.",
      ),
    });
    return;
  }
  fireAt(target);
}

function nextShipSpec(m: MatchInternal): { length: number } | null {
  const spec = FLEET_SPECS[m.myLayout.length];
  return spec ? { length: spec.length } : null;
}

function commitPlacementInternal(m: MatchInternal): boolean {
  const snap = m.currentPreviewSnap;
  if (!snap) {
    notifyOncePerSession({
      key: 'battleship-place-off-plot',
      feature: 'battleship',
      level: 'info',
      message: t(
        'feature.battleship.placeOffPlot',
        undefined,
        'Walk your character onto your chosen plot to place a ship.',
      ),
    });
    return false;
  }
  const spec = FLEET_SPECS[m.myLayout.length];
  if (!spec) return false;
  const cells = shipCells(snap.origin, spec.length, snap.horizontal);
  if (!cells || !canPlace(m.myLayout, cells)) {
    notifyOncePerSession({
      key: 'battleship-place-blocked',
      feature: 'battleship',
      level: 'info',
      message: t(
        'feature.battleship.placeBlocked',
        undefined,
        'That spot overlaps or touches another ship. Try a different tile.',
      ),
    });
    return false;
  }
  const ship: PlacedShip = { spec, species: speciesFor(m)(spec.id), cells };
  m.myLayout.push(ship);
  setMyFleet(m.myLayout);
  const nextSpec = nextShipSpec(m);
  if (nextSpec && m.preview) m.preview.update(nextSpec.length, m.placementHorizontal);
  else if (m.preview) m.preview.update(0, m.placementHorizontal);
  clearPreview();
  emit();
  return true;
}

export function beginPlacement(): PlacementController | null {
  const m = match;
  if (!m || m.phase !== 'placing') return null;
  if (!m.preview) {
    m.preview = createPlacementPreview({ slotIdx: m.mySlotIdx, grid: m.myGrid });
    const stopSub = m.preview.onChange(snap => {
      const cur = match;
      if (!cur) return;
      cur.currentPreviewSnap = snap;
      if (snap) setPreviewCells(cur.mySlotIdx, cur.myGrid, snap.cells);
      else clearPreview();
      emit();
    });
    track(stopSub);
    const first = nextShipSpec(m);
    if (first) m.preview.update(first.length, m.placementHorizontal);
    m.currentPreviewSnap = m.preview.getCurrent();
    if (m.currentPreviewSnap) setPreviewCells(m.mySlotIdx, m.myGrid, m.currentPreviewSnap.cells);
  }
  const controller: PlacementController = {
    commitAtPlayer(): boolean {
      return commitPlacementInternal(m);
    },
    rotate(): void {
      m.placementHorizontal = !m.placementHorizontal;
      const spec = nextShipSpec(m);
      if (spec && m.preview) m.preview.update(spec.length, m.placementHorizontal);
      emit();
    },
    randomize(): void {
      m.myLayout = randomFleet(FLEET_SPECS, speciesFor(m));
      setMyFleet(m.myLayout);
      m.preview?.update(0, m.placementHorizontal);
      clearPreview();
      emit();
    },
    clearAll(): void {
      m.myLayout = [];
      setMyFleet(m.myLayout);
      const first = nextShipSpec(m);
      if (first && m.preview) m.preview.update(first.length, m.placementHorizontal);
      emit();
    },
    ready(): Promise<boolean> {
      if (m.myLayout.length !== FLEET_SPECS.length) return Promise.resolve(false);
      if (m.mode === 'solo') {
        startSoloBattle(m);
        return Promise.resolve(true);
      }
      return mpReady(m);
    },
  };
  emit();
  return controller;
}

function startSoloBattle(m: MatchInternal): void {
  m.aiLayout = randomFleet(FLEET_SPECS, speciesFor(m));
  m.ai = createAi();
  m.phase = 'battle';
  m.myTurn = true;
  try { m.preview?.destroy(); } catch { /* ignore */ }
  m.preview = null;
  m.currentPreviewSnap = null;
  clearPreview();
  const seed = readAtomValueSync('position') ?? readAtomValueSync('localPosition');
  updateAimFrom(seed as Vec2 | null);
  notify({
    feature: 'battleship',
    level: 'info',
    message: t('feature.battleship.battleStart', undefined, 'Walk to a tile on the enemy plot and shovel it to fire.'),
  });
  emit();
}

export function fireAt(c: Coord): void {
  const m = match;
  if (!m || m.phase !== 'battle' || !m.myTurn) return;
  const key = coordKey(c);
  if (m.shotsAtThem.has(key)) return; // already fired here
  m.shotsAtThem.add(key);
  if (m.mode === 'solo') {
    if (!m.aiLayout) return;
    const result = resolveShot(m.aiLayout, m.hitsDealt, c);
    m.shotCount++;
    if (result.verdict === 'miss') {
      markShotOnOppBoard(c, 'miss');
      m.myTurn = false;
      emit();
      scheduleAiTurn(m);
      return;
    }
    m.hitsDealt.add(key);
    markShotOnOppBoard(c, 'hit', result.species);
    if (result.verdict === 'win') {
      notify({
        feature: 'battleship',
        level: 'success',
        message: t('feature.battleship.win', undefined, 'Victory! You harvested the whole enemy garden'),
      });
      endMatch('win');
      return;
    }
    emit(); // hit or sunk — shoot again
    return;
  }
  // MP: send shot; verdict arrives async via mpSession hook.
  if (!m.mp) return;
  const ok = m.mp.sendShot(c);
  if (!ok) {
    m.shotsAtThem.delete(key);
    notifyOncePerSession({
      key: 'battleship-mp-shot-failed',
      feature: 'battleship',
      level: 'warn',
      message: t('feature.battleship.shotFailed', undefined, 'Shot did not send — try again.'),
    });
    return;
  }
  m.shotCount++;
  emit();
}

function scheduleAiTurn(m: MatchInternal): void {
  const think = AI_THINK_MIN_MS + Math.random() * (AI_THINK_MAX_MS - AI_THINK_MIN_MS);
  delay(think, () => {
    const current = match;
    if (!current || current !== m || current.phase !== 'battle' || !current.ai) return;
    // Pick a shot the AI hasn't already tried at me.
    let shot = current.ai.nextShot();
    // Guard against duplicate (defensive; AI already dedupes).
    let attempts = 0;
    while (current.shotsAtMe.has(coordKey(shot)) && attempts < 20) {
      shot = current.ai.nextShot();
      attempts++;
    }
    current.shotsAtMe.add(coordKey(shot));
    const result = resolveShot(current.myLayout, current.hitsOnMe, shot);
    current.ai.notifyResult(shot, result.verdict);
    if (result.verdict === 'miss') {
      markShotOnMyBoard(shot, 'miss');
      current.myTurn = true;
      emit();
      return;
    }
    current.hitsOnMe.add(coordKey(shot));
    markShotOnMyBoard(shot, 'hit');
    if (result.verdict === 'win' || isFleetSunk(current.myLayout, current.hitsOnMe)) {
      notify({
        feature: 'battleship',
        level: 'warn',
        message: t('feature.battleship.loss', undefined, 'Defeat — your garden was fully harvested'),
      });
      endMatch('loss');
      return;
    }
    emit();
    scheduleAiTurn(current); // AI hit — it shoots again
  });
}

export function resignMatch(): void {
  const m = match;
  log.info('QPM-BS-RESIGN', { matched: !!m, phase: m?.phase ?? null, mode: m?.mode ?? null, hasMp: !!m?.mp });
  if (!m || m.phase === 'ended') return;
  if (m.mode === 'mp' && m.mp) {
    try { m.mp.sendResign(); } catch { /* best effort */ }
  }
  endMatch('resign');
}

// Internal helpers exposed for mpBridge.ts (not part of the public API).
export const _internal = { installBattleKeyHandler, installGuards, startAimTracker, updateAimFrom };

function installBattleKeyHandler(): void {
  const onKey = (e: KeyboardEvent): void => {
    const cur = match;
    if (!cur) return;
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (cur.phase === 'placing') {
      e.preventDefault();
      e.stopPropagation();
      if (cur.preview) commitPlacementInternal(cur);
      return;
    }
    if (cur.phase === 'battle' && cur.myTurn) {
      e.preventDefault();
      e.stopPropagation();
      fireAtCurrentAim(cur);
    }
  };
  window.addEventListener('keydown', onKey, true);
  track(() => window.removeEventListener('keydown', onKey, true));
}
