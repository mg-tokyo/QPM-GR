import { getSoundGateStats, stopAllLoops } from '../../ui/shop/restockAlerts/soundEngine';
import { closeAllHubCards, getHubCardCount, presentHubCard, resizeHubCards } from '../../ui/shop/restockAlerts/hubCard';
import { t } from '../../i18n';
import { closeAllAlertCards, getRaiseStats, raiseAlert, setAlertPresenter, type AlertCardHandle } from './raise';
import { getAlertBridgeStats, startAlertBridge, stopAlertBridge } from './bridge';
import { listAlertRows, registerAlertRow, resolveRowAccent, resolveRowIcon, resolveRowSummary } from './registry';
import { areAlertSoundsOn, clampCardSize, getAlertRowSettings, getRowCardSize, writeAlertRowSettings, writeAlertSoundsOn, writeRowCardSize } from './settings';

export { closeAllAlertCards, isAlertCardOpen, MAX_CHIPS, MAX_SPRITES, playAlertRowSound, raiseAlert, setAlertPresenter } from './raise';
export type {
  AlertCardHandle,
  AlertCardPatch,
  AlertChip,
  AlertFigure,
  AlertMeter,
  AlertPayload,
  AlertPresenter,
  AlertSprite,
  RaiseOptions,
} from './raise';
export { getBridgedRowId, HARVEST_ROW, LOCKER_ROW, VERSION_ROW } from './bridge';
export { getAlertRow, listAlertRows, registerAlertRow, resolveRowAccent, resolveRowIcon, resolveRowLabel, resolveRowSummary } from './registry';
export type { AlertGroup, AlertRowDef } from './registry';
export { ALERT_CARD_SIZE, areAlertSoundsOn, getAlertRowSettings, getRowCardSize, isDesktopOn, isRowDesktop } from './settings';
export type { AlertRowSettings } from './settings';
export {
  deliverDesktopAlert,
  getDesktopAvailability,
  getDesktopState,
  requestDesktopPermission,
  setDesktopOn,
  setRowDesktop,
} from './desktop';
export type { DesktopAlert, DesktopAvailability, DesktopDropReason } from './desktop';

let started = false;

const TEST_ROW_ID = 'qpm.alertTest';

/** Turning sounds off also stops every running alert loop (restock, bag-full). */
export function setAlertSoundsOn(on: boolean): void {
  writeAlertSoundsOn(on);
  if (!on) stopAllLoops();
}

export function setAlertRowEnabled(id: string, enabled: boolean): void {
  const def = listAlertRows().find((r) => r.id === id);
  writeAlertRowSettings(id, { ...getAlertRowSettings(id, def?.defaultSound ?? 'none', def?.defaultEnabled), enabled });
}

export function setAlertRowSound(id: string, soundId: string): void {
  const def = listAlertRows().find((r) => r.id === id);
  writeAlertRowSettings(id, { ...getAlertRowSettings(id, def?.defaultSound ?? 'none', def?.defaultEnabled), soundId });
}

/** Stores the row's card size and resizes its open cards; returns the stored (clamped) size. */
export function setAlertRowCardSize(id: string, size: number): number {
  const def = listAlertRows().find((r) => r.id === id);
  const next = writeRowCardSize(id, size, getAlertRowSettings(id, def?.defaultSound ?? 'none', def?.defaultEnabled));
  resizeHubCards(id, next);
  return next;
}

/** Resizes the row's open cards without storing (slider drag). */
export function previewAlertRowCardSize(id: string, size: number): void {
  resizeHubCards(id, clampCardSize(size));
}

export function startAlertHub(): void {
  if (started) return;
  started = true;
  setAlertPresenter(presentHubCard);
  startAlertBridge();
}

export function stopAlertHub(): void {
  if (!started) return;
  started = false;
  stopAlertBridge();
  setAlertPresenter(null);
  closeAllAlertCards();
  closeAllHubCards();
}

/** Debug: raises the test row once (card, sound, History) and leaves the row's stored on/off as it was. */
export function testAlertHub(): AlertCardHandle | null {
  registerAlertRow({ id: TEST_ROW_ID, group: 'qpm', labelKey: 'feature.alertHub.test.label', defaultSound: 'chime' });
  const wasOn = getAlertRowSettings(TEST_ROW_ID, 'chime').enabled;
  if (!wasOn) setAlertRowEnabled(TEST_ROW_ID, true);
  try {
    return raiseAlert(TEST_ROW_ID, {
      title: t('feature.alertHub.test.title'),
      body: t('feature.alertHub.test.body'),
      actions: [{ label: t('common.close'), onClick: () => { /* closing is the action */ } }],
    });
  } finally {
    if (!wasOn) setAlertRowEnabled(TEST_ROW_ID, false);
  }
}

export function getAlertHubState(): {
  started: boolean;
  soundsOn: boolean;
  rows: Array<{ id: string; group: string; enabled: boolean; soundId: string; cardSize: number; icon: boolean; summary: string | null; accent: string | null }>;
  raise: ReturnType<typeof getRaiseStats>;
  hubCards: number;
  soundGate: ReturnType<typeof getSoundGateStats>;
  bridge: ReturnType<typeof getAlertBridgeStats>;
} {
  return {
    started,
    soundsOn: areAlertSoundsOn(),
    rows: listAlertRows().map((r) => ({
      id: r.id,
      group: r.group,
      ...getAlertRowSettings(r.id, r.defaultSound, r.defaultEnabled),
      cardSize: getRowCardSize(r.id),
      icon: resolveRowIcon(r) !== null,
      summary: resolveRowSummary(r),
      accent: resolveRowAccent(r),
    })),
    raise: getRaiseStats(),
    hubCards: getHubCardCount(),
    soundGate: getSoundGateStats(),
    bridge: getAlertBridgeStats(),
  };
}
