// src/diagnostics/copyPayload.ts — Discord-friendly Copy renderer (§8.3)

import { getCurrentVersion } from '../utils/versionChecker';
import { errorBuffer } from './errorBuffer';
import { getCapturedGameVersion } from './gameVersionCapture';
import { healthBus } from './healthBus';
import type { ErrorBufferEntry, SubsystemHealth } from './types';

export interface CopyPayloadOptions {
  qpmVersion: boolean;
  gameVersion: boolean;
  browser: boolean;
  os: boolean;
  aggregate: boolean;
  subsystems: boolean;
  recentErrors: boolean;
  timestamp: boolean;
}

export const DEFAULT_COPY_OPTIONS: CopyPayloadOptions = {
  qpmVersion: true,
  gameVersion: true,
  browser: true,
  os: true,
  aggregate: true,
  subsystems: true,
  recentErrors: true,
  timestamp: true,
};

const MAX_TOTAL_CHARS = 1900; // leave headroom under the 2000-char Discord limit
const MAX_RECENT_ERRORS = 50;

interface UAInfo { browser: string; os: string }

function detectBrowserAndOs(): UAInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let browser = 'Unknown';
  let os = 'Unknown';

  if (/Edg\/(\d+)/.test(ua)) browser = `Edge ${RegExp.$1}`;
  else if (/OPR\/(\d+)/.test(ua) || /Opera\/(\d+)/.test(ua)) browser = `Opera ${RegExp.$1}`;
  else if (/Firefox\/(\d+)/.test(ua)) browser = `Firefox ${RegExp.$1}`;
  else if (/Chrome\/(\d+)/.test(ua)) browser = `Chrome ${RegExp.$1}`;
  else if (/Version\/(\d+).*Safari/.test(ua)) browser = `Safari ${RegExp.$1}`;

  if (/Windows NT 11/.test(ua)) os = 'Windows 11';
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10';
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6\.2/.test(ua)) os = 'Windows 8';
  else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
  else if (/Mac OS X (\d+)[._](\d+)/.test(ua)) os = `macOS ${RegExp.$1}.${RegExp.$2}`;
  else if (/Android (\d+)/.test(ua)) os = `Android ${RegExp.$1}`;
  else if (/iPad|iPhone/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { browser, os };
}

function pad(label: string, value: string, width = 16): string {
  const left = `${label}:`.padEnd(width, ' ');
  return `${left}${value}`;
}

function formatTimestamp(ts: number): string {
  // ISO 8601 keeps it short and unambiguous.
  return new Date(ts).toISOString();
}

function summarizeMetrics(metrics?: Readonly<Record<string, number | string>>): string {
  if (!metrics) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(metrics)) {
    parts.push(`${k}=${v}`);
    if (parts.join(' ').length > 80) {
      parts.push('…');
      break;
    }
  }
  return parts.length ? ` (${parts.join(' ')})` : '';
}

function renderSubsystemTable(rows: readonly SubsystemHealth[]): string {
  if (rows.length === 0) return '(no subsystems registered)';
  const nameWidth = Math.min(
    24,
    Math.max(8, rows.reduce((m, h) => Math.max(m, h.subsystem.length), 0)),
  );
  const statusWidth = 10;
  const lines: string[] = [];
  for (const row of rows) {
    const name = row.subsystem.padEnd(nameWidth, ' ');
    const status = row.status.padEnd(statusWidth, ' ');
    const message = row.message ?? '';
    const metrics = summarizeMetrics(row.metrics);
    lines.push(`${name} ${status} ${message}${metrics}`.trimEnd());
  }
  return lines.join('\n');
}

function renderErrorEntry(entry: ErrorBufferEntry): string {
  const time = new Date(entry.lastSeen).toISOString().substring(11, 19);
  const countSuffix = entry.count > 1 ? ` (×${entry.count})` : '';
  const head = `[${time}] ${entry.code} ${entry.message}${countSuffix}`;
  const details: string[] = [];
  if (entry.subsystem) details.push(`  subsystem: ${entry.subsystem}`);
  if (entry.context) {
    let ctx: string;
    try {
      ctx = JSON.stringify(entry.context);
    } catch {
      ctx = '<unserializable>';
    }
    if (ctx.length > 200) ctx = `${ctx.substring(0, 197)}...`;
    details.push(`  context: ${ctx}`);
  }
  if (entry.causeText) {
    const cause = entry.causeText.length > 200
      ? `${entry.causeText.substring(0, 197)}...`
      : entry.causeText;
    details.push(`  cause: ${cause}`);
  }
  return [head, ...details].join('\n');
}

function renderRecentErrors(): string {
  const all = errorBuffer.readAll();
  const total = all.length;
  if (total === 0) return '(no errors in buffer)';
  const window = all.slice(Math.max(0, total - MAX_RECENT_ERRORS));
  const header = total > MAX_RECENT_ERRORS
    ? `(last ${window.length} of ${total})`
    : `(${window.length})`;
  // Newest first for skimming.
  const lines = window.slice().reverse().map(renderErrorEntry);
  return `${header}\n${lines.join('\n\n')}`;
}

function truncateToBudget(body: string, budget: number): string {
  if (body.length <= budget) return body;
  const truncMarker = '\n…(truncated to fit Discord message limit)…';
  return body.substring(0, Math.max(0, budget - truncMarker.length)) + truncMarker;
}

export function renderCopyPayload(opts: CopyPayloadOptions = DEFAULT_COPY_OPTIONS): string {
  const ua = detectBrowserAndOs();
  const subsystems = healthBus.readAll();
  const aggregate = healthBus.aggregate();

  const headerLines: string[] = [];
  const ts = formatTimestamp(Date.now());
  headerLines.push(`QPM Diagnostics${opts.timestamp ? `  (${ts})` : ''}`);

  if (opts.qpmVersion) headerLines.push(pad('QPM version', getCurrentVersion()));
  if (opts.gameVersion) headerLines.push(pad('Game version', getCapturedGameVersion() ?? '(not captured)'));
  if (opts.browser) headerLines.push(pad('Browser', ua.browser));
  if (opts.os) headerLines.push(pad('OS', ua.os));
  if (opts.aggregate) headerLines.push(pad('Overall', aggregate));

  const sections: string[] = [];
  sections.push(headerLines.join('\n'));

  if (opts.subsystems) {
    sections.push(`\n== Subsystems ==\n${renderSubsystemTable(subsystems)}`);
  }

  if (opts.recentErrors) {
    sections.push(`\n== Recent errors ==\n${renderRecentErrors()}`);
  }

  const body = sections.join('\n');
  const trimmed = truncateToBudget(body, MAX_TOTAL_CHARS);
  return '```\n' + trimmed + '\n```';
}

export async function copyPayloadToClipboard(opts: CopyPayloadOptions = DEFAULT_COPY_OPTIONS): Promise<boolean> {
  const text = renderCopyPayload(opts);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to manual fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
