import { getAlertRow } from '../../features/alertHub';
import { getRoomFullMinPlayers, ROOM_FULL_ROW, setRoomFullMinPlayers, type MinPlayersSetting } from '../../features/room/roomFull';
import { t } from '../../i18n';
import { getRoomOccupancy } from '../../store/friendBonus';
import { createPillTabs } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { mountAlertSettings } from '../alertCentre/settingsShell';

export const ROOM_FULL_WINDOW_ID = 'qpm-room-full-alarm';

/** 2 up to one below the room's seat count, then Full; only Full while no room is loaded. */
function choices(seats: number): MinPlayersSetting[] {
  const out: MinPlayersSetting[] = [];
  for (let n = 2; n < seats; n += 1) out.push(n);
  out.push('full');
  return out;
}

function choiceLabel(choice: MinPlayersSetting, seats: number): string {
  return choice === 'full' ? t('feature.roomFull.choiceFull', { seats }) : t('feature.roomFull.choiceCount', { count: choice });
}

function renderRoomFull(root: HTMLElement): () => void {
  const shell = mountAlertSettings(root, t('feature.roomFull.windowTitle'), getAlertRow(ROOM_FULL_ROW));
  const body = shell.addSection(t('feature.roomFull.minLabel'));
  const seats = getRoomOccupancy().seats;
  const options = choices(seats);
  const labels = options.map((c) => choiceLabel(c, seats));

  let pills: HTMLElement | null = null;
  // The pill row paints its active state once, so it is rebuilt on every pick.
  const paintPills = (): void => {
    const idx = options.indexOf(getRoomFullMinPlayers());
    // A stored count at or above the seat count behaves as Full.
    const next = createPillTabs(labels, idx >= 0 ? idx : options.length - 1, (i) => {
      const picked = options[i];
      if (picked === undefined || !setRoomFullMinPlayers(picked)) return;
      shell.refresh();
      paintPills();
    });
    if (pills) pills.replaceWith(next);
    else body.append(next);
    pills = next;
  };
  paintPills();

  const note = document.createElement('div');
  note.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
  note.textContent = t('feature.roomFull.minNote');
  body.append(note);
  return shell.destroy;
}

export function openRoomFullWindow(): void {
  if (isWindowOpen(ROOM_FULL_WINDOW_ID)) {
    closeWindow(ROOM_FULL_WINDOW_ID);
    return;
  }
  destroyWindow(ROOM_FULL_WINDOW_ID);
  openWindow(ROOM_FULL_WINDOW_ID, t('feature.roomFull.windowTitle'), renderRoomFull, '400px', '40vh');
}
