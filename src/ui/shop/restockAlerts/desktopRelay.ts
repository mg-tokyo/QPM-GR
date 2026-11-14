import { deliverDesktopAlert } from '../../../features/alertHub/desktop';
import { t } from '../../../i18n';
import { upsertAlert } from './alertDom';
import { activeAlerts } from './alertState';
import type { AlertModel } from './types';

/** ALR-13 PD2: one Desktop tick on the linked restock row covers every pinned item and weather card. */
export const PIN_DESKTOP_ROW = 'linked.restock';

/** The card's own lines: title, then item and stock line in the body. */
export function pinDesktopText(model: AlertModel): { title: string; body: string } {
  if (model.isWeatherAlert) {
    const stock = model.weatherDurationMs
      ? t('feature.restockAlert.minEvent', { min: Math.round(model.weatherDurationMs / 60_000) })
      : t('feature.restockAlert.activeNow');
    return { title: t('feature.restockAlert.weatherActive'), body: `${model.label}\n${stock}` };
  }
  return {
    title: t('feature.restockAlert.pinnedRestocked'),
    body: `${model.label}\n${t('feature.restockAlert.available', { qty: model.quantity })}`,
  };
}

/** Only a card that did not exist before reaches the desktop; quantity updates of an open card do not. */
export function upsertAlertWithDesktop(model: AlertModel): void {
  const isNew = !activeAlerts.has(model.key);
  upsertAlert(model);
  if (!isNew || !activeAlerts.has(model.key)) return;
  deliverDesktopAlert(PIN_DESKTOP_ROW, { ...pinDesktopText(model), tag: model.key });
}
