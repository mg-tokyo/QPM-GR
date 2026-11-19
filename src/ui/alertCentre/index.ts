import { t } from '../../i18n';
import { createTabBar } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { renderAlertsTab } from './alertsTab';
import { renderHistoryTab } from './historyTab';

export const ALERT_CENTRE_WINDOW_ID = 'qpm-alert-centre';

function renderAlertCentre(root: HTMLElement): () => void {
  root.style.cssText = 'display:flex;flex-direction:column;gap:12px;flex:1;min-height:0;padding:12px;';
  const alerts = document.createElement('div');
  const history = document.createElement('div');
  alerts.dataset.qpmAlertCentreTab = 'alerts';
  history.dataset.qpmAlertCentreTab = 'history';
  for (const pane of [alerts, history]) pane.style.cssText = 'flex:1;min-height:0;overflow-y:auto;';

  const show = (id: string): void => {
    alerts.style.display = id === 'alerts' ? '' : 'none';
    history.style.display = id === 'history' ? '' : 'none';
  };
  const tabs = createTabBar(
    [{ id: 'alerts', label: t('feature.alertCentre.tab.alerts') }, { id: 'history', label: t('feature.alertCentre.tab.history') }],
    { defaultTab: 'alerts', onChange: show },
  );
  root.append(tabs.root, alerts, history);
  show(tabs.getActive());

  const cleanups = [renderAlertsTab(alerts), renderHistoryTab(history)];
  return () => { for (const fn of cleanups) fn(); };
}

export function openAlertCentre(): void {
  if (isWindowOpen(ALERT_CENTRE_WINDOW_ID)) {
    closeWindow(ALERT_CENTRE_WINDOW_ID);
    return;
  }
  // Close ran the content cleanup; re-showing the hidden window would keep dead subscriptions.
  destroyWindow(ALERT_CENTRE_WINDOW_ID);
  openWindow(ALERT_CENTRE_WINDOW_ID, t('feature.alertCentre.title'), renderAlertCentre, '640px', '80vh');
}
