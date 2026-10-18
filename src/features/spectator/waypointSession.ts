import { t } from '../../i18n';
import type { GridPosition } from '../../types/gameAtoms';
import { nextFollowId as nextInCycle } from './players';
import type { SpectatorPose, SpectatorViewKind } from './state';
import { createWaypointMenu } from './ui/waypointMenu';
import {
  deleteWaypoint, listWaypoints, onWaypointsChange, renameWaypoint, saveWaypoint, WAYPOINT_CAP, type Waypoint,
} from './waypoints';

// PW1 (2026-10-10): short toasts on B and on , / . so the player knows which spot.
const SAVED_MS = 2000;
const FLYING_MS = 1500;

export interface WaypointDeps {
  /** The spectator pose now; null when there is none. */
  pose(): SpectatorPose | null;
  view(): SpectatorViewKind;
  /** The game has the camera (a cutscene, the tram, a foreign target) or spectating is flying home: B waits, as the
   * fly does. */
  busy(): boolean;
  /** The driver's fly-to, plus what your own camera move turns off; false when refused. */
  flyTo(p: GridPosition, tileSize: number | null): boolean;
  /** notify() plus the on-screen notice. */
  notice(text: string): void;
  /** A short on-screen line only. */
  toast(text: string, ms: number): void;
  /** The save key as the player reads it, e.g. "B". */
  saveKey(): string;
  /** The bar's Waypoints menu; null takes it away. onClose runs as the bar's popover closes. */
  setMenu(el: HTMLElement | null, onClose?: () => void): void;
  closeMenu(): void;
}

export interface WaypointSession {
  /** B (S §8). */
  save(): void;
  /** , and . from the current waypoint (the last saved or flown to), wrapping. */
  cycle(dir: 1 | -1): void;
  /** A menu row or the debug API; false for an unknown id or a refused fly. */
  fly(id: string): boolean;
  uninstall(): void;
}

/** The waypoints' adapter for one spectating session: keys and the menu in, the driver's fly-to out. */
export function installWaypoints(deps: WaypointDeps): WaypointSession {
  let current: string | null = null;
  let installed = true;

  // Phase A has no 3D view: a 3D waypoint opens straight down at its spot, at the zoom you have (S §8).
  const go = (w: Waypoint): boolean => {
    if (!installed || !deps.flyTo({ x: w.x, y: w.y }, w.view === '2d' && w.alt > 0 ? w.alt : null)) return false;
    current = w.id;
    menu.render();
    return true;
  };

  const api: WaypointSession = {
    save() {
      const pose = installed && !deps.busy() ? deps.pose() : null;
      if (!pose) return;
      const w = saveWaypoint(pose, deps.view());
      if (!w) { deps.notice(t('feature.spectator.wp.full', { max: WAYPOINT_CAP })); return; }
      current = w.id;
      menu.render();
      deps.toast(t('feature.spectator.wp.saved', { name: w.name }), SAVED_MS);
    },
    cycle(dir) {
      if (!installed) return;
      const list = listWaypoints();
      if (list.length === 0) { deps.notice(t('feature.spectator.wp.empty', { key: deps.saveKey() })); return; }
      const id = nextInCycle(list, current, dir);
      const w = list.find((x) => x.id === id);
      if (w && go(w)) deps.toast(t('feature.spectator.wp.flying', { name: w.name }), FLYING_MS);
    },
    fly(id) {
      const w = listWaypoints().find((x) => x.id === id);
      return !!w && go(w);
    },
    uninstall() {
      if (!installed) return;
      installed = false;
      off();
      // The bar closes its popover first, which commits a rename still being typed.
      deps.setMenu(null);
      menu.destroy();
    },
  };

  const menu = createWaypointMenu({
    list: listWaypoints,
    currentId: () => current,
    saveKey: deps.saveKey,
    fly: (id) => { if (api.fly(id)) deps.closeMenu(); },
    save: () => { api.save(); },
    rename: renameWaypoint,
    remove: deleteWaypoint,
  });
  const off = onWaypointsChange(() => { menu.render(); });
  deps.setMenu(menu.el, () => { menu.endEdit(); });
  return api;
}
