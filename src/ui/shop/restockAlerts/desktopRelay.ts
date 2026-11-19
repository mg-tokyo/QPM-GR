import { deliverDesktopAlert } from '../../../features/alertHub/desktop';
import { t } from '../../../i18n';
import { upsertAlert } from './alertDom';
import { activeAlerts } from './alertState';
import { PIN_ROW_ID } from './cardSize';
import type { AlertModel } from './types';

/** ALR-13 PD2: one Desktop tick on the linked restock row covers every pinned item and weather card. */
export const PIN_DESKTOP_ROW = PIN_ROW_ID;

/** The card's own lines: title, then item and stock line in the body. */
export function pinDesktopText(model: AlertModel): { title: string; body: string } {
  if (model.isWeatherAlert) {
    const stock = model.weatherDurationMs
      ? t('feature.restockAlert.minEvent', { min: Math.round(model.weatherDurationMs / 60_000) })
      : t('feature.restockAlert.activeNow');
    return { title: t('feature.restockAlert.weatherActive'), body: `${model.label}\n${stock}` };
  }
  const journalOnly = model.journal !== undefined && !model.journal.pinned;
  const lines = [model.label, t('feature.restockAlert.available', { qty: model.quantity })];
  if (model.journal) lines.push(model.journal.line);
  return {
    title: journalOnly ? t('feature.restockAlert.journalSeedInStock') : t('feature.restockAlert.pinnedRestocked'),
    body: lines.join('\n'),
  };
}

/** Only a card that did not exist before reaches the desktop; quantity updates of an open card do not. */
export function upsertAlertWithDesktop(model: AlertModel): void {
  const isNew = !activeAlerts.has(model.key);
  upsertAlert(model);
  if (!isNew || !activeAlerts.has(model.key)) return;
  // A journal-only card follows its own centre row's Desktop tick (ALR-16.4).
  const rowId = model.journal && !model.journal.pinned ? model.journal.rowId : PIN_DESKTOP_ROW;
  deliverDesktopAlert(rowId, { ...pinDesktopText(model), tag: model.key });
}
