import {
  captureSpectatorPhoto, detach, enterSpectator, exitSpectator, flyToSpectatorWaypoint, followPlayer, getSpectatorDirectorScores, getSpectatorState,
  getSpectatorStatus, setSpectatorDirector, setSpectatorPhoto,
} from './index';
import { hotbarTopCss } from './handles';
import { listSeatedPlayers } from './players';
import { probe } from './probe';
import { getSpectatorHints, resetSpectatorHints } from './settings';
import { deleteWaypoint, listWaypoints } from './waypoints';

/** QPM_DEBUG_API.spectator (S §11.4). */
export function getSpectatorDebugApi() {
  return {
    state: () => ({ ...getSpectatorState(), status: getSpectatorStatus() }),
    enter: (): boolean => enterSpectator('debug'),
    exit: (): boolean => { exitSpectator('debug'); return !getSpectatorState().active; },
    probe,
    players: listSeatedPlayers,
    /** Enters spectating first when needed. */
    follow: (id: string): boolean => (getSpectatorState().active || enterSpectator('debug')) && followPlayer(id),
    detach,
    /** No argument toggles; returns whether the director is on. */
    director: (on: boolean = !getSpectatorState().director): boolean => setSpectatorDirector(on),
    directorScores: getSpectatorDirectorScores,
    waypoints: listWaypoints,
    /** Flies to a saved waypoint while spectating. */
    waypoint: flyToSpectatorWaypoint,
    /** Live checks delete the waypoints they saved. */
    deleteWaypoint,
    /** Photo mode while spectating: on(true|false), and one shot's size (the image itself stays in the strip). */
    photo: {
      on: setSpectatorPhoto,
      capture: async (): Promise<{ bytes: number; type: string } | null> => {
        const shot = await captureSpectatorPhoto();
        return shot ? { bytes: shot.size, type: shot.type } : null;
      },
    },
    hotbarTop: hotbarTopCss,
    hints: getSpectatorHints,
    /** Live checks restore the first-entry hint they tripped. */
    resetHints: resetSpectatorHints,
  };
}
