// Expanded view of the forecast widget (ALR-3.4, look ALR-17.8): upcoming entries, this-session log, older history.
import { createSectionHeader, createSpinner } from '../components';
import { ensureCardShellStyles } from '../shop/restockAlerts/cardShell';
import { t } from '../../i18n';
import { createForecastRow, lookSignature, type ForecastViewDeps } from './hero';
import { forecastEntryLine, type ForecastLine, type WeatherHistoryEvent } from './model';
import type { WeatherForecastEntry } from '../../types/gameAtoms';
import type { WeatherLogEntry } from './weatherLog';

export type HistoryState = 'loading' | 'error' | readonly WeatherHistoryEvent[];

export interface ExpandedInput extends ForecastViewDeps {
  upcoming: readonly WeatherForecastEntry[];
  log: readonly WeatherLogEntry[];
  history: HistoryState;
  nowMs: number;
}

interface TimedLine {
  line: ForecastLine;
  when: string;
  span?: string;
}

function clock(ms: number, nowMs: number): string {
  const sameDay = new Date(ms).toDateString() === new Date(nowMs).toDateString();
  return new Date(ms).toLocaleString([], sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timedLines(input: ExpandedInput): { upcoming: TimedLine[]; log: TimedLine[]; history: TimedLine[] | null } {
  const { nowMs, weatherDef } = input;
  // Start time in the row, full span on hover (user 2026-11-16): "12:55 PM – 01:05 PM" clipped names to 38 px at 240 px.
  const timed = (line: ForecastLine, start: number, end: number): TimedLine =>
    ({ line, when: clock(start, nowMs), span: `${clock(start, nowMs)} – ${clock(end, nowMs)}` });
  return {
    upcoming: input.upcoming.map((e) => timed(forecastEntryLine(e.weatherId, e.groupId, e.startsAtMs, weatherDef), e.startsAtMs, e.endsAtMs)),
    log: input.log.map((e) => timed(forecastEntryLine(e.weatherId, null, e.startsAtMs, weatherDef), e.startsAtMs, e.endsAtMs)),
    history: typeof input.history === 'string'
      ? null
      : input.history.map((e) => ({ line: forecastEntryLine(e.weatherId, null, e.startsAtMs, weatherDef), when: clock(e.startsAtMs, nowMs) })),
  };
}

/** Changes when a sprite or catalog colour behind any expanded row resolves late. */
export function expandedLookSignature(input: ExpandedInput): string {
  const { upcoming, log, history } = timedLines(input);
  return lookSignature([...upcoming, ...log, ...(history ?? [])].map((r) => r.line), input);
}

function rowsOf(lines: readonly TimedLine[], deps: ForecastViewDeps): HTMLElement[] {
  return lines.map(({ line, when, span }) => {
    const { row, time } = createForecastRow(line, deps);
    time.textContent = when;
    if (span) row.title = span;
    return row;
  });
}

function note(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'qpm-forecast-widget__empty';
  el.textContent = text;
  return el;
}

function section(titleKey: string, content: HTMLElement[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'qpm-forecast-widget__section';
  el.append(createSectionHeader(t(titleKey), { size: 'compact' }).root, ...content);
  return el;
}

const orNote = (rows: HTMLElement[], emptyKey: string): HTMLElement[] => (rows.length ? rows : [note(t(emptyKey))]);

export function renderExpanded(container: HTMLElement, input: ExpandedInput): void {
  ensureCardShellStyles();
  const lines = timedLines(input);
  let history: HTMLElement[];
  if (input.history === 'loading') history = [createSpinner(t('common.loading'))];
  else if (input.history === 'error') history = [note(t('feature.forecastWidget.historyError'))];
  else history = orNote(rowsOf(lines.history ?? [], input), 'feature.forecastWidget.historyEmpty');
  container.replaceChildren(
    section('feature.forecastWidget.upcoming', orNote(rowsOf(lines.upcoming, input), 'feature.forecastWidget.noneUpcoming')),
    section('feature.forecastWidget.thisSession', orNote(rowsOf(lines.log, input), 'feature.forecastWidget.sessionEmpty')),
    section('feature.forecastWidget.earlier', history),
  );
}
