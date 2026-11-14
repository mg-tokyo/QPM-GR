import { onNotifications, type NotificationEvent } from '../../core/notifications';
import { onHarvestToast } from '../garden/harvestReminder';
import { t } from '../../i18n';
import { raiseAlert } from './raise';
import { registerAlertRow, type AlertRowDef } from './registry';

export const VERSION_ROW = 'qpm.versionUpdate';
export const LOCKER_ROW = 'qpm.lockerBlock';
export const HARVEST_ROW = 'garden.harvestReady';

interface BridgedFeature {
  row: AlertRowDef;
  titleKey: string;
  cardKey: string;
}

/** Opens a panel tile's window; lazy so the hub core never loads panel UI. */
function openTile(tileId: string): () => void {
  return () => { void import('../../ui/panel/tileRegistry').then((m) => { m.getTileDefinition(tileId)?.action(); }); };
}

// ALR-9 PD1: QPM's own rare messages default on; harvest stays off like every new alert.
const NOTIFY_SOURCES: Record<string, BridgedFeature> = {
  versionChecker: {
    row: { id: VERSION_ROW, group: 'qpm', labelKey: 'feature.alertHub.version.row', defaultSound: 'bell', defaultEnabled: true },
    titleKey: 'feature.alertHub.version.title',
    cardKey: 'qpm:version',
  },
  Locker: {
    row: { id: LOCKER_ROW, group: 'qpm', labelKey: 'feature.alertHub.locker.row', defaultSound: 'ping', defaultEnabled: true, settingsAction: openTile('locker') },
    titleKey: 'feature.alertHub.locker.title',
    cardKey: 'locker:block',
  },
};
const HARVEST: BridgedFeature = {
  row: { id: HARVEST_ROW, group: 'garden', labelKey: 'feature.alertHub.harvest.row', defaultSound: 'chime', settingsAction: openTile('reminders') },
  titleKey: 'feature.alertHub.harvest.title',
  cardKey: 'harvest:ready',
};

// Module scope so a hub restart never re-raises an event it already showed.
const handled = new WeakSet<NotificationEvent>();
const counts = { notifyCards: 0, harvestCards: 0 };
let stops: Array<() => void> = [];

function onEvents(events: NotificationEvent[]): void {
  for (const e of events) {
    if (handled.has(e)) continue;
    handled.add(e);
    const src = NOTIFY_SOURCES[e.feature];
    if (!src) continue;
    // The notify event is already the History entry.
    const card = raiseAlert(src.row.id, { title: t(src.titleKey), body: e.message, cardKey: src.cardKey, level: e.level }, { history: false });
    if (card) counts.notifyCards += 1;
  }
}

function onHarvest(text: string): void {
  const card = raiseAlert(HARVEST.row.id, { title: t(HARVEST.titleKey), body: text, cardKey: HARVEST.cardKey });
  if (card) counts.harvestCards += 1;
}

/** The hub row a bridged `notify` feature raises, so History can name it. */
export function getBridgedRowId(feature: string): string | null {
  return NOTIFY_SOURCES[feature]?.row.id ?? null;
}

export function registerBridgedRows(): void {
  for (const src of Object.values(NOTIFY_SOURCES)) registerAlertRow(src.row);
  registerAlertRow(HARVEST.row);
}

export function startAlertBridge(): void {
  if (stops.length > 0) return;
  registerBridgedRows();
  stops = [onNotifications(onEvents), onHarvestToast(onHarvest)];
}

export function stopAlertBridge(): void {
  for (const stop of stops) stop();
  stops = [];
}

export function getAlertBridgeStats(): { started: boolean; notifyCards: number; harvestCards: number } {
  return { started: stops.length > 0, ...counts };
}
