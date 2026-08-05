import { getRoomConnection, type RoomConnection, type RoomPatchListener } from '../websocket/api';
import { createNamedLogger } from '../diagnostics/logger';

const log = createNamedLogger('patchStage');

// Takes over MagicCircle_RoomConnection.patchSubscribers during a "staging"
// session: incoming patches matching `suppress` are dropped and every
// subscriber receives a doctored fullState, so the game renders a locally
// modified world that survives live server updates. Board edits repaint via
// dispatchSynthetic(). Live-verified 2026-08-04 (battleship spike findings §8):
// synthetic add rendered a full native plant; atom-freeze does NOT drive the
// tile renderer (TileObjectSystem is patch-driven), which is why this exists.

export type PatchOp = { op: string; path: string; value?: unknown };
/** Mutates and/or returns the doctored state. Input is already a deep clone. */
export type StateDoctor = (state: unknown) => unknown;
/** Return true to drop an incoming patch (path is a JSON Pointer). */
export type PathSuppressor = (path: string) => boolean;

type ConnectionWithSubscribers = RoomConnection & {
  patchSubscribers?: Set<RoomPatchListener>;
};

let stage: {
  connection: ConnectionWithSubscribers;
  subscribers: Set<RoomPatchListener>;
  originals: RoomPatchListener[];
  mitm: RoomPatchListener;
  doctor: StateDoctor;
  suppress: PathSuppressor;
} | null = null;

function getSubscribers(): { connection: ConnectionWithSubscribers; subscribers: Set<RoomPatchListener> } | null {
  const connection = getRoomConnection() as ConnectionWithSubscribers | null;
  if (!connection) return null;
  const subscribers = connection.patchSubscribers;
  if (!(subscribers instanceof Set)) return null;
  return { connection, subscribers };
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

export function enterPatchStage(doctor: StateDoctor, suppress: PathSuppressor): boolean {
  if (stage) return true;
  const found = getSubscribers();
  if (!found) {
    log.warn('QPM-STAGE-001', { reason: 'no_subscribers_set' });
    return false;
  }
  const { connection, subscribers } = found;
  const originals = [...subscribers];
  const mitm: RoomPatchListener = (patches, fullState) => {
    const s = stage;
    if (!s) return;
    try {
      const arr = Array.isArray(patches) ? (patches as PatchOp[]) : [];
      const filtered = arr.filter(p => typeof p?.path !== 'string' || !s.suppress(p.path));
      const doctored = s.doctor(structuredClone(fullState));
      for (const cb of s.originals) {
        try {
          cb(filtered, doctored);
        } catch {
          /* one bad subscriber never breaks the chain */
        }
      }
    } catch (err) {
      // Doctoring failed — pass reality through rather than starving the game.
      log.error('QPM-STAGE-002', {}, err);
      for (const cb of s.originals) {
        try {
          cb(patches, fullState);
        } catch {
          /* ignore */
        }
      }
    }
  };
  subscribers.clear();
  subscribers.add(mitm);
  stage = { connection, subscribers, originals, mitm, doctor, suppress };
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
    const doctored = stage.doctor(structuredClone(real));
    const patches: PatchOp[] = paths.map(path => ({ op: 'replace', path, value: null }));
    for (const cb of stage.originals) {
      try {
        cb(patches, doctored);
      } catch {
        /* ignore */
      }
    }
    return true;
  } catch (err) {
    log.error('QPM-STAGE-003', {}, err);
    return false;
  }
}

/**
 * Restore the real subscriber set and repaint `repaintPaths` from live state.
 * Subscribers added during the stage (rare) are preserved.
 */
export function exitPatchStage(repaintPaths: string[]): void {
  if (!stage) return;
  const { subscribers, originals, mitm, connection } = stage;
  stage = null;
  try {
    const added = [...subscribers].filter(cb => cb !== mitm);
    subscribers.clear();
    for (const cb of originals) subscribers.add(cb);
    for (const cb of added) subscribers.add(cb);
    const real = connection.lastRoomStateJsonable;
    if (real != null && repaintPaths.length > 0) {
      const patches: PatchOp[] = repaintPaths.map(path => ({ op: 'replace', path, value: null }));
      for (const cb of subscribers) {
        try {
          cb(patches, real);
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    log.error('QPM-STAGE-004', {}, err);
  }
}
