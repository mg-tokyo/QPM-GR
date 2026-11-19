import { getAlertRow } from '../../features/alertHub';
import { EGG_READY_MAX_LEAD_MINUTES, EGG_READY_ROW, getEggReadyLeadMinutes, setEggReadyLeadMinutes } from '../../features/garden/eggReady';
import { t } from '../../i18n';
import { createNumberInput } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { mountAlertSettings } from '../alertCentre/settingsShell';

export const EGG_READY_WINDOW_ID = 'qpm-egg-ready-alarm';

function renderEggReady(root: HTMLElement): () => void {
  const shell = mountAlertSettings(root, t('feature.eggReady.windowTitle'), getAlertRow(EGG_READY_ROW));
  const body = shell.addSection(t('feature.eggReady.leadLabel'));
  const lead = createNumberInput({
    min: 0,
    max: EGG_READY_MAX_LEAD_MINUTES,
    value: getEggReadyLeadMinutes(),
    label: t('feature.eggReady.leadLabel'),
    suffix: t('feature.eggReady.leadSuffix'),
    onChange: (v) => {
      setEggReadyLeadMinutes(Math.round(v));
      shell.refresh();
    },
  });
  // The component's <label> is not tied to its input.
  lead.input.setAttribute('aria-label', t('feature.eggReady.leadAria'));
  const note = document.createElement('div');
  note.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
  note.textContent = t('feature.eggReady.leadNote');
  body.append(lead.root, note);
  return shell.destroy;
}

export function openEggReadyWindow(): void {
  if (isWindowOpen(EGG_READY_WINDOW_ID)) {
    closeWindow(EGG_READY_WINDOW_ID);
    return;
  }
  destroyWindow(EGG_READY_WINDOW_ID);
  openWindow(EGG_READY_WINDOW_ID, t('feature.eggReady.windowTitle'), renderEggReady, '400px', '40vh');
}
