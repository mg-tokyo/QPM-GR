import { t } from '../../../i18n';
import type { AlertCardHandle, AlertMeter, AlertPresenter } from '../../../features/alertHub/raise';
import { getAlertRow } from '../../../features/alertHub/registry';
import { ensureAlertStyles, getAlertRoot, removeAlertRootIfEmpty } from './alertDom';
import { hubCards } from './alertState';
import { ALERT_EXIT_MS } from './types';

const MAX_ACTIONS = 2;
const closers = new Set<() => void>();

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

// Smooth scaling: the restock __icon class is pixelated, which QPM no longer uses for sprites.
function iconShell(src: string, alt: string): HTMLDivElement {
  const shell = div('qpm-restock-alert__icon-shell');
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.decoding = 'async';
  Object.assign(img.style, { width: '26px', height: '26px', objectFit: 'contain' });
  shell.append(img);
  return shell;
}

// Floating pet card hunger bar (src/ui/pets/floatingCard/styles.ts:91-102), on tokens.
function meterBar(): { track: HTMLDivElement; set(m: AlertMeter): void } {
  const track = div('qpm-alert-meter');
  Object.assign(track.style, { height: '5px', borderRadius: '4px', overflow: 'hidden', background: 'var(--qpm-surface-3)' });
  const fill = document.createElement('div');
  Object.assign(fill.style, { height: '100%', borderRadius: '4px', transition: 'width 0.15s ease' });
  track.append(fill);
  return {
    track,
    set(m) {
      fill.style.width = `${Math.max(0, Math.min(100, m.pct))}%`;
      fill.style.background = m.color;
    },
  };
}

function button(className: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  return b;
}

/** Alert-hub presenter: a card on the restock stack, styled by the restock classes. */
export const presentHubCard: AlertPresenter = (card) => {
  ensureAlertStyles();
  const el = div('qpm-restock-alert');
  el.dataset.qpmAlertRow = card.rowId;

  const top = div('qpm-restock-alert__top');
  const identity = div('qpm-restock-alert__identity');
  const titleWrap = div('qpm-restock-alert__title-wrap');
  const def = getAlertRow(card.rowId);
  if (def) {
    const caption = div('qpm-restock-alert__title');
    caption.textContent = t(def.labelKey);
    titleWrap.append(caption);
  }
  const titleEl = div('qpm-restock-alert__item');
  titleEl.textContent = card.title;
  titleWrap.append(titleEl);
  if (card.iconUrl) identity.append(iconShell(card.iconUrl, card.title));
  identity.append(titleWrap);
  const closeBtn = button('qpm-restock-alert__close', 'x');
  closeBtn.title = t('common.close');
  top.append(identity, closeBtn);

  const bodyEl = div('qpm-restock-alert__qty');
  const meter = card.meter ? meterBar() : null;
  const update = (body: string, next?: AlertMeter): void => {
    bodyEl.textContent = body;
    bodyEl.style.display = body ? '' : 'none';
    if (meter && next) meter.set(next);
  };
  update(card.body ?? '', card.meter);
  el.append(top, bodyEl);
  if (meter) el.append(meter.track);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    closers.delete(close);
    hubCards.delete(el);
    el.classList.add('qpm-restock-alert--exit');
    let removed = false;
    const cleanup = (): void => {
      if (removed) return;
      removed = true;
      el.remove();
      removeAlertRootIfEmpty();
    };
    el.addEventListener('animationend', cleanup, { once: true });
    window.setTimeout(cleanup, ALERT_EXIT_MS + 50);
    card.onClose();
  };

  const actions = (card.actions ?? []).slice(0, MAX_ACTIONS);
  if (actions.length > 0) {
    const row = div('qpm-restock-alert__actions');
    actions.forEach((action, i) => {
      const b = button(i === 0 ? 'qpm-restock-alert__btn' : 'qpm-restock-alert__btn qpm-restock-alert__btn--ghost', action.label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        try { action.onClick(); } catch { /* the card still closes */ }
        close();
      });
      row.append(b);
    });
    el.append(row);
  }

  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  el.addEventListener('click', (e) => { e.stopPropagation(); });

  hubCards.add(el);
  closers.add(close);
  getAlertRoot().prepend(el);

  const handle: AlertCardHandle = { update, close };
  return handle;
};

export function closeAllHubCards(): void {
  for (const close of [...closers]) close();
}

export function getHubCardCount(): number {
  return hubCards.size;
}
