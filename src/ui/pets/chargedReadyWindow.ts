import { getAlertRow, resolveRowLabel } from '../../features/alertHub';
import { getAllAbilityProjections } from '../../features/chargedAbilities/abilities';
import { chargedReadyRowId } from '../../features/chargedAbilities/readyAlarm';
import {
  CHARGED_READY_MAX_INTERVAL_SEC,
  CHARGED_READY_MIN_INTERVAL_SEC,
  getChargedReadyIntervalSec,
  isChargedReadyRepeatOn,
  setChargedReadyIntervalSec,
  setChargedReadyRepeat,
} from '../../features/chargedAbilities/readySettings';
import { t } from '../../i18n';
import { createNumberInput, createToggle } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { mountAlertSettings } from '../alertCentre/settingsShell';

export const CHARGED_READY_WINDOW_ID = 'qpm-charged-ready-alarm';

const NOTE_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';

function renderChargedReady(root: HTMLElement, headAbilityId: string): () => void {
  const headRow = getAlertRow(chargedReadyRowId(headAbilityId));
  const shell = mountAlertSettings(root, headRow ? resolveRowLabel(headRow) : t('feature.chargedReady.windowTitle'), headRow);
  for (const ability of getAllAbilityProjections()) {
    const body = shell.addSection(ability.abilityName, getAlertRow(chargedReadyRowId(ability.abilityId)));
    const toggle = createToggle({
      checked: isChargedReadyRepeatOn(ability.abilityId),
      label: t('feature.chargedReady.repeatLabel'),
      onChange: (on) => {
        setChargedReadyRepeat(ability.abilityId, on);
        shell.refresh();
      },
    });
    toggle.input.setAttribute('aria-label', t('feature.chargedReady.repeatAria', { ability: ability.abilityName }));
    body.append(toggle.root);
  }

  const intervalBody = shell.addSection(t('feature.chargedReady.intervalLabel'));
  const interval = createNumberInput({
    min: CHARGED_READY_MIN_INTERVAL_SEC,
    max: CHARGED_READY_MAX_INTERVAL_SEC,
    value: getChargedReadyIntervalSec(),
    label: t('feature.chargedReady.intervalLabel'),
    suffix: t('feature.chargedReady.intervalSuffix'),
    onChange: (v) => {
      setChargedReadyIntervalSec(Math.round(v));
      shell.refresh();
    },
  });
  // The component's <label> is not tied to its input.
  interval.input.setAttribute('aria-label', t('feature.chargedReady.intervalAria'));
  const note = document.createElement('div');
  note.style.cssText = NOTE_CSS;
  note.textContent = t('feature.chargedReady.repeatNote');
  intervalBody.append(interval.root, note);
  return shell.destroy;
}

/** Opened from a charged-ability row's Settings; that row's look heads the window. */
export function openChargedReadyWindow(abilityId: string): void {
  if (isWindowOpen(CHARGED_READY_WINDOW_ID)) {
    closeWindow(CHARGED_READY_WINDOW_ID);
    return;
  }
  destroyWindow(CHARGED_READY_WINDOW_ID);
  openWindow(CHARGED_READY_WINDOW_ID, t('feature.chargedReady.windowTitle'), (root) => renderChargedReady(root, abilityId), '400px', '60vh');
}
