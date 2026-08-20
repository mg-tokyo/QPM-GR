import { getRoomConnection, type RoomConnection, type RoomPatchListener } from '../websocket/api';
import { createNamedLogger } from '../diagnostics/logger';

const log = createNamedLogger('patchStage');

// Takes over MagicCircle_RoomConnection.patchSubscribers AND welcomeSubscribers
// during a "staging" session: incoming patches matching `suppress` are dropped
// and every subscriber receives a doctored fullState, so the game renders a
// locally modified world that survives live server updates. Board edits
// repaint via dispatchSynthetic(). Live-verified 2026-08-04 (battleship spike
// findings §8): synthetic add rendered a full native plant; atom-freeze does
// NOT drive the tile renderer (TileObjectSystem is patch-driven).
//
// Welcome interception is required because TileObjectSystem.onWelcome
// (beta TileObjectSystem.ts:356) rebuilds every tile from the raw Welcome
// snapshot on each reconnect (RoomConnection.ts:836-870), bypassing the
// patch path. Late subscribers (a rebuilt QuinoaEngine after a transient
// reconnect — QuinoaCanvas.tsx:64-70) are captured via own-property `add` /
// `delete` overrides on both Sets so they join the doctored fan-out.

export type PatchOp = { op: string; path: string; value?: unknown };
/** Mutates and/or returns the doctored state. Input is already a deep clone. */
export type StateDoctor = (state: unknown) => unknown;
/** Return true to drop an incoming patch (path is a JSON Pointer). */
export type PathSuppressor = (path: string) => boolean;
export type WelcomeListener = (state: unknown) => void;
export interface PatchStageHooks {
  /** Fires with the RAW Welcome snapshot before the doctored fan-out. */
  readonly onWelcome?: (realState: unknown) => void;
}

type ConnectionWithSubscribers = RoomConnection & {
  patchSubscribers?: Set<RoomPatchListener>;
  welcomeSubscribers?: Set<WelcomeListener>;
};

type OverridableSet<T> = Set<T>;
type SetOwnProps = { add?: unknown; delete?: unknown };

let stage: {
  connection: ConnectionWithSubscribers;
  subscribers: Set<RoomPatchListener>;
  originals: RoomPatchListener[];
  mitm: RoomPatchListener;
  welcomeSubscribers: Set<WelcomeListener> | null;
  welcomeOriginals: WelcomeListener[];
  welcomeMitm: WelcomeListener | null;
  doctor: StateDoctor;
  suppress: PathSuppressor;
  hooks: PatchStageHooks;
} | null = null;

function getSubscribers(): {
  connection: ConnectionWithSubscribers;
  subscribers: Set<RoomPatchListener>;
  welcomeSubscribers: Set<WelcomeListener> | null;
} | null {
  const connection = getRoomConnection() as ConnectionWithSubscribers | null;
  if (!connection) return null;
  const subscribers = connection.patchSubscribers;
  if (!(subscribers instanceof Set)) return null;
  const welcome = connection.welcomeSubscribers;
  return { connection, subscribers, welcomeSubscribers: welcome instanceof Set ? welcome : null };
}

export function isPatchStageAvailable(): boolean {
  return getSubscribers() !== null;
}

/**
 * Active AND still attached to the live connection. False after a reconnect
 * replaces the connection object — callers must treat that as a hard stop
 * (the real garden is repainting again; abort the match).
 */
export function isPatchStageActive(): boolean {
  if (!stage) return false;
  return getRoomConnection() === stage.connection;
}

function doctoredClone(real: unknown): unknown {
  const s = stage;
  if (!s) return real;
  return s.doctor(structuredClone(real));
}

function fanOutPatches(cbs: readonly RoomPatchListener[], patches: unknown, fullState: unknown): void {
  for (const cb of cbs) {
    try {
      cb(patches, fullState);
    } catch {
      /* one bad subscriber never breaks the chain */
    }
  }
}

function fanOutWelcome(cbs: readonly WelcomeListener[], fullState: unknown): void {
  for (const cb of cbs) {
    try {
      cb(fullState);
    } catch {
      /* ignore */
    }
  }
}

// Route late subscribe/unsubscribe calls (RoomConnection.ts:207-210, 242-257)
// into `originals` so a rebuilt game system joins the doctored fan-out and a
// destroyed one leaves it. Own properties shadow Set.prototype; deleting them
// on exit restores native behaviour.
function installSetOverrides<T>(
  set: OverridableSet<T>,
  originals: T[],
  onAdded?: (cb: T) => void,
): void {
  const own = set as unknown as SetOwnProps;
  own.add = (cb: T): Set<T> => {
    if (!originals.includes(cb)) originals.push(cb);
    onAdded?.(cb);
    return set;
  };
  own.delete = (cb: T): boolean => {
    const idx = originals.indexOf(cb);
    if (idx < 0) return false;
    originals.splice(idx, 1);
    return true;
  };
}

function removeSetOverrides<T>(set: OverridableSet<T>): void {
  const own = set as unknown as SetOwnProps;
  delete own.add;
  delete own.delete;
}

export function enterPatchStage(doctor: StateDoctor, suppress: PathSuppressor, hooks: PatchStageHooks = {}): boolean {
  if (stage) return true;
  const found = getSubscribers();
  if (!found) {
    log.warn('QPM-STAGE-001', { reason: 'no_subscribers_set' });
    return false;
  }
  const { connection, subscribers, welcomeSubscribers } = found;
  const originals = [...subscribers];
  const welcomeOriginals = welcomeSubscribers ? [...welcomeSubscribers] : [];
  const mitm: RoomPatchListener = (patches, fullState) => {
    const s = stage;
    if (!s) return;
    try {
      const arr = Array.isArray(patches) ? (patches as PatchOp[]) : [];
      const filtered = arr.filter(p => typeof p?.path !== 'string' || !s.suppress(p.path));
      const doctored = s.doctor(structuredClone(fullState));
      fanOutPatches(s.originals, filtered, doctored);
    } catch (err) {
      // Doctoring failed — pass reality through rather than starving the game.
      log.error('QPM-STAGE-002', {}, err);
      fanOutPatches(s.originals, patches, fullState);
    }
  };
  const welcomeMitm: WelcomeListener = (fullState) => {
    const s = stage;
    if (!s) return;
    try {
      s.hooks.onWelcome?.(fullState);
    } catch (err) {
      log.error('QPM-STAGE-005', {}, err);
    }
    // The hook may have exited the stage (or flagged the doctor as pass-through).
    const after = stage;
    if (!after) return;
    try {
      fanOutWelcome(after.welcomeOriginals, after.doctor(structuredClone(fullState)));
    } catch (err) {
      log.error('QPM-STAGE-006', {}, err);
      fanOutWelcome(after.welcomeOriginals, fullState);
    }
  };
  subscribers.clear();
  subscribers.add(mitm);
  installSetOverrides(subscribers, originals);
  if (welcomeSubscribers) {
    welcomeSubscribers.clear();
    welcomeSubscribers.add(welcomeMitm);
    // subscribeToWelcome calls a late handler synchronously with the RAW last
    // snapshot right after add (RoomConnection.ts:247-252) — nothing we can
    // intercept, so follow it with a doctored repaint before the next frame.
    installSetOverrides(welcomeSubscribers, welcomeOriginals, (cb) => {
      queueMicrotask(() => {
        const s = stage;
        if (!s || !s.welcomeOriginals.includes(cb)) return;
        const real = s.connection.lastRoomStateJsonable;
        if (real == null) return;
        try {
          cb(s.doctor(structuredClone(real)));
        } catch (err) {
          log.error('QPM-STAGE-007', {}, err);
        }
      });
    });
  }
  stage = {
    connection,
    subscribers,
    originals,
    mitm,
    welcomeSubscribers,
    welcomeOriginals,
    welcomeMitm: welcomeSubscribers ? welcomeMitm : null,
    doctor,
    suppress,
    hooks,
  };
  return true;
}

/** Swap the doctor (board changed) without re-entering the stage. */
export function updateStageDoctor(doctor: StateDoctor): void {
  if (stage) stage.doctor = doctor;
}

/**
 * Repaint specific state paths NOW from the doctored view — synthesizes
 * `replace` patches and feeds them to the original subscribers.
 */
export function dispatchSynthetic(paths: string[]): boolean {
  if (!stage) return false;
  const real = stage.connection.lastRoomStateJsonable;
  if (real == null) return false;
  try {
    const doctored = doctoredClone(real);
    const patches: PatchOp[] = paths.map(path => ({ op: 'replace', path, value: null }));
    fanOutPatches(stage.originals, patches, doctored);
    return true;
  } catch (err) {
    log.error('QPM-STAGE-003', {}, err);
    return false;
  }
}

/**
 * Restore the real subscriber sets and repaint `repaintPaths` from live state.
 * Subscribers added during the stage were routed into `originals`, so they
 * are restored too; destroyed ones were pruned by the `delete` override.
 */
export function exitPatchStage(repaintPaths: string[]): void {
  if (!stage) return;
  const { subscribers, originals, connection, welcomeSubscribers, welcomeOriginals } = stage;
  stage = null;
  try {
    removeSetOverrides(subscribers);
    subscribers.clear();
    for (const cb of originals) subscribers.add(cb);
    if (welcomeSubscribers) {
      removeSetOverrides(welcomeSubscribers);
      welcomeSubscribers.clear();
      for (const cb of welcomeOriginals) welcomeSubscribers.add(cb);
    }
    const real = connection.lastRoomStateJsonable;
    if (real != null && repaintPaths.length > 0) {
      const patches: PatchOp[] = repaintPaths.map(path => ({ op: 'replace', path, value: null }));
      fanOutPatches([...subscribers], patches, real);
    }
  } catch (err) {
    log.error('QPM-STAGE-004', {}, err);
  }
}
