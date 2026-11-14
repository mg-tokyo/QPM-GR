// Desktop notifications for hub alerts (ALR-13.1): sent only while the game tab is hidden, the master
// switch is on, the row is ticked and the browser granted permission. Permission is asked from a click only.
import { isDiscordSurface } from '../../utils/environment';
import { getAlertRow } from './registry';
import { getAlertRowSettings, isDesktopOn, isRowDesktop, writeDesktopOn, writeRowDesktop } from './settings';

export type DesktopAvailability = 'available' | 'blocked' | 'unsupported';
export type DesktopDropReason = 'masterOff' | 'rowOff' | 'unsupported' | 'permission' | 'visible' | 'error';

export interface DesktopAlert {
  title: string;
  body?: string;
  /** The OS replaces an open notification with the same tag. */
  tag: string;
}

const DROP_REASONS: readonly DesktopDropReason[] = ['masterOff', 'rowOff', 'unsupported', 'permission', 'visible', 'error'];
const counts = { sent: 0, shown: 0, clicked: 0, dropped: Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DesktopDropReason, number> };
let discordAttempt: NotificationPermission | 'error' | null = null;
let lastSent: { tag: string; at: number; shownAt: number | null } | null = null;

function notificationApi(): typeof Notification | null {
  const api = (globalThis as { Notification?: typeof Notification }).Notification;
  return typeof api === 'function' && globalThis.isSecureContext !== false ? api : null;
}

function permission(): NotificationPermission | null {
  return notificationApi()?.permission ?? null;
}

export function getDesktopAvailability(): DesktopAvailability {
  const p = permission();
  if (p === null) return 'unsupported';
  if (p === 'denied') return 'blocked';
  // Discord gets one attempt (D1): a prompt that did not grant marks the surface blocked for the session.
  if (isDiscordSurface && discordAttempt !== null && discordAttempt !== 'granted' && p !== 'granted') return 'blocked';
  return 'available';
}

/** Never asks without a user gesture, so nothing can prompt on load. */
export async function requestDesktopPermission(): Promise<NotificationPermission | 'unsupported' | 'noGesture'> {
  const api = notificationApi();
  if (!api) return 'unsupported';
  if (api.permission !== 'default') return api.permission;
  if (navigator.userActivation?.isActive !== true) return 'noGesture';
  let result: NotificationPermission | 'error';
  try {
    result = await api.requestPermission();
  } catch {
    result = 'error';
  }
  if (isDiscordSurface) discordAttempt = result;
  return result === 'error' ? 'denied' : result;
}

function drop(reason: DesktopDropReason): false {
  counts.dropped[reason] += 1;
  return false;
}

export function deliverDesktopAlert(rowId: string, alert: DesktopAlert): boolean {
  if (!isDesktopOn()) return drop('masterOff');
  if (!isRowDesktop(rowId)) return drop('rowOff');
  const api = notificationApi();
  if (!api) return drop('unsupported');
  if (api.permission !== 'granted') return drop('permission');
  if (document.visibilityState !== 'hidden') return drop('visible');
  try {
    const n = new api(alert.title, { ...(alert.body ? { body: alert.body } : {}), tag: alert.tag, silent: true });
    const sent = { tag: alert.tag, at: Date.now(), shownAt: null as number | null };
    lastSent = sent;
    n.onshow = () => { sent.shownAt = Date.now(); counts.shown += 1; };
    n.onclick = () => {
      counts.clicked += 1;
      try { window.focus(); } catch { /* focus may be refused; closing still clears it */ }
      n.close();
    };
  } catch {
    return drop('error');
  }
  counts.sent += 1;
  return true;
}

export function setDesktopOn(on: boolean): void {
  writeDesktopOn(on);
}

export function setRowDesktop(id: string, desktop: boolean): void {
  const def = getAlertRow(id);
  writeRowDesktop(id, desktop, getAlertRowSettings(id, def?.defaultSound ?? 'none', def?.defaultEnabled));
}

export function getDesktopState(): {
  on: boolean;
  availability: DesktopAvailability;
  permission: NotificationPermission | null;
  discord: boolean;
  discordAttempt: NotificationPermission | 'error' | null;
  sent: number;
  shown: number;
  clicked: number;
  dropped: Record<DesktopDropReason, number>;
  lastSent: typeof lastSent;
} {
  return {
    on: isDesktopOn(),
    availability: getDesktopAvailability(),
    permission: permission(),
    discord: isDiscordSurface,
    discordAttempt,
    sent: counts.sent,
    shown: counts.shown,
    clicked: counts.clicked,
    dropped: { ...counts.dropped },
    lastSent: lastSent ? { ...lastSent } : null,
  };
}
