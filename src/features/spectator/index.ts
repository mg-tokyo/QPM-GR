import { readSync, subscribe } from '../../core/gameState';
import { notify } from '../../core/notifications';
import { onPixiCaptureChange } from '../../core/pixiCapture';
import { setSpectatorLineSource } from '../../diagnostics/copyPayload';
import { t } from '../../i18n';
import { showToast } from '../../ui/components';
import { formatKeybind } from '../../ui/pets/petsWindow/helpers';
import type { GridPosition } from '../../types/gameAtoms';
import { InstallStack } from '../../utils/installStack';
import { onRoomConnectionChange } from '../../websocket/roomConnectionEvents';
import { setCamera3dExternalBlock } from '../camera3d';
import { formatSpectatorLine, spectatorDiag, type SpectatorStatus } from './diagnostics';
import { installDirector, type DirectorSession } from './directorSession';
import { installDriver2d, type Driver2d, type DriverHooks } from './driver2d';
import { asFollowView, bodyPointOf, followPointOf, followSourceFor, pickPlayerAt, tileOf } from './follow';
import { hotbarTopCss, resolveHandles, zoomSystemOf, type SpecHandles } from './handles';
import { installKeys, type KeyRouter } from './input/keys';
import { installPointer } from './input/pointer';
import { livePhotoDeps } from './photo/live';
import { installPhoto, type PhotoSession } from './photo/mode';
import { listSeatedPlayers, nextFollowId, onPlayersChange, type SeatedPlayer } from './players';
import { zoomStepFor, type FlightInput } from './pose/flight';
import { startupCheck, TRANSIENT_MISSING } from './probe';
import {
  getSpectatorHints, getSpectatorSettings, markSpectatorHint, onSpectatorSettingsChange, SPECTATOR_DEFAULTS, type SpectatorSettings,
} from './settings';
import { createSpectatorStore, initialSpectatorState, type SpectatorState } from './state';
import { mountBar, type SpectatorBar } from './ui/bar';
import { cardCatalog } from './ui/cardCatalog';
import { mountInfoCard, type InfoCard } from './ui/infoCard';
import { slotOwnedBy } from './ui/infoCardModel';
import { installWaypoints, type WaypointSession } from './waypointSession';
import { listWaypoints } from './waypoints';

export {
  getSpectatorSettings, setSpectatorSetting, onSpectatorSettingsChange, resetSpectatorSettings, SPECTATOR_ACTIONS, SPECTATOR_DEFAULTS,
  DIRECTOR_EVERY_RANGE, FLY_SPEED_RANGE,
} from './settings';
export type { SpectatorAction, SpectatorSettings } from './settings';
export { findKeyClashes, holdKeyOf, isHoldAction, refuseKey, type KeyClash, type KeyRefusal, type OtherKeybind } from './input/keyRules';
export type { PauseReason, SpectatorMode, SpectatorPose, SpectatorState, SpectatorViewKind } from './state';

// camera3d's policy: three failures in one page session keep it off until reload.
const MAX_FAILS = 3;
// settings.flySpeed 1 = 600 CSS px per second on screen (S §4.1).
const FLY_PX_PER_SEC = 600;
const STILL: FlightInput = { fx: 0, fy: 0, up: 0, fast: false };
// camera3d's on-screen notice: the panel's notification list alone is never seen in play (camera3d A T3).
const NOTICE_MS = 6000;
const NOTICE_MAX_W = 240;
// The first-entry hint names six keys: longer to read than a notice.
const HINT_MS = 9000;
// S §7: a brief notice when your own camera input turns the director off.
const DIRECTOR_NOTICE_MS = 3000;

interface Session {
  tx: InstallStack; driver: Driver2d; hs: SpecHandles; bar: SpectatorBar; card: InfoCard; director: DirectorSession; waypoints: WaypointSession;
  photo: PhotoSession;
}

let started = false;
const store = createSpectatorStore();
const cleanups: Array<() => void> = [];
// Cached from the change event: the frame and every keydown read it, and a stored read parses each time.
let settings: Readonly<SpectatorSettings> = SPECTATOR_DEFAULTS;
let keys: KeyRouter | null = null;
let session: Session | null = null;
let unavailable: readonly string[] = [];
let warnedMissing = '';
let fails = 0;
let disabledForSession = false;
let followName = '';
// I or × on the info card: hidden until I again, across spectating sessions until reload (PS2).
let cardHidden = false;

export function startSpectator(): void {
  if (started) return;
  started = true;
  try {
    spectatorDiag.ensureBusRegistered();
    settings = getSpectatorSettings();
    setSpectatorLineSource(() => formatSpectatorLine(getSpectatorStatus()));
    cleanups.push(onSpectatorSettingsChange((s) => { settings = s; if (!s.enabled) exitSpectator('disabled'); }));
    keys = installKeys(
      {
        active: () => store.get().active, enabled: () => settings.enabled && !disabledForSession, uiOwnsInput, bindings: () => settings.keys,
        activity: () => { session?.hs.notifyActivity(); },
      },
      {
        press: {
          toggle: () => { if (store.get().active) leaveSpectator(); else enterSpectator('key'); },
          up: () => { session?.driver.stepZoom(zoomStepFor(1)); },
          down: () => { session?.driver.stepZoom(zoomStepFor(-1)); },
          prevPlayer: () => { cyclePlayer(-1); },
          nextPlayer: () => { cyclePlayer(1); },
          detach: () => { stopDirector(); detach(); },
          director: toggleDirector,
          hideUi: () => { store.patch({ uiHidden: !store.get().uiHidden }); },
          infoCard: () => { session?.card.toggle(); },
          saveWaypoint: () => { session?.waypoints.save(); },
          prevWaypoint: () => { session?.waypoints.cycle(-1); },
          nextWaypoint: () => { session?.waypoints.cycle(1); },
          photo: togglePhoto,
        },
        escape: () => {
          const s = session;
          if (s && (s.photo.escape() || s.bar.closePopover())) return;
          leaveSpectator();
        },
        capture: (repeat) => session?.photo.captureKey(repeat) ?? false,
        seat: followSeat,
        steer: () => {
          if (!session || session.driver.homing()) return;
          stopDirector();
          if (store.get().mode === 'follow') detach();
        },
      },
    );
    cleanups.push(() => { keys?.off(); keys = null; });
    spectatorDiag.publishOk();
  } catch (e) {
    // Called from QPM's boot phases: a spectator bug must not stop the rest of QPM starting.
    spectatorDiag.warnFeature('QPM-SPEC-001', { missing: ['start'] }, e);
    stopSpectator();
  }
}

export function stopSpectator(): void {
  if (!started) return;
  exitSpectator('stop');
  started = false;
  for (const off of cleanups.splice(0)) {
    try { off(); } catch { /* isolate */ }
  }
  setSpectatorLineSource(null);
  unavailable = [];
  warnedMissing = '';
  warnedPhoto = '';
}

function uiOwnsInput(): boolean {
  try {
    return (session?.hs.zoomSys ?? zoomSystemOf(readSync('quinoaEngine')))?.shouldBlockZoom() ?? false;
  } catch { return false; }
}

function reportUnavailable(missing: readonly string[], reason: string, cause?: unknown): void {
  unavailable = missing;
  const key = missing.join(',');
  if (!key || key === warnedMissing) return;
  warnedMissing = key;
  spectatorDiag.warnFeature('QPM-SPEC-001', { missing, reason }, cause);
}

function frameFailed(e: unknown): void {
  fails++;
  spectatorDiag.warnFeature('QPM-SPEC-003', { phase: 'frame', n: fails }, e);
  if (fails < MAX_FAILS || disabledForSession) return;
  disabledForSession = true;
  spectatorDiag.diag.info('QPM-SPEC-004', { fails });
}

function showNotice(text: string, ms = NOTICE_MS): void {
  notify({ feature: 'spectator', level: 'info', message: text });
  showToast(text, { variant: 'info', duration: ms, maxWidth: NOTICE_MAX_W });
}

// Once ever (S §6.1), in the player's own bindings; the seat digits run to the room's size.
function showFirstEntryHint(): void {
  if (getSpectatorHints().entered) return;
  markSpectatorHint('entered');
  const k = settings.keys;
  const moves = [k.forward, k.left, k.back, k.right].map(formatKeybind);
  const seats = Math.max(1, readSync('userSlots')?.length ?? 0);
  showNotice(t('feature.spectator.hint.first', {
    move: moves.join(moves.every((m) => m.length === 1) ? '' : '/'), prev: formatKeybind(k.prevPlayer), next: formatKeybind(k.nextPlayer),
    seats: `1–${seats}`, hide: formatKeybind(k.hideUi), exit: formatKeybind(k.toggle),
  }), HINT_MS);
}

// The camera stays where it is (S §3.3); with the director on, it picks someone else on its next frame.
function onRoster(list: readonly SeatedPlayer[]): void {
  const id = store.get().targetId;
  if (!id || list.some((p) => p.id === id && p.online)) return;
  showNotice(t('feature.spectator.followLost', { name: followName || id }));
  detach();
}

/** A click on the world follows the player whose drawn body is nearest the click (S §4.6). */
function pickAt(hs: SpecHandles, x: number, y: number): void {
  const grid = hs.pointer.toGrid(x, y);
  if (!grid) return;
  const candidates: Array<{ id: string; point: { x: number; y: number } }> = [];
  for (const p of listSeatedPlayers()) {
    const v = asFollowView(hs.avatars.views.get(p.id));
    if (v?.isInViewport) candidates.push({ id: p.id, point: bodyPointOf(v) });
  }
  const id = pickPlayerAt(grid, candidates);
  if (id) followPlayer(id);
}

function installWorldPointer(hs: SpecHandles): () => void {
  return installPointer(
    {
      active: () => store.get().active && !(session?.driver.homing() ?? true),
      uiOwnsInput, isWorldTarget: hs.pointer.isCanvas, toGlobal: hs.pointer.toGlobal, overUi: hs.pointer.overUi,
      activity: hs.notifyActivity,
    },
    {
      dragStart: () => { stopDirector(); detach(); },
      drag: (dx, dy) => { session?.driver.panBy(dx, dy); },
      click: (x, y) => { pickAt(hs, x, y); },
    },
  );
}

// Room or socket replaced, engine swapped, PIXI re-captured: the handles QPM holds may be dead, so leave at once.
function watchForcedExits(engine: object): Array<() => void> {
  return [
    onPixiCaptureChange(() => { exitSpectator('capture'); }),
    subscribe('quinoaEngine', (e) => { if (e !== engine) exitSpectator('engine'); }),
    onRoomConnectionChange((_room, why) => { if (why === 'room' || why === 'socket') exitSpectator('room'); }),
  ];
}

/** Startup check, then every piece with its undo (S §11.3); a throw part-way unwinds what is in. */
export function enterSpectator(reason = 'api'): boolean {
  if (!started || store.get().active || !settings.enabled || disabledForSession) return false;
  const check = startupCheck();
  if (!check.ok) { reportUnavailable(check.missing.filter((m) => !TRANSIENT_MISSING.has(m)), reason); return false; }
  const hs = resolveHandles();
  if (Array.isArray(hs)) { reportUnavailable(hs, reason); return false; }
  const tx = new InstallStack();
  let mine: Driver2d | null = null;
  let bar: SpectatorBar | null = null;
  let card: InfoCard | null = null;
  let director: DirectorSession | null = null;
  let waypoints: WaypointSession | null = null;
  let photo: PhotoSession | null = null;
  const hooks: DriverHooks = {
    input: () => keys?.input() ?? STILL,
    speed: () => FLY_PX_PER_SEC * settings.flySpeed,
    onPause: (r) => { spectatorDiag.diag.info('QPM-SPEC-002', { reason: r }); },
    onDisplaced: (n) => { if (n === 1) spectatorDiag.diag.info('QPM-SPEC-002', { reason: 'owner' }); },
    onEnd: (why, error) => {
      if (!mine || session?.driver !== mine) return;
      if (error !== undefined) frameFailed(error);
      exitSpectator(why);
    },
    onDetach: () => { stopDirector(); store.patch({ mode: 'free', targetId: null }); },
    frame: (now) => { director?.frame(now); },
  };
  try {
    tx.add('camera3d', () => { setCamera3dExternalBlock('spectator'); }, () => { setCamera3dExternalBlock(null); });
    mine = tx.add('driver', () => installDriver2d(store, hs, hooks), (d) => { d.uninstall(); });
    tx.add('exits', () => watchForcedExits(hs.engine), (offs) => { for (const off of offs) off(); });
    tx.add('pointer', () => installWorldPointer(hs), (off) => { off(); });
    tx.add('roster', () => onPlayersChange(onRoster), (off) => { off(); });
    bar = tx.add('bar', () => mountBar(store, {
      players: listSeatedPlayers, onPlayers: onPlayersChange, follow: (id) => { followPlayer(id); }, cycle: cyclePlayer,
      exit: leaveSpectator, exitKey: () => formatKeybind(settings.keys.toggle), hotbarTop: hotbarTopCss, director: toggleDirector,
      photo: togglePhoto, onKeys: (cb) => onSpectatorSettingsChange(() => { cb(); }),
    }), (b) => { b.destroy(); });
    card = tx.add('card', () => mountInfoCard(store, {
      player: (id) => listSeatedPlayers().find((p) => p.id === id) ?? null,
      slot: (id) => slotOwnedBy(readSync('userSlots'), id),
      watch: (cb) => {
        const offs = [subscribe('userSlots', cb), subscribe('seatPetSlots', cb), subscribe('players', cb)];
        return () => { for (const off of offs) off(); };
      },
      catalog: cardCatalog, closeKey: () => formatKeybind(settings.keys.infoCard),
      hidden: () => cardHidden, setHidden: (h) => { cardHidden = h; },
    }), (c) => { c.destroy(); });
    director = tx.add('director', () => installDirector({
      store, roster: listSeatedPlayers, onRoster: onPlayersChange,
      slots: () => readSync('userSlots'), onSlots: (cb) => subscribe('userSlots', cb),
      tileOf: (id) => tileOf(hs.avatars, id), isAbility: (a) => cardCatalog.abilityName(a) !== null,
      follow: followPlayer, homing: () => mine?.homing() ?? true, settings: () => settings,
      perfNow: () => performance.now(), wallNow: () => Date.now(),
    }), (d) => { d.uninstall(); });
    waypoints = tx.add('waypoints', () => installWaypoints({
      pose: () => mine?.pose() ?? null, view: () => store.get().view,
      busy: () => { const p = store.get().paused; return (p !== null && p !== 'ui') || (mine?.homing() ?? true); },
      flyTo: flyToSpot, notice: (text) => { showNotice(text); },
      toast: (text, ms) => { showToast(text, { variant: 'info', duration: ms, maxWidth: NOTICE_MAX_W }); },
      saveKey: () => formatKeybind(settings.keys.saveWaypoint),
      setMenu: (el, onClose) => { bar?.setWaypointsMenu(el, onClose); }, closeMenu: () => { bar?.closePopover(); },
    }), (w) => { w.uninstall(); });
    // Last in, so every way out unwinds it first: Cinematic Mode and QPM's UI are back before the rest goes.
    photo = tx.add('photo', () => installPhoto(livePhotoDeps(hs, {
      photoKey: () => formatKeybind(settings.keys.photo),
      unavailable: photoUnavailable, blocked: (op) => { spectatorDiag.diag.info('QPM-SPEC-005', { op }); },
    })), (p) => { p.uninstall(); });
  } catch (e) {
    tx.unwind();
    reportUnavailable([`init:${tx.step}`], reason, e);
    return false;
  }
  session = { tx, driver: mine, hs, bar, card, director, waypoints, photo };
  if (warnedMissing) { warnedMissing = ''; spectatorDiag.publishOk(); }
  unavailable = [];
  store.patch({ ...initialSpectatorState(), active: true, pose: mine.pose() });
  showFirstEntryHint();
  return true;
}

/** G or Esc: fly back to your avatar, then exit. */
function leaveSpectator(): void {
  const s = session;
  if (!s || s.driver.homing()) return;
  s.photo.exit();
  const home = followPointOf(null, readSync('localPosition'));
  if (home) s.driver.flyHome(home);
  else exitSpectator('no-avatar');
}

/** Fly to a seated player, then stay locked on them (S §3.2). */
export function followPlayer(id: string): boolean {
  const s = session;
  if (!s || s.driver.homing()) return false;
  const p = listSeatedPlayers().find((q) => q.id === id && q.online);
  if (!p) return false;
  followName = p.name;
  s.driver.setFollowSource(followSourceFor(id, s.hs.avatars));
  store.patch({ mode: 'follow', targetId: id });
  // A manual pick keeps the director on and restarts its timer on them (S §7).
  s.director.picked(id);
  return true;
}

/** T and the bar's Director button (S §7). With nobody else seated it stays on and picks when someone sits. */
export function setSpectatorDirector(on: boolean): boolean {
  const s = session;
  if (!s) return false;
  s.director.set(on);
  if (on && !listSeatedPlayers().some((p) => p.online)) showNotice(t('feature.spectator.noPlayers'));
  return s.director.isOn();
}

/** Debug: each followable player's activity score while the director is on. */
export const getSpectatorDirectorScores = (): Record<string, number> => session?.director.scores() ?? {};

function toggleDirector(): void {
  setSpectatorDirector(!store.get().director);
}

/** Your own camera input turns the director off: a fly key, a drag, F, a waypoint; later V (Task 13). */
function stopDirector(): void {
  const s = session;
  if (!s?.director.isOn()) return;
  s.director.set(false);
  showNotice(t('feature.spectator.director.off'), DIRECTOR_NOTICE_MS);
}

/** A waypoint: your own camera move, so the director turns off (S §7) and a follow ends where the fly starts. */
function flyToSpot(p: GridPosition, tileSize: number | null): boolean {
  if (!session?.driver.flyTo(p, tileSize)) return false;
  stopDirector();
  if (store.get().mode === 'follow') store.patch({ mode: 'free', targetId: null });
  return true;
}

/** P and the bar's Photo button (S §9). An open popover closes first: photo mode hides it. */
function togglePhoto(): void {
  const s = session;
  if (!s || s.driver.homing()) return;
  if (!s.photo.active()) s.bar.closePopover();
  s.photo.toggle();
  // Working again: the next failure is news, as with warnedMissing.
  if (s.photo.active()) warnedPhoto = '';
}

let warnedPhoto = '';
function photoUnavailable(missing: readonly string[]): void {
  showNotice(t('feature.spectator.photo.unavailable'));
  const key = missing.join(',');
  if (key === warnedPhoto) return;
  warnedPhoto = key;
  spectatorDiag.warnFeature('QPM-SPEC-001', { missing, reason: 'photo' });
}

/** Debug: photo mode on or off; returns whether it is on. */
export function setSpectatorPhoto(on: boolean): boolean {
  const s = session;
  if (s && s.photo.active() !== on) togglePhoto();
  return s?.photo.active() ?? false;
}

/** Debug: one shot through photo mode (null when photo mode is off or a capture is running). */
export const captureSpectatorPhoto = (): Promise<Blob | null> | null => session?.photo.capture() ?? null;

/** Debug: fly to a saved waypoint by id. */
export const flyToSpectatorWaypoint = (id: string): boolean => session?.waypoints.fly(id) ?? false;

/** F, a drag, or the followed player gone: free cam where the camera is. */
export function detach(): void {
  session?.driver.setFollowSource(null);
  if (store.get().mode === 'follow') store.patch({ mode: 'free', targetId: null });
}

export function cyclePlayer(dir: 1 | -1): void {
  if (!session) return;
  const list = listSeatedPlayers().filter((p) => p.online);
  const id = nextFollowId(list, store.get().targetId, dir);
  if (id) followPlayer(id);
  else showNotice(t('feature.spectator.noPlayers'));
}

function followSeat(n: number): boolean {
  if (!session) return false;
  const p = listSeatedPlayers().find((q) => q.seat === n && q.online);
  return !!p && followPlayer(p.id);
}

/** Immediate and idempotent; every exit path ends here. Unwinds last in, first out: the forced-exit watchers, then the
 * driver (its ticker listener, the target if still QPM's, the owner, the zoom), then the camera3d block. */
export function exitSpectator(_reason: string): void {
  const s = session;
  session = null;
  s?.tx.unwind();
  if (store.get().active) store.patch(initialSpectatorState());
}

export const isSpectatorActive = (): boolean => store.get().active;
export const getSpectatorState = (): Readonly<SpectatorState> => (session ? { ...store.get(), pose: session.driver.pose() } : store.get());
export const onSpectatorChange = (cb: (s: Readonly<SpectatorState>) => void): (() => void) => store.on(cb);

export function getSpectatorStatus(): SpectatorStatus {
  const s = store.get();
  let seat: SpectatorStatus['seat'] = null;
  try { seat = readSync('localPresence'); } catch { /* gameState not started */ }
  return {
    enabled: getSpectatorSettings().enabled, active: s.active, mode: s.mode, view: s.view, seat, paused: s.paused,
    director: s.director, waypoints: listWaypoints().length, fails, frameMs: session?.driver.frameMs() ?? null,
    unavailable: disabledForSession ? ['errors', ...unavailable] : unavailable,
  };
}

/** The console debug API (src/debug/mainApi/lateExposure.ts), loaded on demand: debug.ts imports this module. */
export const loadSpectatorDebugApi = async () => (await import('./debug')).getSpectatorDebugApi();
