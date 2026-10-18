export type SpectatorMode = 'free' | 'follow';
export type SpectatorViewKind = '2d' | '3d';
export type PauseReason = 'cutscene' | 'tram' | 'foreign' | 'ui';

/** Grid tiles; alt = the game's tile size in 2D, height in world px in 3D. yaw/pitch in degrees as camera3d's look
 * (yaw 0 = north, clockwise). */
export interface SpectatorPose { x: number; y: number; alt: number; yaw: number; pitch: number }

export interface SpectatorState {
  active: boolean;
  mode: SpectatorMode;
  view: SpectatorViewKind;
  pose: SpectatorPose;
  targetId: string | null;
  followStyle: 'chase' | 'eyes';
  paused: PauseReason | null;
  director: boolean;
  uiHidden: boolean;
}

export interface SpectatorStore {
  get(): Readonly<SpectatorState>;
  patch(p: Partial<SpectatorState>): void;
  on(cb: (s: Readonly<SpectatorState>) => void): () => void;
}

export function initialSpectatorState(): SpectatorState {
  return {
    active: false, mode: 'free', view: '2d', pose: { x: 0, y: 0, alt: 0, yaw: 0, pitch: 0 }, targetId: null,
    followStyle: 'chase', paused: null, director: false, uiHidden: false,
  };
}

export function createSpectatorStore(initial: SpectatorState = initialSpectatorState()): SpectatorStore {
  let state: Readonly<SpectatorState> = { ...initial };
  const listeners = new Set<(s: Readonly<SpectatorState>) => void>();
  return {
    get: () => state,
    patch(p) {
      const keys = Object.keys(p) as Array<keyof SpectatorState>;
      if (!keys.some((k) => !Object.is(p[k], state[k]))) return;
      state = { ...state, ...p };
      const snapshot = state;
      for (const cb of [...listeners]) {
        try { cb(snapshot); } catch { /* isolate listeners */ }
      }
    },
    on(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}
