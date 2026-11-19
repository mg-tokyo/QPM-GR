import { getAlertRow } from '../../features/alertHub';
import {
  getMaxStrLeadMinutes,
  MAX_STR_MAX_LEAD_MINUTES,
  MAX_STR_MIN_LEAD_MINUTES,
  MAX_STR_ROW,
  setMaxStrLeadMinutes,
} from '../../features/pets/maxStrAlarm';
import { t } from '../../i18n';
import { createNumberInput } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { mountAlertSettings } from '../alertCentre/settingsShell';

export const MAX_STR_ALARM_WINDOW_ID = 'qpm-max-str-alarm';

function renderMaxStrAlarm(root: HTMLElement): () => void {
  const shell = mountAlertSettings(root, t('feature.maxStrAlarm.windowTitle'), getAlertRow(MAX_STR_ROW));
  const body = shell.addSection(t('feature.maxStrAlarm.leadLabel'));
  const lead = createNumberInput({
    min: MAX_STR_MIN_LEAD_MINUTES,
    max: MAX_STR_MAX_LEAD_MINUTES,
    value: getMaxStrLeadMinutes(),
    label: t('feature.maxStrAlarm.leadLabel'),
    suffix: t('feature.maxStrAlarm.leadSuffix'),
    onChange: (v) => {
      setMaxStrLeadMinutes(Math.round(v));
      shell.refresh();
    },
  });
  // The component's <label> is not tied to its input.
  lead.input.setAttribute('aria-label', t('feature.maxStrAlarm.leadAria'));
  const note = document.createElement('div');
  note.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
  note.textContent = t('feature.maxStrAlarm.leadNote');
  body.append(lead.root, note);
  return shell.destroy;
}

export function openMaxStrAlarmWindow(): void {
  if (isWindowOpen(MAX_STR_ALARM_WINDOW_ID)) {
    closeWindow(MAX_STR_ALARM_WINDOW_ID);
    return;
  }
  destroyWindow(MAX_STR_ALARM_WINDOW_ID);
  openWindow(MAX_STR_ALARM_WINDOW_ID, t('feature.maxStrAlarm.windowTitle'), renderMaxStrAlarm, '400px', '40vh');
}
