import { clearNotifications, onNotifications, type NotificationEvent, type NotificationLevel } from '../../core/notifications';
import {
  getAlertRow,
  getBridgedRowId,
  listAlertRows,
  resolveRowAccent,
  resolveRowIcon,
  resolveRowLabel,
  type AlertGroup,
  type AlertRowDef,
} from '../../features/alertHub';
import { t } from '../../i18n';
import { onSpritesReady } from '../../sprite-v2/compat';
import { HYDRATION_EVENT } from '../../sprite-v2/service/constants';
import { createButton, createEmptyState, createPillTabs } from '../components';
import { createIconBox } from '../shop/restockAlerts/cardShell';
import { ensureCentreStyles, letterBox } from './rowCard';

type Filter = 'all' | AlertGroup;

const STYLE_ID = 'qpm-alert-centre-history-style';
const FIXED_FILTERS: readonly Filter[] = ['all', 'pets', 'garden', 'shops', 'qpm'];
const LEVEL_COLOR: Record<Exclude<NotificationLevel, 'info'>, string> = {
  success: 'var(--qpm-positive)',
  warn: 'var(--qpm-warning)',
  error: 'var(--qpm-danger)',
};

const CSS = [
  '.qpm-alert-centre-history__toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:6px;}',
  '.qpm-alert-centre-history{align-items:flex-start;}',
  '.qpm-alert-centre-history .qpm-alert-card__icon{width:32px;height:32px;}',
  '.qpm-alert-centre-history .qpm-alert-card__icon img{width:26px;height:26px;}',
  '.qpm-alert-centre-history__body{font-size:var(--qpm-font-body);line-height:1.35;color:var(--qpm-text-muted);word-break:break-word;}',
  '.qpm-alert-centre-history__meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;}',
  '.qpm-alert-centre-history__time{font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);font-variant-numeric:tabular-nums;}',
  '.qpm-alert-centre-history__tags{display:flex;align-items:center;gap:6px;}',
  '.qpm-alert-centre-history__dot{width:8px;height:8px;border-radius:var(--qpm-radius-pill);background:var(--qpm-level-color);}',
].join('');

function ensureHistoryStyles(): void {
  ensureCentreStyles();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function div(className: string, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rowOf(e: NotificationEvent): AlertRowDef | null {
  return getAlertRow(getBridgedRowId(e.feature) ?? e.feature);
}

// Plain notify() messages from QPM features (no alert row) file under QPM (user 2026-11-16).
const groupOf = (row: AlertRowDef | null): AlertGroup => row?.group ?? 'qpm';
const groupLabel = (g: AlertGroup): string => t(`feature.alertCentre.group.${g}`);

function entry(e: NotificationEvent, row: AlertRowDef | null): HTMLElement {
  const group = groupOf(row);
  const source = row ? resolveRowLabel(row) : e.feature;
  const card = div('qpm-alert-centre-card qpm-alert-centre-history');
  card.dataset.qpmAlertHistoryEntry = group;
  card.dataset.qpmAlertHistoryLevel = e.level;
  card.style.setProperty('--qpm-alert-color', resolveRowAccent(row) ?? 'var(--qpm-accent)');

  const icon = e.iconUrl ?? resolveRowIcon(row);
  const text = div('qpm-alert-centre-card__text');
  const body = e.title ? e.body : e.message;
  text.append(div('qpm-alert-centre-card__name', e.title ?? source));
  if (body) text.append(div('qpm-alert-centre-history__body', body));

  const time = div('qpm-alert-centre-history__time', new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const dot = div('qpm-alert-centre-history__dot');
  dot.style.setProperty('--qpm-level-color', e.level === 'info' ? 'var(--qpm-alert-color)' : LEVEL_COLOR[e.level]);
  const pill = document.createElement('span');
  pill.className = 'qpm-alert-card__chip';
  pill.style.setProperty('--qpm-chip-color', 'var(--qpm-text-muted)');
  pill.textContent = groupLabel(group);
  const tags = div('qpm-alert-centre-history__tags');
  tags.append(dot, pill);
  const meta = div('qpm-alert-centre-history__meta');
  meta.append(time, tags);

  card.append(icon ? createIconBox(icon, source, 'lg') : letterBox(source), text, meta);
  return card;
}

/** This session's `notify` buffer as cards, newest first, with group filters and Clear. Returns its cleanup. */
export function renderHistoryTab(container: HTMLElement): () => void {
  ensureHistoryStyles();
  let filter: Filter = 'all';
  let events: NotificationEvent[] = [];
  let pillsKey = '';

  const toolbar = div('qpm-alert-centre-history__toolbar');
  let pills: HTMLElement = document.createElement('div');
  const clear = createButton(t('feature.alertCentre.history.clear'), { variant: 'secondary', size: 'sm', onClick: () => { clearNotifications(); } });
  toolbar.append(pills, clear);
  const list = document.createElement('div');
  list.dataset.qpmAlertHistory = '';
  container.append(toolbar, list);

  // Room has no alert until ALR-12.2; its pill appears once one is registered (user 2026-11-16).
  const filters = (): Filter[] => (listAlertRows().some((r) => r.group === 'room') ? [...FIXED_FILTERS, 'room'] : [...FIXED_FILTERS]);

  // createPillTabs paints the active pill only at creation, so a changed selection re-creates the row.
  const renderPills = (available: Filter[]): void => {
    const key = `${available.join('|')}#${filter}`;
    if (key === pillsKey) return;
    pillsKey = key;
    const labels = available.map((f) => (f === 'all' ? 'feature.alertCentre.history.all' : `feature.alertCentre.group.${f}`));
    const next = createPillTabs(labels, available.indexOf(filter), (i) => {
      filter = available[i] ?? 'all';
      render();
    });
    next.dataset.qpmAlertHistoryFilters = '';
    pills.replaceWith(next);
    pills = next;
  };

  const render = (): void => {
    const available = filters();
    if (!available.includes(filter)) filter = 'all';
    renderPills(available);
    clear.disabled = events.length === 0;
    const shown = [...events].reverse()
      .map((e) => ({ e, row: rowOf(e) }))
      .filter(({ row }) => filter === 'all' || groupOf(row) === filter);
    if (shown.length === 0) {
      const message = filter === 'all'
        ? t('feature.alertCentre.history.empty')
        : t('feature.alertCentre.history.emptyGroup', { group: groupLabel(filter) });
      list.replaceChildren(createEmptyState(message));
      return;
    }
    list.replaceChildren(...shown.map(({ e, row }) => entry(e, row)));
  };

  const cleanups: Array<() => void> = [];
  cleanups.push(onNotifications((next) => {
    events = next;
    render();
  }));
  // Row-icon fallbacks: the atlas loads after the centre can open, and Rive pets hydrate per species.
  window.addEventListener(HYDRATION_EVENT, render);
  cleanups.push(() => { window.removeEventListener(HYDRATION_EVENT, render); });
  cleanups.push(onSpritesReady(render));
  return () => { for (const fn of cleanups) fn(); };
}
