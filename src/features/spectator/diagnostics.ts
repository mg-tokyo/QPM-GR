import type { GameStateValue } from '../../core/gameState';
import { createFeatureDiagnostics } from '../../diagnostics/featureDiagnostics';
import type { PauseReason, SpectatorMode, SpectatorViewKind } from './state';

export const spectatorDiag = createFeatureDiagnostics('feature:spectator', 'spectator');

/** unavailable: what the last startup check found missing (QPM-SPEC-001), empty when it passed or never ran. */
export interface SpectatorStatus {
  enabled: boolean;
  active: boolean;
  mode: SpectatorMode;
  view: SpectatorViewKind;
  seat: GameStateValue<'localPresence'> | null;
  paused: PauseReason | null;
  director: boolean;
  waypoints: number;
  fails: number;
  frameMs: number | null;
  unavailable: readonly string[];
}

const MAX_LINE = 120;

/** The copy-report line (S §11.4); null while the feature is disabled. */
export function formatSpectatorLine(st: SpectatorStatus): string | null {
  if (!st.enabled) return null;
  const seat = ` seat=${st.seat ?? '?'}`;
  const fails = ` fails=${st.fails}`;
  if (!st.active) {
    const head = `Spectator: off${seat}${fails}`;
    if (st.unavailable.length === 0) return head;
    const list = st.unavailable.join(',');
    const room = MAX_LINE - head.length - ' unavail='.length;
    return `${head} unavail=${list.length > room ? `${list.slice(0, Math.max(0, room - 1))}…` : list}`;
  }
  const paused = st.paused ? ` paused=${st.paused}` : '';
  const frame = st.frameMs !== null ? ` frame=${st.frameMs.toFixed(2)}ms` : '';
  return `Spectator: on mode=${st.mode} view=${st.view}${seat} director=${st.director ? 1 : 0} wp=${st.waypoints}${paused}${fails}${frame}`;
}
