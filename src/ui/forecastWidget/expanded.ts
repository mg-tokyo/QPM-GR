// Expanded view of the forecast widget (ALR-3.4): upcoming entries, this-session log, older history.
import { createSectionHeader, createSpinner } from '../components';
import { t } from '../../i18n';
import type { WeatherDefSafe } from '../../utils/game/catalogHelpers';
import type { WeatherForecastEntry } from '../../types/gameAtoms';
import type { WeatherHistoryEvent } from './model';
import type { WeatherLogEntry } from './weatherLog';

export type HistoryState = 'loading' | 'error' | readonly WeatherHistoryEvent[];

export interface ExpandedInput {
  upcoming: readonly WeatherForecastEntry[];
  log: readonly WeatherLogEntry[];
  history: HistoryState;
  nowMs: number;
  weatherDef: (weatherId: string) => WeatherDefSafe | null;
  spriteUrl: (key: string | null) => string | null;
}

function clock(ms: number, nowMs: number): string {
  const sameDay = new Date(ms).toDateString() === new Date(nowMs).toDateString();
  return new Date(ms).toLocaleString([], sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function row(input: ExpandedInput, weatherId: string | null, groupId: string, when: string): HTMLElement {
  const def = weatherId ? input.weatherDef(weatherId) : null;
  const el = document.createElement('div');
  el.className = 'qpm-forecast-widget__row';
  const url = input.spriteUrl(def?.spriteKey ?? null);
  const icon = document.createElement(url ? 'img' : 'span');
  icon.className = 'qpm-forecast-widget__icon';
  if (url && icon instanceof HTMLImageElement) { icon.src = url; icon.alt = ''; }
  const label = document.createElement('span');
  label.className = 'qpm-forecast-widget__label';
  label.textContent = weatherId ? def?.name ?? weatherId : t('feature.forecastWidget.hiddenEvent', { group: groupId });
  const time = document.createElement('span');
  time.className = 'qpm-forecast-widget__time';
  time.textContent = when;
  el.append(icon, label, time);
  return el;
}

function note(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'qpm-forecast-widget__empty';
  el.textContent = text;
  return el;
}

function section(titleKey: string, rows: HTMLElement[], emptyKey: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'qpm-forecast-widget__section';
  el.append(createSectionHeader(t(titleKey), { size: 'compact' }).root);
  el.append(...(rows.length ? rows : [note(t(emptyKey))]));
  return el;
}

export function renderExpanded(container: HTMLElement, input: ExpandedInput): void {
  const { nowMs } = input;
  const span = (a: number, b: number): string => `${clock(a, nowMs)} – ${clock(b, nowMs)}`;
  const groupOf = (id: string): string => input.weatherDef(id)?.groupId ?? '';
  const upcoming = input.upcoming.map((e) => row(input, e.weatherId, e.groupId, span(e.startsAtMs, e.endsAtMs)));
  const log = input.log.map((e) => row(input, e.weatherId, groupOf(e.weatherId), span(e.startsAtMs, e.endsAtMs)));
  const history = document.createElement('div');
  history.className = 'qpm-forecast-widget__section';
  history.append(createSectionHeader(t('feature.forecastWidget.earlier'), { size: 'compact' }).root);
  if (input.history === 'loading') history.append(createSpinner(t('common.loading')));
  else if (input.history === 'error') history.append(note(t('feature.forecastWidget.historyError')));
  else if (input.history.length === 0) history.append(note(t('feature.forecastWidget.historyEmpty')));
  else history.append(...input.history.map((e) => row(input, e.weatherId, groupOf(e.weatherId), clock(e.startsAtMs, nowMs))));
  container.replaceChildren(
    section('feature.forecastWidget.upcoming', upcoming, 'feature.forecastWidget.noneUpcoming'),
    section('feature.forecastWidget.thisSession', log, 'feature.forecastWidget.sessionEmpty'),
    history,
  );
}
