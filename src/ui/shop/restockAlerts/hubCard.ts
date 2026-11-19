import { t } from '../../../i18n';
import type { AlertCardHandle, AlertCardPatch, AlertPresenter } from '../../../features/alertHub/raise';
import { getAlertRow, resolveRowIcon, resolveRowLabel, type AlertRowDef } from '../../../features/alertHub/registry';
import { getRowCardSize } from '../../../features/alertHub/settings';
import { createButton, createProgressBar } from '../../components';
import { ensureAlertStyles, getAlertRoot, removeAlertRootIfEmpty } from './alertDom';
import { hubCards } from './alertState';
import { applyCardColor, applyCardScale, createIconBox, createMetaRow, createSpriteStrip, el, ensureCardShellStyles } from './cardShell';
import { ALERT_EXIT_MS } from './types';

const MAX_ACTIONS = 2;
const closers = new Set<() => void>();

function caption(def: AlertRowDef): string {
  return `${t(`feature.alertCentre.group.${def.group}`)} · ${resolveRowLabel(def)}`;
}

/** Alert-hub presenter: a card on the shared alert stack, drawn by the card shell. */
export const presentHubCard: AlertPresenter = (card) => {
  ensureAlertStyles();
  ensureCardShellStyles();
  const root = el('div', 'qpm-alert-card');
  root.dataset.qpmAlertRow = card.rowId;
  applyCardColor(root, card.accent, card.level);
  applyCardScale(root, getRowCardSize(card.rowId));

  const def = getAlertRow(card.rowId);
  const top = el('div', 'qpm-alert-card__top');
  const iconUrl = card.iconUrl ?? resolveRowIcon(def);
  if (iconUrl) top.append(createIconBox(iconUrl, card.title, 'lg'));
  const text = el('div', 'qpm-alert-card__text');
  if (def) {
    const cap = el('div', 'qpm-alert-card__caption');
    cap.textContent = caption(def);
    text.append(cap);
  }
  const titleEl = el('div', 'qpm-alert-card__title');
  titleEl.textContent = card.title;
  titleEl.title = card.title;
  const bodyEl = el('div', 'qpm-alert-card__body');
  text.append(titleEl, bodyEl);
  const closeBtn = el('button', 'qpm-alert-card__close');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.title = t('common.close');
  top.append(text, closeBtn);
  root.append(top);

  if (card.sprites && card.sprites.length > 0) root.append(createSpriteStrip(card.sprites, card.title));
  const meta = createMetaRow();
  root.append(meta.row);
  const meter = card.meter ? createProgressBar({ value: card.meter.pct, max: 100, color: card.meter.color, height: 5, className: 'qpm-alert-meter' }) : null;
  if (meter) root.append(meter.root);

  const update = (patch: AlertCardPatch): void => {
    if (patch.body !== undefined) {
      bodyEl.textContent = patch.body;
      bodyEl.style.display = patch.body ? '' : 'none';
    }
    if (meter && patch.meter) {
      meter.update(patch.meter.pct);
      meter.setColor(patch.meter.color);
    }
    if (patch.chips) meta.setChips(patch.chips);
    if (patch.figure) meta.setFigure(patch.figure);
  };
  update({
    body: card.body ?? '',
    ...(card.chips ? { chips: card.chips } : {}),
    ...(card.figure ? { figure: card.figure } : {}),
  });

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    closers.delete(close);
    hubCards.delete(root);
    meta.dispose();
    root.classList.add('qpm-alert-card--exit');
    let removed = false;
    const cleanup = (): void => {
      if (removed) return;
      removed = true;
      root.remove();
      removeAlertRootIfEmpty();
    };
    root.addEventListener('animationend', cleanup, { once: true });
    window.setTimeout(cleanup, ALERT_EXIT_MS + 50);
    card.onClose();
  };

  const actions = (card.actions ?? []).slice(0, MAX_ACTIONS);
  if (actions.length > 0) {
    const row = el('div', 'qpm-alert-card__actions');
    actions.forEach((action, i) => {
      const b = createButton(action.label, { variant: i === 0 ? 'tonal' : 'ghost', size: 'sm' });
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        try { action.onClick(); } catch { /* the card still closes */ }
        if (!action.keepOpen) close();
      });
      row.append(b);
    });
    root.append(row);
  }

  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  root.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  root.addEventListener('click', (e) => { e.stopPropagation(); });

  hubCards.add(root);
  closers.add(close);
  getAlertRoot().prepend(root);

  const handle: AlertCardHandle = { update, close };
  return handle;
};

export function closeAllHubCards(): void {
  for (const close of [...closers]) close();
}

/** Live resize while the centre's Card size slider moves. */
export function resizeHubCards(rowId: string, scale: number): void {
  for (const card of hubCards) {
    if (card.dataset.qpmAlertRow === rowId) applyCardScale(card, scale);
  }
}

export function getHubCardCount(): number {
  return hubCards.size;
}
