// Desktop notification controls (ALR-13.3): the master card under "Alert sounds" and the per-row "Desktop" tick.
// Delivery, permission and storage live in the hub (`features/alertHub/desktop.ts`).
import { getDesktopState, isRowDesktop, requestDesktopPermission, setDesktopOn, setRowDesktop } from '../../features/alertHub';
import { t } from '../../i18n';
import { getAnySpriteDataUrl, isSpritesReady } from '../../sprite-v2/compat';
import { createToggle } from '../components';
import { createIconBox } from '../shop/restockAlerts/cardShell';

// The toast-status sprite is in the newest beta; the bell (checked live 2026-11-16) stands in where it is missing.
const ICON = 'sprite/ui/ToastStatusAlertIcon';
const ICON_FALLBACK = 'sprite/ui/NotifierBellOn';
const OFF_COLOR = 'var(--qpm-text-muted)';

type DesktopView = 'on' | 'off' | 'blocked' | 'unavailable';

function currentView(): DesktopView {
  const s = getDesktopState();
  if (s.availability === 'unsupported') return 'unavailable';
  // Discord gets one attempt (ALR-13 D1); after it the surface reads as not available, not as a browser setting.
  if (s.availability === 'blocked') return s.discord ? 'unavailable' : 'blocked';
  return s.on && s.permission === 'granted' ? 'on' : 'off';
}

/** Ticks are live only while the master is on and the browser granted permission. */
export function isDesktopActive(): boolean {
  return currentView() === 'on';
}

function div(className: string, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface DesktopCard {
  root: HTMLElement;
  refresh(): void;
}

/**
 * Master switch: asks the browser on the click that turns it on, never on load. `tickedCount` counts the rows
 * shown with a tick; `onChange` runs after every switch so the row ticks re-read their greyed state.
 */
export function createDesktopCard(tickedCount: () => number, onChange: () => void): DesktopCard {
  const root = div('qpm-alert-centre-card qpm-alert-centre-master');
  root.dataset.qpmAlertCentreDesktop = '';
  const iconSlot = div('qpm-alert-centre-card__icon');
  const text = div('qpm-alert-centre-card__text');
  const summary = div('qpm-alert-centre-card__summary');
  text.append(div('qpm-alert-centre-card__name', t('feature.alertCentre.desktop.title')), summary);
  const state = div('qpm-alert-centre-master__state');
  let iconShown = false;

  const toggle = createToggle({
    size: 'large',
    onChange: (on) => {
      if (!on) {
        setDesktopOn(false);
        paint();
        onChange();
        return;
      }
      // Already granted resolves at once; `default` opens the browser's prompt from this click.
      void requestDesktopPermission().then((result) => {
        setDesktopOn(result === 'granted');
        paint();
        onChange();
      });
    },
  });
  toggle.input.setAttribute('aria-label', t('feature.alertCentre.desktop.title'));
  const controls = div('qpm-alert-centre-card__controls');
  controls.append(state, toggle.root);
  root.append(iconSlot, text, controls);

  function paint(): void {
    const view = currentView();
    const on = view === 'on';
    root.classList.toggle('qpm-alert-centre-card--on', on);
    root.dataset.qpmAlertCentreOn = String(on);
    root.dataset.qpmAlertCentreDesktopView = view;
    root.style.setProperty('--qpm-alert-color', on ? 'var(--qpm-info)' : OFF_COLOR);
    state.textContent = t(on ? 'feature.alertCentre.master.on' : 'feature.alertCentre.master.off');
    toggle.setChecked(on);
    toggle.setDisabled(view === 'blocked' || view === 'unavailable');
    summary.textContent =
      view === 'blocked' ? t('feature.alertCentre.desktop.blocked')
        : view === 'unavailable' ? t('feature.alertCentre.desktop.unavailable')
          : on ? t('feature.alertCentre.desktop.summaryOn', { count: tickedCount() })
            : t('feature.alertCentre.desktop.summaryOff');
    if (iconShown || !isSpritesReady()) return;
    const url = getAnySpriteDataUrl(ICON) || getAnySpriteDataUrl(ICON_FALLBACK);
    iconShown = url !== '';
    iconSlot.replaceChildren(url ? createIconBox(url, '', 'lg') : div('qpm-alert-card__icon'));
  }

  paint();
  return { root, refresh: paint };
}

/** The row's "Desktop" switch, greyed while the master is not on. Returns its node and a re-read. */
export function createDesktopTick(rowId: string, name: string, onChange: () => void): { root: HTMLElement; refresh(): void } {
  const toggle = createToggle({
    size: 'compact',
    label: t('feature.alertCentre.desktop.rowTick'),
    checked: isRowDesktop(rowId),
    onChange: (on) => {
      setRowDesktop(rowId, on);
      onChange();
    },
  });
  toggle.input.setAttribute('aria-label', t('feature.alertCentre.desktop.rowAria', { name }));
  toggle.root.dataset.qpmAlertCentreDesktopTick = rowId;
  const refresh = (): void => {
    const active = isDesktopActive();
    toggle.setChecked(isRowDesktop(rowId));
    toggle.setDisabled(!active);
    toggle.root.title = active ? '' : t('feature.alertCentre.desktop.rowTickOff');
  };
  refresh();
  return { root: toggle.root, refresh };
}
