// src/diagnostics/copyPayload.ts — Discord-friendly Copy renderer (§8.3)
//
// Layout (chosen 2026-07-01): compact single-line header, Issues section
// listing only non-OK subsystems, and one-line error entries. Errors get
// prioritised into whatever budget remains — Discord's 2000-char message
// limit is the hard cap.

import { getCurrentVersion } from '../utils/versionChecker';
import { errorBuffer } from './errorBuffer';
import { getCapturedGameVersion } from './gameVersionCapture';
import { healthBus } from './healthBus';
import type { ErrorBufferEntry, Severity, SubsystemHealth } from './types';

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

function shortenOs(os: string): string {
  return os.replace(/^Windows /, 'Win ');
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

// Padded to 5 chars so codes/messages align in a column.
function severityTag(sev: Severity): string {
  switch (sev) {
    case 'warn':  return 'WARN ';
    case 'error': return 'ERR  ';
    case 'fatal': return 'FATAL';
    case 'info':  return 'INFO ';
  }
}

function compactContext(context: Record<string, unknown> | undefined): string {
  if (!context) return '';
  let s: string;
  try { s = JSON.stringify(context); } catch { return ''; }
  if (s.length <= 60) return ` ${s}`;
  return ` ${s.substring(0, 57)}...`;
}

function renderErrorEntryCompact(entry: ErrorBufferEntry): string {
  const time = new Date(entry.lastSeen).toISOString().substring(11, 19);
  const sev = severityTag(entry.severity);
  const ctx = compactContext(entry.context);
  const count = entry.count > 1 ? `  ×${entry.count}` : '';
  return `${time}  ${sev}  ${entry.code}  ${entry.message}${ctx}${count}`;
}

function renderIssuesLines(issues: readonly SubsystemHealth[]): string {
  if (issues.length === 0) return '(none)';
  const nameWidth = Math.min(
    24,
    Math.max(8, issues.reduce((m, h) => Math.max(m, h.subsystem.length), 0)),
  );
  const statusWidth = 10;
  const lines: string[] = [];
  for (const row of issues) {
    const name = row.subsystem.padEnd(nameWidth, ' ');
    const status = row.status.padEnd(statusWidth, ' ');
    const message = row.message ?? '';
    lines.push(`${name} ${status} ${message}`.trimEnd());
  }
  return lines.join('\n');
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

  // Fold `starting` into ok, `recovering` into degraded for reporting counts.
  let okCount = 0;
  let degradedCount = 0;
  let failedCount = 0;
  const issues: SubsystemHealth[] = [];
  for (const s of subsystems) {
    if (s.status === 'failed') { failedCount++; issues.push(s); }
    else if (s.status === 'degraded' || s.status === 'recovering') { degradedCount++; issues.push(s); }
    else { okCount++; }
  }

  // ── Header ──
  const headerLines: string[] = [];
  headerLines.push(`QPM Diagnostics${opts.timestamp ? `  (${formatTimestamp(Date.now())})` : ''}`);

  const idParts: string[] = [];
  if (opts.qpmVersion)  idParts.push(`QPM ${getCurrentVersion()}`);
  if (opts.gameVersion) idParts.push(`Game ${getCapturedGameVersion() ?? '?'}`);
  if (opts.browser)     idParts.push(ua.browser);
  if (opts.os)          idParts.push(shortenOs(ua.os));
  if (idParts.length > 0) headerLines.push(idParts.join('  '));

  if (opts.aggregate) {
    headerLines.push(`Overall: ${aggregate}  (${okCount} ok / ${degradedCount} degraded / ${failedCount} failed)`);
  }

  let fixed = headerLines.join('\n');

  // ── Issues section (only when there ARE issues) ──
  if (opts.subsystems && issues.length > 0) {
    fixed += `\n\n== Issues ==\n${renderIssuesLines(issues)}`;
  }

  if (!opts.recentErrors) {
    return '```\n' + truncateToBudget(fixed, MAX_TOTAL_CHARS) + '\n```';
  }

  // ── Errors section — fit as many as remaining budget allows ──
  const all = errorBuffer.readAll();
  if (all.length === 0) {
    const emptyBlock = `\n\n== Errors ==\n(no errors recorded)`;
    return '```\n' + truncateToBudget(fixed + emptyBlock, MAX_TOTAL_CHARS) + '\n```';
  }

  const cap = Math.min(all.length, MAX_RECENT_ERRORS);
  const window = all.slice(all.length - cap).slice().reverse();
  const compactLines = window.map(renderErrorEntryCompact);

  const truncMarker = (n: number): string => `\n… ${n} more truncated`;
  const sectionHeader = (shown: number): string =>
    `\n\n== Errors (last ${shown}${all.length > shown ? ` of ${all.length}` : ''}) ==\n`;

  // Reserve worst-case header + marker lengths so trimming can't overshoot.
  const reserved = sectionHeader(compactLines.length).length + truncMarker(compactLines.length).length;
  const available = MAX_TOTAL_CHARS - fixed.length - reserved;

  const kept: string[] = [];
  let used = 0;
  for (const line of compactLines) {
    const cost = kept.length === 0 ? line.length : line.length + 1;
    if (used + cost > available) break;
    kept.push(line);
    used += cost;
  }

  const dropped = compactLines.length - kept.length;
  const errorsBlock =
    sectionHeader(kept.length) + kept.join('\n') + (dropped > 0 ? truncMarker(dropped) : '');

  const body = fixed + errorsBlock;
  const trimmed = truncateToBudget(body, MAX_TOTAL_CHARS);
  return '```\n' + trimmed + '\n```';
}

export async function writeToClipboard(text: string): Promise<boolean> {
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

export async function copyPayloadToClipboard(opts: CopyPayloadOptions = DEFAULT_COPY_OPTIONS): Promise<boolean> {
  return writeToClipboard(renderCopyPayload(opts));
}
