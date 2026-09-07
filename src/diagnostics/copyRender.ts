import type { ErrorBufferEntry, ErrorCodeDefinition, Severity, SubsystemHealth } from './types';

export interface CopyPayloadOptions {
  qpmVersion: boolean;
  gameVersion: boolean;
  browser: boolean;
  os: boolean;
  environment: boolean;
  otherMods: boolean;
  flags: boolean;
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
  environment: true,
  otherMods: true,
  flags: true,
  aggregate: true,
  subsystems: true,
  recentErrors: true,
  timestamp: true,
};

export interface ReportInput {
  readonly now: number;
  readonly qpmVersion: string;
  readonly gameVersion: string | null;
  readonly browser: string;
  readonly os: string;
  readonly environmentLine: string;
  readonly modsLine: string | null;
  readonly flagsLine: string | null;
  readonly subsystems: readonly SubsystemHealth[];
  readonly aggregate: 'ok' | 'degraded' | 'failed';
  readonly gameStateProblemLines: readonly string[];
  /** Full buffer, oldest first. */
  readonly errors: readonly ErrorBufferEntry[];
  readonly sessionStartedAt: number;
  readonly lookupCode: (code: string) => ErrorCodeDefinition | undefined;
}

export const MAX_TOTAL_CHARS = 1900; // headroom under Discord's 2000-char limit
export const MAX_RECENT_ERRORS = 50;
const MAX_MESSAGE_CHARS = 90;

export function shortenOs(os: string): string {
  return os.replace(/^Windows /, 'Win ');
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

// MM-DD HH:MM:SS — the buffer spans days, so HH:MM:SS alone was unattributable.
function shortTime(ts: number): string {
  const iso = new Date(ts).toISOString();
  return `${iso.substring(5, 10)} ${iso.substring(11, 19)}`;
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

// Per-event counters that would split one pattern into many lines.
const VOLATILE_CONTEXT_KEYS = new Set(['seq', 'retries', 'requestId', 'attempts', 'checks', 'sustainedChecks', 'durationMs', 'elapsedMs']);

function contextKey(context: Record<string, unknown> | undefined): string {
  if (!context) return '';
  try {
    return JSON.stringify(context, (key, value: unknown) => (VOLATILE_CONTEXT_KEYS.has(key) ? undefined : value));
  } catch { return '<unserializable>'; }
}

function compactContext(context: Record<string, unknown> | undefined): string {
  if (!context) return '';
  let s: string;
  try { s = JSON.stringify(context); } catch { return ''; }
  if (s.length <= 60) return ` ${s}`;
  return ` ${s.substring(0, 57)}...`;
}

function collapse(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.substring(0, max - 3)}…`;
}

// Code descriptions are paragraphs (FEATURE-004 ≈ 330 chars); the title is the
// one-line form. Custom messages that aren't the description are kept, capped.
function messageFor(entry: ErrorBufferEntry, lookupCode: ReportInput['lookupCode']): string {
  const def = lookupCode(entry.code);
  if (def && (entry.message === def.description || entry.message === def.title)) return def.title;
  return collapse(entry.message, MAX_MESSAGE_CHARS);
}

interface ErrorGroup {
  readonly latest: ErrorBufferEntry;
  readonly total: number;
  readonly firstSeen: number;
  readonly entries: number;
}

// Consecutive-only dedup in the buffer leaves A,B,A,B storms as many rows;
// regroup by code + context across the window so each pattern is one line.
export function groupErrors(window: readonly ErrorBufferEntry[]): ErrorGroup[] {
  const groups = new Map<string, { latest: ErrorBufferEntry; total: number; firstSeen: number; entries: number }>();
  for (const entry of window) {
    const key = `${entry.code}|${contextKey(entry.context)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { latest: entry, total: entry.count, firstSeen: entry.firstSeen, entries: 1 });
      continue;
    }
    g.total += entry.count;
    g.entries += 1;
    g.firstSeen = Math.min(g.firstSeen, entry.firstSeen);
    if (entry.lastSeen >= g.latest.lastSeen) g.latest = entry;
  }
  return [...groups.values()].sort((a, b) => b.latest.lastSeen - a.latest.lastSeen);
}

export function renderErrorGroupLine(group: ErrorGroup, input: Pick<ReportInput, 'qpmVersion' | 'lookupCode'>): string {
  const e = group.latest;
  const sev = severityTag(e.severity);
  const ver = e.qpmVersion && e.qpmVersion !== input.qpmVersion ? `@${e.qpmVersion}` : '';
  const ctx = compactContext(e.context);
  const cause = e.causeText ? `  ← ${collapse(e.causeText, MAX_MESSAGE_CHARS)}` : '';
  let count = '';
  if (group.total > 1) {
    count = `  ×${group.total}`;
    if (group.entries > 1) count += ` since ${shortTime(group.firstSeen)}`;
  }
  return `${shortTime(e.lastSeen)}  ${sev}  ${e.code}${ver}  ${messageFor(e, input.lookupCode)}${ctx}${cause}${count}`;
}

function renderIssuesLines(issues: readonly SubsystemHealth[]): string {
  if (issues.length === 0) return '(none)';
  const nameWidth = Math.min(
    24,
    Math.max(8, issues.reduce((m, h) => Math.max(m, h.subsystem.length), 0)),
  );
  const lines: string[] = [];
  for (const row of issues) {
    const name = row.subsystem.padEnd(nameWidth, ' ');
    const status = row.status.padEnd(10, ' ');
    lines.push(`${name} ${status} ${row.message ?? ''}`.trimEnd());
  }
  return lines.join('\n');
}

function truncateToBudget(body: string, budget: number): string {
  if (body.length <= budget) return body;
  const truncMarker = '\n…(truncated to fit Discord message limit)…';
  return body.substring(0, Math.max(0, budget - truncMarker.length)) + truncMarker;
}

function fence(body: string): string {
  return '```\n' + truncateToBudget(body, MAX_TOTAL_CHARS) + '\n```';
}

const DIVIDER_PREFIX = '--- session start';

function sessionDivider(sessionStartedAt: number, noneThisSession: boolean): string {
  return `${DIVIDER_PREFIX} ${shortTime(sessionStartedAt)}${noneThisSession ? ' (no errors this session)' : ''} ---`;
}

// Lines newest-first; the divider marks where pre-reload residue begins.
function buildErrorLines(input: ReportInput): string[] {
  const window = input.errors.slice(Math.max(0, input.errors.length - MAX_RECENT_ERRORS));
  const groups = groupErrors(window);
  const lines: string[] = [];
  let dividerPlaced = input.sessionStartedAt <= 0;
  for (const group of groups) {
    if (!dividerPlaced && group.latest.lastSeen < input.sessionStartedAt) {
      lines.push(sessionDivider(input.sessionStartedAt, lines.length === 0));
      dividerPlaced = true;
    }
    lines.push(renderErrorGroupLine(group, input));
  }
  return lines;
}

export function renderReport(input: ReportInput, opts: CopyPayloadOptions = DEFAULT_COPY_OPTIONS): string {
  let okCount = 0;
  let degradedCount = 0;
  let failedCount = 0;
  const issues: SubsystemHealth[] = [];
  for (const s of input.subsystems) {
    if (s.status === 'failed') { failedCount++; issues.push(s); }
    else if (s.status === 'degraded' || s.status === 'recovering') { degradedCount++; issues.push(s); }
    else { okCount++; }
  }

  const headerLines: string[] = [];
  headerLines.push(`QPM Diagnostics${opts.timestamp ? `  (${formatTimestamp(input.now)})` : ''}`);

  const idParts: string[] = [];
  if (opts.qpmVersion)  idParts.push(`QPM ${input.qpmVersion}`);
  if (opts.gameVersion) idParts.push(`Game ${input.gameVersion ?? '?'}`);
  if (opts.browser)     idParts.push(input.browser);
  if (opts.os)          idParts.push(shortenOs(input.os));
  if (idParts.length > 0) headerLines.push(idParts.join('  '));

  if (opts.environment) headerLines.push(input.environmentLine);
  if (opts.otherMods && input.modsLine) headerLines.push(input.modsLine);
  if (opts.flags && input.flagsLine) headerLines.push(input.flagsLine);

  if (opts.aggregate) {
    headerLines.push(`Overall: ${input.aggregate}  (${okCount} ok / ${degradedCount} degraded / ${failedCount} failed)`);
  }

  let fixed = headerLines.join('\n');

  if (opts.subsystems && issues.length > 0) {
    fixed += `\n\n== Issues ==\n${renderIssuesLines(issues)}`;
  }

  // Only spend budget on gameState detail when its row is actually unhealthy.
  const gs = input.subsystems.find((s) => s.subsystem === 'gameState');
  if (opts.subsystems && gs && gs.status !== 'ok' && gs.status !== 'starting' && input.gameStateProblemLines.length > 0) {
    fixed += `\n\n== Game state ==\n${input.gameStateProblemLines.join('\n')}`;
  }

  if (!opts.recentErrors) return fence(fixed);

  if (input.errors.length === 0) return fence(`${fixed}\n\n== Errors ==\n(no errors recorded)`);

  const lines = buildErrorLines(input);
  const total = input.errors.length;
  const patternCount = lines.filter((l) => !l.startsWith(DIVIDER_PREFIX)).length;
  const truncMarker = (n: number): string => `\n… ${n} more truncated`;
  const sectionHeader = (shown: number): string =>
    `\n\n== Errors (${shown} patterns from ${total > MAX_RECENT_ERRORS ? `last ${MAX_RECENT_ERRORS} of ` : ''}${total} entries) ==\n`;

  // Reserve worst-case header + marker lengths so trimming can't overshoot.
  const reserved = sectionHeader(patternCount).length + truncMarker(patternCount).length;
  const available = MAX_TOTAL_CHARS - fixed.length - reserved;

  const kept: string[] = [];
  let used = 0;
  let keptPatterns = 0;
  for (const line of lines) {
    const cost = kept.length === 0 ? line.length : line.length + 1;
    if (used + cost > available) break;
    kept.push(line);
    used += cost;
    if (!line.startsWith(DIVIDER_PREFIX)) keptPatterns++;
  }

  const dropped = patternCount - keptPatterns;
  const errorsBlock =
    sectionHeader(keptPatterns) + kept.join('\n') + (dropped > 0 ? truncMarker(dropped) : '');

  return fence(fixed + errorsBlock);
}
