// src/core/notifications.ts - Central notification hub
import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger } from '../diagnostics/logger';

export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotificationEvent {
  id: string;
  feature: string;
  level: NotificationLevel;
  message: string;
  timestamp: number;
  actions?: NotificationAction[];
}

type NotificationSubscriber = (events: NotificationEvent[]) => void;

const MAX_NOTIFICATIONS = 100;
const notifications: NotificationEvent[] = [];
const subscribers = new Set<NotificationSubscriber>();
let counter = 0;

// Diagnostics — circular-import-safe because both fanOut() (in logger.ts) and
// emit() below only invoke each other at call time, not at module load.
const notificationsLog = createNamedLogger('ui.notifications');
let busRegistered = false;

function emit(): void {
  const snapshot = notifications.slice();
  for (const subscriber of subscribers) {
    try {
      subscriber(snapshot);
    } catch (error) {
      notificationsLog.warn('QPM-NOTIF-001', { at: 'emit' }, error);
    }
  }
}

/**
 * Register the notification hub with the health bus. Publishes 'ok' since the
 * hub is functional the moment the module loads. Idempotent. Call from main.ts
 * after initDiagnostics() so the bus exists.
 */
export function initNotifications(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register('ui.notifications', { category: 'ui', status: 'starting' });
  healthBus.publish({
    subsystem: 'ui.notifications',
    category: 'ui',
    status: 'ok',
    message: 'Hub ready',
    metrics: { notifications: notifications.length, subscribers: subscribers.size },
  });
}

export function notify(evt: Omit<NotificationEvent, 'id' | 'timestamp'>): NotificationEvent {
  const event: NotificationEvent = {
    ...evt,
    id: `notif-${Date.now()}-${++counter}`,
    timestamp: Date.now(),
  };

  notifications.push(event);
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.splice(0, notifications.length - MAX_NOTIFICATIONS);
  }

  emit();
  return event;
}

export function onNotifications(callback: NotificationSubscriber): () => void {
  subscribers.add(callback);
  try {
    callback(notifications.slice());
  } catch (error) {
    notificationsLog.warn('QPM-NOTIF-001', { at: 'initial' }, error);
  }
  return () => {
    subscribers.delete(callback);
  };
}

export function clearNotifications(feature?: string): void {
  if (!feature) {
    notifications.length = 0;
  } else {
    for (let i = notifications.length - 1; i >= 0; i -= 1) {
      if (notifications[i]?.feature === feature) {
        notifications.splice(i, 1);
      }
    }
  }
  emit();
}

// ── Once-per-session dedupe ────────────────────────────────────────────────
const _oncePerSessionSeen: Set<string> = new Set();

/**
 * Fires `notify()` only if this `key` has not fired in the current page
 * session. Cleared on page reload. Use for compat notices that would spam
 * on every window mount.
 */
export function notifyOncePerSession(
  args: Omit<NotificationEvent, 'id' | 'timestamp'> & { key: string },
): NotificationEvent | null {
  if (_oncePerSessionSeen.has(args.key)) return null;
  _oncePerSessionSeen.add(args.key);
  const { key: _key, ...rest } = args;
  void _key;
  return notify(rest);
}
