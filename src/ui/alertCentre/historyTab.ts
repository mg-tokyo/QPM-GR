import { clearNotifications, onNotifications, type NotificationEvent } from '../../core/notifications';
import { getAlertRow, getBridgedRowId } from '../../features/alertHub';
import { t } from '../../i18n';
import { createButton, createEmptyState } from '../components';

const LEVEL_COLOR: Record<NotificationEvent['level'], string> = {
  info: 'var(--qpm-text-muted)',
  success: 'var(--qpm-positive)',
  warn: 'var(--qpm-warning)',
  error: 'var(--qpm-danger)',
};

function sourceName(feature: string): string {
  const row = getAlertRow(getBridgedRowId(feature) ?? feature);
  return row ? t(row.labelKey) : feature;
}

function entry(e: NotificationEvent): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--qpm-border);font-size:var(--qpm-font-caption);';
  const time = document.createElement('span');
  time.style.cssText = 'flex:none;color:var(--qpm-text-muted);font-variant-numeric:tabular-nums;';
  time.textContent = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const source = document.createElement('span');
  source.style.cssText = `flex:none;max-width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${LEVEL_COLOR[e.level]};`;
  source.textContent = sourceName(e.feature);
  const text = document.createElement('span');
  text.style.cssText = 'flex:1;min-width:0;color:var(--qpm-text);word-break:break-word;';
  text.textContent = e.message;
  row.append(time, source, text);
  return row;
}

/** This session's `notify` buffer, newest first, with Clear. Returns its cleanup. */
export function renderHistoryTab(container: HTMLElement): () => void {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;justify-content:flex-end;padding-bottom:8px;';
  const clear = createButton(t('feature.alertCentre.history.clear'), { variant: 'secondary', size: 'sm', onClick: () => { clearNotifications(); } });
  bar.append(clear);
  const list = document.createElement('div');
  list.dataset.qpmAlertHistory = '';
  container.append(bar, list);

  return onNotifications((events) => {
    clear.disabled = events.length === 0;
    if (events.length === 0) {
      list.replaceChildren(createEmptyState(t('feature.alertCentre.history.empty')));
      return;
    }
    list.replaceChildren(...[...events].reverse().map(entry));
  });
}
