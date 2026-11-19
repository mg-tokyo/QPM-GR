import { getAlertRow } from '../../features/alertHub';
import { getNightfallLeadMinutes, NIGHTFALL_ALARM_ROW, NIGHTFALL_MAX_LEAD_MINUTES, setNightfallLeadMinutes } from '../../features/nightfallAlarm';
import { t } from '../../i18n';
import { createNumberInput } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { mountAlertSettings } from '../alertCentre/settingsShell';

export const NIGHTFALL_ALARM_WINDOW_ID = 'qpm-nightfall-alarm';

function renderNightfallAlarm(root: HTMLElement): () => void {
  const shell = mountAlertSettings(root, t('feature.nightfallAlarm.windowTitle'), getAlertRow(NIGHTFALL_ALARM_ROW));
  const body = shell.addSection(t('feature.nightfallAlarm.leadLabel'));
  const lead = createNumberInput({
    min: 0,
    max: NIGHTFALL_MAX_LEAD_MINUTES,
    value: getNightfallLeadMinutes(),
    label: t('feature.nightfallAlarm.leadLabel'),
    suffix: t('feature.nightfallAlarm.leadSuffix'),
    onChange: (v) => {
      setNightfallLeadMinutes(Math.round(v));
      shell.refresh();
    },
  });
  // The component's <label> is not tied to its input.
  lead.input.setAttribute('aria-label', t('feature.nightfallAlarm.leadAria'));
  const note = document.createElement('div');
  note.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
  note.textContent = t('feature.nightfallAlarm.leadNote');
  body.append(lead.root, note);
  return shell.destroy;
}

export function openNightfallAlarmWindow(): void {
  if (isWindowOpen(NIGHTFALL_ALARM_WINDOW_ID)) {
    closeWindow(NIGHTFALL_ALARM_WINDOW_ID);
    return;
  }
  destroyWindow(NIGHTFALL_ALARM_WINDOW_ID);
  openWindow(NIGHTFALL_ALARM_WINDOW_ID, t('feature.nightfallAlarm.windowTitle'), renderNightfallAlarm, '400px', '40vh');
}
