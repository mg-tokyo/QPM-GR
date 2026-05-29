// src/core/notifications.ts - Central notification hub
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

function emit(): void {
  const snapshot = notifications.slice();
  for (const subscriber of subscribers) {
    try {
      subscriber(snapshot);
    } catch (error) {
      console.error('[notifications] subscriber error', error);
    }
  }
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
    console.error('[notifications] initial subscriber error', error);
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
