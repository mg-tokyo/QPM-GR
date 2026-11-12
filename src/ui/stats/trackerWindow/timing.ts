import { t } from '../../../i18n';

function formatAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - ts;
  if (ms < 5000) return t('feature.abilityTracker.justNow');
  if (ms < 60000) return t('feature.abilityTracker.secsAgo', { n: String(Math.floor(ms / 1000)) });
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return t('feature.abilityTracker.minsAgo', { n: String(mins) });
  const hrs = Math.floor(mins / 60);
  return t('feature.abilityTracker.hoursMinAgo', { h: String(hrs), m: String(mins % 60) });
}

/** Format the average interval between procs (shown when no history yet). */
function formatAvgInterval(procsPerHour: number): string {
  if (procsPerHour <= 0) return '—';
  const avgMins = 60 / procsPerHour;
  if (avgMins >= 60) {
    const h = Math.floor(avgMins / 60);
    const m = Math.round(avgMins % 60);
    return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
  }
  if (avgMins >= 1) return `~${Math.round(avgMins)}m`;
  return `~${Math.round(avgMins * 60)}s`;
}

/**
 * Exported utility kept for API compatibility.
 */
export function calculateLiveETA(
  lastProcAt: number,
  expectedMinutesBetween: number | null,
  effectiveProcsPerHour?: number,
): { text: string; isOverdue: boolean } {
  const minutesBetween = effectiveProcsPerHour
    ? effectiveProcsPerHour > 0 ? 60 / effectiveProcsPerHour : null
    : expectedMinutesBetween;
  if (!minutesBetween || minutesBetween <= 0) return { text: '—', isOverdue: false };
  const expectedNextProc = lastProcAt + minutesBetween * 60 * 1000;
  const msRemaining = expectedNextProc - Date.now();
  const abs = Math.abs(msRemaining);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const prefix = msRemaining < 0 ? '-' : '';
  const text = h > 0 ? `${prefix}${h}h ${m}m` : m > 0 ? `${prefix}${m}m ${s}s` : `${prefix}${s}s`;
  return { text, isOverdue: msRemaining < 0 };
}

export function updateTimerCell(el: HTMLElement): void {
  const lastProc = el.dataset.lastProc ? parseInt(el.dataset.lastProc, 10) : null;
  const procsPerHour = el.dataset.procsPerHour ? parseFloat(el.dataset.procsPerHour) : 0;

  if (lastProc && procsPerHour > 0) {
    const { text, isOverdue } = calculateLiveETA(lastProc, null, procsPerHour);
    if (isOverdue) {
      el.textContent = t('feature.abilityTracker.late', { time: text });
      el.style.color = 'var(--qpm-danger)';
    } else {
      el.textContent = t('feature.abilityTracker.next', { time: text });
      el.style.color = 'var(--qpm-accent)';
    }
  } else if (lastProc) {
    el.textContent = formatAgo(lastProc);
    el.style.color = 'var(--qpm-text-muted)';
  } else if (procsPerHour > 0) {
    el.textContent = formatAvgInterval(procsPerHour);
    el.style.color = 'var(--qpm-text-muted)';
  } else {
    el.textContent = '—';
    el.style.color = 'var(--qpm-text-muted)';
  }
}
