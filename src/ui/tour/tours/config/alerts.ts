import { t } from '../../../../i18n';
import { ALERT_CENTRE_WINDOW_ID, openAlertCentre } from '../../../alertCentre';
import { getWindow, isWindowOpen } from '../../../core/modalWindow';
import type { TourDefinition } from '../../types';

// Set when the offer step shows this session. A resumed tour (the window was closed mid-tour) must not open
// the centre on page load by itself.
let offered = false;

function alertsPane(): HTMLElement | null {
  return getWindow(ALERT_CENTRE_WINDOW_ID)?.body.querySelector<HTMLElement>('[data-qpm-alert-centre-tab="alerts"]') ?? null;
}

function launcherCard(panel: HTMLElement): HTMLElement | null {
  const label = t('hub.card.openLabel', { label: t('feature.alertCentre.card.label') });
  return panel.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`);
}

export const alertsTour: TourDefinition = {
  windowId: 'alerts',
  label: 'Alerts',
  category: 'config',
  version: 1,
  steps: [
    {
      id: 'offer',
      resolve: (body) => {
        offered = true;
        return body.closest<HTMLElement>('.qpm-panel') ?? body;
      },
      title: 'Pick your alerts',
      body: 'QPM alerts start off. Press Next to choose the ones you want.',
      placement: 'right',
    },
    {
      id: 'pick',
      resolve: () => {
        if (!isWindowOpen(ALERT_CENTRE_WINDOW_ID)) {
          if (!offered) return null;
          openAlertCentre();
        }
        return alertsPane();
      },
      title: 'Switch on what you want',
      body: 'Each alert stays off until you switch it on. Pick a sound for each, or none.',
      // Beside the list, not over it: the auto pick landed on the rows' sound selects.
      placement: 'right',
    },
    {
      id: 'desktop',
      // The switch itself: clicking it asks the browser's permission (ALR-13 PD3); Next skips.
      resolve: () => alertsPane()?.querySelector<HTMLElement>('[data-qpm-alert-centre-desktop] [role="switch"]') ?? null,
      title: 'Desktop notifications',
      body: 'Get alerts on your desktop while the game tab is in the background. Switch it on to be asked by your browser, or press Next.',
      placement: 'bottom',
    },
    {
      id: 'launcher',
      resolve: (body) => {
        const panel = body.closest<HTMLElement>('.qpm-panel') ?? body;
        const card = launcherCard(panel);
        if (card && card.offsetParent !== null) return card;
        return isWindowOpen(ALERT_CENTRE_WINDOW_ID) ? (getWindow(ALERT_CENTRE_WINDOW_ID)?.head ?? null) : null;
      },
      title: 'Change them anytime',
      body: 'Open Alerts again from QPM → Config.',
    },
  ],
};
