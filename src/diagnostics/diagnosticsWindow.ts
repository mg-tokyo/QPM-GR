// src/diagnostics/diagnosticsWindow.ts — Diagnostics window UI (§8)
//
// Pure DOM, design-token colours, no external UI dependencies beyond the
// existing modal-window system.

import { copyPayloadToClipboard, DEFAULT_COPY_OPTIONS, renderCopyPayload, writeToClipboard } from './copyPayload';
import type { CopyPayloadOptions } from './copyPayload';
import { errorBuffer } from './errorBuffer';
import { healthBus } from './healthBus';
import type { AggregateStatus, ErrorBufferEntry, SubsystemHealth } from './types';
import { watchDetach } from '../utils/dom/dom';

export const DIAGNOSTICS_WINDOW_ID = 'qpm-diagnostics';
export const DIAGNOSTICS_WINDOW_TITLE = '🩺 QPM Diagnostics';

interface RenderState {
  aggregatePill: HTMLElement;
  aggregateLabel: HTMLElement;
  subsystemTable: HTMLElement;
  errorList: HTMLElement;
  cleanup: Array<() => void>;
  // Fingerprints let refreshTables() skip DOM re-renders when nothing changed.
  // Without this the 2s poll wipes hover state and any in-flight "Copied" badge.
  lastErrorFingerprint: string;
  lastSubsystemFingerprint: string;
}

function errorFingerprint(rows: readonly ErrorBufferEntry[]): string {
  const last = rows[rows.length - 1];
  return `${rows.length}|${last?.lastSeen ?? 0}|${last?.count ?? 0}`;
}

function subsystemFingerprint(rows: readonly SubsystemHealth[]): string {
  let maxUpdate = 0;
  for (const r of rows) if (r.lastUpdate > maxUpdate) maxUpdate = r.lastUpdate;
  return `${rows.length}|${maxUpdate}`;
}

function pillColours(status: AggregateStatus | SubsystemHealth['status']): { bg: string; fg: string; border: string } {
  switch (status) {
    case 'failed':
      return { bg: 'rgba(244, 67, 54, 0.18)', fg: '#f44336', border: 'rgba(244, 67, 54, 0.55)' };
    case 'degraded':
    case 'recovering':
      return { bg: 'rgba(255, 179, 71, 0.18)', fg: '#ffb347', border: 'rgba(255, 179, 71, 0.55)' };
    case 'starting':
      return { bg: 'rgba(120, 130, 170, 0.18)', fg: '#97a0c0', border: 'rgba(120, 130, 170, 0.45)' };
    case 'ok':
    default:
      return { bg: 'rgba(79, 209, 139, 0.18)', fg: '#4fd18b', border: 'rgba(79, 209, 139, 0.45)' };
  }
}

function makePill(text: string, status: AggregateStatus | SubsystemHealth['status']): HTMLElement {
  const pill = document.createElement('span');
  const c = pillColours(status);
  pill.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:6px',
    'padding:2px 10px',
    'border-radius:9999px',
    `background:${c.bg}`,
    `color:${c.fg}`,
    `border:1px solid ${c.border}`,
    'font-size:11px',
    'font-weight:600',
    'letter-spacing:0.3px',
    'text-transform:uppercase',
  ].join(';');
  pill.textContent = text;
  return pill;
}

function aggregateLabelText(status: AggregateStatus, subsystemCount: number, degradedCount: number, failedCount: number): string {
  if (status === 'ok') {
    return subsystemCount === 0 ? 'All systems OK (no subsystems registered)' : 'All systems OK';
  }
  if (status === 'failed') {
    if (failedCount === 1) return '1 subsystem failed';
    return `${failedCount} subsystems failed`;
  }
  if (degradedCount === 1) return '1 subsystem degraded';
  return `${degradedCount} subsystems degraded`;
}

function renderSubsystemRows(host: HTMLElement, rows: readonly SubsystemHealth[]): void {
  host.innerHTML = '';
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:12px;color:var(--qpm-text-muted);font-size:12px;text-align:center;';
    empty.textContent = 'No subsystems registered yet.';
    host.appendChild(empty);
    return;
  }
  const sorted = rows.slice().sort((a, b) => a.subsystem.localeCompare(b.subsystem));
  for (const row of sorted) {
    const item = document.createElement('div');
    item.style.cssText = [
      'display:grid',
      'grid-template-columns:auto 1fr auto',
      'align-items:center',
      'gap:10px',
      'padding:8px 10px',
      'border-radius:8px',
      'border:1px solid rgba(255,255,255,0.06)',
      `background:${ROW_BG_IDLE}`,
      'cursor:pointer',
      'transition:background 120ms ease',
    ].join(';');
    item.title = 'Click to copy details';

    const pill = makePill(row.status, row.status);

    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;flex-direction:column;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:12px;font-weight:600;color:var(--qpm-text);';
    name.textContent = row.subsystem;
    const detail = document.createElement('div');
    detail.style.cssText = 'font-size:11px;color:var(--qpm-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const metricsSummary = row.metrics
      ? Object.entries(row.metrics).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join('  ·  ')
      : '';
    detail.textContent = [row.message ?? '', metricsSummary].filter(Boolean).join('  ·  ');
    meta.append(name, detail);

    const category = document.createElement('span');
    category.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);text-transform:uppercase;letter-spacing:0.5px;';
    category.textContent = row.category;

    item.append(pill, meta, category);

    if (row.lastError) {
      const errLine = document.createElement('div');
      errLine.style.cssText = 'grid-column:1 / -1;font-size:11px;color:#ffb347;margin-top:4px;';
      const ctxText = row.lastError.context ? `  ${safeJson(row.lastError.context)}` : '';
      errLine.textContent = `↳ ${row.lastError.code} ${row.lastError.message}${ctxText}`;
      item.appendChild(errLine);
    }

    item.addEventListener('mouseenter', () => { item.style.background = ROW_BG_HOVER; });
    item.addEventListener('mouseleave', () => { item.style.background = ROW_BG_IDLE; });
    item.addEventListener('click', async () => {
      const ok = await writeToClipboard(formatSubsystemForClipboard(row));
      const badge = document.createElement('span');
      badge.textContent = ok ? 'Copied' : 'Copy failed';
      const badgeBg = ok ? 'rgba(79,209,139,0.22)' : 'rgba(244,67,54,0.22)';
      const badgeFg = ok ? '#4fd18b' : '#f44336';
      badge.style.cssText = `padding:1px 6px;border-radius:9999px;background:${badgeBg};color:${badgeFg};font-size:10px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;`;
      item.appendChild(badge);
      setTimeout(() => { badge.remove(); }, 1200);
    });

    host.appendChild(item);
  }
}

function formatSubsystemForClipboard(row: SubsystemHealth): string {
  const lines: string[] = [];
  lines.push(`Subsystem:   ${row.subsystem}`);
  lines.push(`Category:    ${row.category}`);
  lines.push(`Status:      ${row.status}`);
  if (row.message) lines.push(`Message:     ${row.message}`);
  lines.push(`Last update: ${new Date(row.lastUpdate).toISOString()}`);
  if (row.metrics) {
    lines.push('Metrics:');
    for (const [k, v] of Object.entries(row.metrics)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  if (row.lastError) {
    lines.push('Last error:');
    lines.push(`  code:      ${row.lastError.code}`);
    lines.push(`  severity:  ${row.lastError.severity}`);
    lines.push(`  message:   ${row.lastError.message}`);
    lines.push(`  timestamp: ${new Date(row.lastError.timestamp).toISOString()}`);
    if (row.lastError.context) {
      let ctx: string;
      try { ctx = JSON.stringify(row.lastError.context, null, 2); }
      catch { ctx = '<unserializable>'; }
      lines.push('  context:');
      lines.push(ctx.split('\n').map(l => `    ${l}`).join('\n'));
    }
    if (row.lastError.cause !== undefined) {
      let cause: string;
      if (row.lastError.cause instanceof Error) {
        cause = `${row.lastError.cause.name}: ${row.lastError.cause.message}`;
      } else {
        try { cause = JSON.stringify(row.lastError.cause); }
        catch { cause = String(row.lastError.cause); }
      }
      lines.push(`  cause:     ${cause}`);
    }
  }
  return lines.join('\n');
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 160 ? `${s.substring(0, 157)}...` : s;
  } catch {
    return '<unserializable>';
  }
}

function formatEntryForClipboard(entry: ErrorBufferEntry): string {
  const lines: string[] = [];
  lines.push(`[${new Date(entry.lastSeen).toISOString()}] ${entry.severity.toUpperCase()} ${entry.code}`);
  lines.push(`Subsystem: ${entry.subsystem}`);
  lines.push(`Message:   ${entry.message}`);
  if (entry.count > 1) {
    lines.push(`Count:     ${entry.count} (first seen ${new Date(entry.firstSeen).toISOString()})`);
  }
  if (entry.context) {
    let ctx: string;
    try { ctx = JSON.stringify(entry.context, null, 2); } catch { ctx = '<unserializable>'; }
    lines.push('Context:');
    lines.push(ctx);
  }
  if (entry.causeText) {
    lines.push('Cause:');
    lines.push(entry.causeText);
  }
  return lines.join('\n');
}

const ROW_BG_IDLE = 'rgba(255,255,255,0.02)';
const ROW_BG_HOVER = 'rgba(255,255,255,0.05)';

function renderErrorRows(host: HTMLElement, rows: readonly ErrorBufferEntry[]): void {
  host.innerHTML = '';
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:12px;color:var(--qpm-text-muted);font-size:12px;text-align:center;';
    empty.textContent = 'No errors recorded yet.';
    host.appendChild(empty);
    return;
  }
  // Newest first
  const ordered = rows.slice().reverse();
  for (const entry of ordered) {
    const item = document.createElement('div');
    item.style.cssText = [
      'padding:8px 10px',
      'border-radius:8px',
      'border:1px solid rgba(255,255,255,0.06)',
      `background:${ROW_BG_IDLE}`,
      'display:flex',
      'flex-direction:column',
      'gap:4px',
      'cursor:pointer',
      'transition:background 120ms ease',
    ].join(';');
    item.title = 'Click to copy details';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--qpm-text);';
    const ts = new Date(entry.lastSeen).toLocaleTimeString();
    const tsEl = document.createElement('span');
    tsEl.style.cssText = 'color:var(--qpm-text-muted);font-variant-numeric:tabular-nums;';
    tsEl.textContent = ts;
    const codeEl = document.createElement('span');
    codeEl.style.cssText = 'font-weight:600;color:#ffb347;';
    codeEl.textContent = entry.code;
    const msgEl = document.createElement('span');
    msgEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    msgEl.textContent = entry.message;
    head.append(tsEl, codeEl, msgEl);
    if (entry.count > 1) {
      const countEl = document.createElement('span');
      countEl.style.cssText = 'padding:1px 6px;border-radius:9999px;background:rgba(143,130,255,0.18);color:var(--qpm-accent);font-size:10px;font-weight:600;';
      countEl.textContent = `×${entry.count}`;
      head.appendChild(countEl);
    }
    item.appendChild(head);

    if (entry.context) {
      const ctx = document.createElement('div');
      ctx.style.cssText = 'font-size:11px;color:var(--qpm-text-muted);font-family:ui-monospace,SFMono-Regular,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      ctx.textContent = safeJson(entry.context);
      item.appendChild(ctx);
    }

    item.addEventListener('mouseenter', () => { item.style.background = ROW_BG_HOVER; });
    item.addEventListener('mouseleave', () => { item.style.background = ROW_BG_IDLE; });
    item.addEventListener('click', async () => {
      const ok = await writeToClipboard(formatEntryForClipboard(entry));
      const badge = document.createElement('span');
      badge.textContent = ok ? 'Copied' : 'Copy failed';
      const badgeBg = ok ? 'rgba(79,209,139,0.22)' : 'rgba(244,67,54,0.22)';
      const badgeFg = ok ? '#4fd18b' : '#f44336';
      badge.style.cssText = `padding:1px 6px;border-radius:9999px;background:${badgeBg};color:${badgeFg};font-size:10px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;`;
      head.appendChild(badge);
      setTimeout(() => { badge.remove(); }, 1200);
    });

    host.appendChild(item);
  }
}

function refreshAggregate(state: RenderState): void {
  const status = healthBus.aggregate();
  const all = healthBus.readAll();
  const degradedCount = all.filter(h => h.status === 'degraded' || h.status === 'recovering').length;
  const failedCount = all.filter(h => h.status === 'failed').length;

  const next = makePill(status, status);
  state.aggregatePill.replaceWith(next);
  state.aggregatePill = next;

  state.aggregateLabel.textContent = aggregateLabelText(status, all.length, degradedCount, failedCount);
}

function refreshTables(state: RenderState, force = false): void {
  const subs = healthBus.readAll();
  const subFp = subsystemFingerprint(subs);
  if (force || subFp !== state.lastSubsystemFingerprint) {
    state.lastSubsystemFingerprint = subFp;
    renderSubsystemRows(state.subsystemTable, subs);
  }
  const errs = errorBuffer.readAll();
  const errFp = errorFingerprint(errs);
  if (force || errFp !== state.lastErrorFingerprint) {
    state.lastErrorFingerprint = errFp;
    renderErrorRows(state.errorList, errs);
  }
}

function buildCopyDialog(onComplete: () => void): HTMLElement {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:rgba(0,0,0,0.45)',
    'z-index:2147483646',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:16px',
  ].join(';');

  const dialog = document.createElement('div');
  dialog.style.cssText = [
    'background:var(--qpm-surface-window)',
    'border:1px solid var(--qpm-accent-border)',
    'border-radius:12px',
    'padding:16px 18px',
    'min-width:320px',
    'max-width:480px',
    'box-shadow:var(--qpm-shadow)',
    'color:var(--qpm-text)',
    'font:12px/1.5 var(--qpm-font)',
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:6px;';
  title.textContent = 'Copy for Discord';

  const blurb = document.createElement('div');
  blurb.style.cssText = 'font-size:11px;color:var(--qpm-text-muted);margin-bottom:12px;line-height:1.45;';
  blurb.textContent = 'Choose what to include. All boxes are ticked by default — uncheck any you do not want to share.';

  const opts: CopyPayloadOptions = { ...DEFAULT_COPY_OPTIONS };

  const checkboxes: Array<{ key: keyof CopyPayloadOptions; label: string }> = [
    { key: 'qpmVersion', label: 'QPM version' },
    { key: 'gameVersion', label: 'Game build version' },
    { key: 'browser', label: 'Browser + version' },
    { key: 'os', label: 'Operating system' },
    { key: 'aggregate', label: 'Overall status + counts' },
    { key: 'subsystems', label: 'Issues (non-OK subsystems)' },
    { key: 'recentErrors', label: 'Recent errors (up to 50)' },
    { key: 'timestamp', label: 'Timestamp' },
  ];

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:14px;';

  for (const entry of checkboxes) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.style.cssText = 'width:14px;height:14px;accent-color:var(--qpm-accent);';
    input.addEventListener('change', () => {
      opts[entry.key] = input.checked;
    });
    row.append(input, document.createTextNode(entry.label));
    list.appendChild(row);
  }

  const status = document.createElement('div');
  status.style.cssText = 'font-size:11px;color:var(--qpm-text-muted);margin-top:6px;min-height:14px;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = [
    'background:rgba(255,255,255,0.05)',
    'border:1px solid rgba(255,255,255,0.15)',
    'color:var(--qpm-text)',
    'border-radius:6px',
    'padding:6px 12px',
    'font-size:12px',
    'cursor:pointer',
  ].join(';');

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Copy';
  confirmBtn.style.cssText = [
    'background:var(--qpm-accent-subtle)',
    'border:1px solid var(--qpm-accent-emphasis)',
    'color:var(--qpm-text)',
    'border-radius:6px',
    'padding:6px 14px',
    'font-size:12px',
    'font-weight:600',
    'cursor:pointer',
  ].join(';');

  cancelBtn.addEventListener('click', () => {
    overlay.remove();
    onComplete();
  });

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    status.textContent = 'Copying…';
    const ok = await copyPayloadToClipboard(opts);
    if (ok) {
      status.textContent = 'Copied to clipboard. Paste into Discord.';
      setTimeout(() => {
        overlay.remove();
        onComplete();
      }, 700);
    } else {
      status.textContent = 'Clipboard write failed — copy manually from the dialog text.';
      // Surface the payload in a selectable textarea so the user can still copy.
      const ta = document.createElement('textarea');
      ta.value = renderCopyPayload(opts);
      ta.readOnly = true;
      ta.style.cssText = 'margin-top:8px;width:100%;min-height:140px;background:rgba(0,0,0,0.4);color:var(--qpm-text);border:1px solid var(--qpm-accent-border);border-radius:6px;padding:8px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;';
      dialog.insertBefore(ta, actions);
      ta.focus();
      ta.select();
      confirmBtn.disabled = false;
    }
  });

  actions.append(cancelBtn, confirmBtn);
  dialog.append(title, blurb, list, status, actions);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      onComplete();
    }
  });

  return overlay;
}

export function renderDiagnosticsWindow(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:14px 16px;min-height:0;flex:1;overflow-y:auto;color:var(--qpm-text);';

  // Header — aggregate pill + actions
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;';

  const left = document.createElement('div');
  left.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;min-width:0;';

  const overallText = document.createElement('span');
  overallText.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);';
  overallText.textContent = 'Overall:';

  const aggregatePill = makePill(healthBus.aggregate(), healthBus.aggregate());
  const aggregateLabel = document.createElement('span');
  aggregateLabel.style.cssText = 'font-size:12px;color:var(--qpm-text);';

  left.append(overallText, aggregatePill, aggregateLabel);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy for Discord';
  copyBtn.style.cssText = [
    'background:var(--qpm-accent-subtle)',
    'border:1px solid var(--qpm-accent-emphasis)',
    'color:var(--qpm-text)',
    'border-radius:6px',
    'padding:6px 12px',
    'font-size:12px',
    'font-weight:600',
    'cursor:pointer',
  ].join(';');

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.style.cssText = [
    'background:rgba(255,255,255,0.05)',
    'border:1px solid rgba(255,255,255,0.15)',
    'color:var(--qpm-text)',
    'border-radius:6px',
    'padding:6px 12px',
    'font-size:12px',
    'cursor:pointer',
  ].join(';');

  header.append(left, refreshBtn, copyBtn);

  // Subsystems
  const subsHeader = document.createElement('div');
  subsHeader.style.cssText = 'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--qpm-text-muted);margin-top:4px;';
  subsHeader.textContent = 'Subsystems';

  const subsystemTable = document.createElement('div');
  subsystemTable.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  // Recent errors
  const errHeader = document.createElement('div');
  errHeader.style.cssText = 'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--qpm-text-muted);margin-top:8px;';
  errHeader.textContent = 'Recent errors';

  const errorList = document.createElement('div');
  errorList.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  root.append(header, subsHeader, subsystemTable, errHeader, errorList);

  const state: RenderState = {
    aggregatePill,
    aggregateLabel,
    subsystemTable,
    errorList,
    cleanup: [],
    lastErrorFingerprint: '',
    lastSubsystemFingerprint: '',
  };

  const refresh = (): void => {
    refreshAggregate(state);
    refreshTables(state);
  };

  const forceRefresh = (): void => {
    refreshAggregate(state);
    refreshTables(state, true);
  };

  forceRefresh();

  const unsub = healthBus.subscribe(() => {
    // Defer to keep subscribers O(1) per §6.4.
    queueMicrotask(refresh);
  });
  state.cleanup.push(unsub);

  // Poll the error buffer cheaply — buffer has no subscribe API. refresh() is
  // fingerprint-aware and no-ops when nothing changed, so hover state and any
  // in-flight "Copied" badge survive quiet periods.
  const intervalId = window.setInterval(refresh, 2000);
  state.cleanup.push(() => clearInterval(intervalId));

  refreshBtn.addEventListener('click', () => {
    errorBuffer.flush();
    forceRefresh();
  });

  copyBtn.addEventListener('click', () => {
    const dialog = buildCopyDialog(() => {/* no-op */});
    document.body.appendChild(dialog);
  });

  // Best-effort cleanup when the root is removed from DOM.
  try {
    const detachHandle = watchDetach(root, () => {
      for (const fn of state.cleanup) {
        try { fn(); } catch { /* ignore */ }
      }
    });
    state.cleanup.push(() => detachHandle.disconnect());
  } catch {
    // Document may not be ready in odd hosts — skip the detach watcher.
  }
}
