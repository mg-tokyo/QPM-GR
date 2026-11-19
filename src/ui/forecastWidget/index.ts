// Forecast widget (ALR-3.3/3.4): floating card with the next event per weather group and nightfall, expandable.
import { openFloatingCard, closeFloatingCard, hasFloatingCard } from '../components/floatingCard';
import { isGameStateReady, readSync, subscribe } from '../../core/gameState';
import { onDayCycleChange } from '../../catalogs/logic/dayCycleCatalog';
import { getDayCycleClock } from '../../catalogs/logic/dayCycleClock';
import { getServerNowMs } from '../../store/serverClock';
import { getWeatherDefSafe } from '../../utils/game/catalogHelpers';
import { fetchRecentWeatherEvents } from '../../utils/itemEventService';
import { getAnySpriteDataUrl } from '../../sprite-v2/compat';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { storage } from '../../utils/storage';
import { t } from '../../i18n';
import { buildForecastLines, collapseWeatherHistory, forecastLinesSignature, upcomingEntries } from './model';
import { buildForecastView, heroSpriteKey, lookSignature, type ForecastView } from './hero';
import { expandedLookSignature, renderExpanded, type HistoryState } from './expanded';
import { EMPTY_WEATHER_LOG, stepWeatherLog, type WeatherLogState } from './weatherLog';
import { injectForecastWidgetStyles } from './styles';
import type { WeatherForecastEntry, WeatherWindow } from '../../types/gameAtoms';

export const FORECAST_WIDGET_POSITION_KEY = 'qpm.forecastWidget.panel.v1';
export const FORECAST_WIDGET_OPEN_KEY = 'qpm.forecastWidget.open.v1';
const CARD_KEY = 'forecast-widget';
const TICK_ID = 'forecast-widget-tick';
const DEFAULT_POSITION = { xPct: 0.02, yPct: 0.3 };
const HISTORY_LIMIT = 10;
const HISTORY_ROWS = 100;

let started = false;
let subscribed = false;
let stateCleanups: Array<() => void> = [];
let cardCleanups: Array<() => void> = [];
let body: HTMLElement | null = null;
let expandedEl: HTMLElement | null = null;
let expandBtn: HTMLButtonElement | null = null;
let expanded = false;
let forecast: readonly WeatherForecastEntry[] | null = null;
let weather: string | null = null;
let weatherWindow: WeatherWindow | null = null;
let logState: WeatherLogState = EMPTY_WEATHER_LOG;
let history: HistoryState = 'loading';
let signature = '';
let expandedSignature = '';
let view: ForecastView | null = null;
let headerIcon: HTMLImageElement | null = null;
const spriteUrls = new Map<string, string>();
const openListeners = new Set<(open: boolean) => void>();

const nowMs = (): number => getServerNowMs() ?? Date.now();

function spriteUrl(key: string | null): string | null {
  if (!key) return null;
  const cached = spriteUrls.get(key);
  if (cached) return cached;
  const url = getAnySpriteDataUrl(key);
  if (url) spriteUrls.set(key, url);
  return url || null;
}

const viewDeps = { spriteUrl, weatherDef: getWeatherDefSafe };

function setHeaderIcon(key: string | null): void {
  if (!headerIcon) return;
  const url = spriteUrl(key);
  headerIcon.hidden = !url;
  if (url && headerIcon.src !== url) headerIcon.src = url;
}

function renderLines(now: number): void {
  if (!body) return;
  const lines = buildForecastLines({ forecast, weather, window: weatherWindow, nowMs: now, clock: getDayCycleClock(), weatherDef: getWeatherDefSafe });
  const waiting = forecast === null && weather === null;
  const sig = `${forecastLinesSignature(lines)}|${lookSignature(lines, viewDeps)}|${weatherWindow?.startsAtMs ?? ''}|${waiting ? 'w' : ''}`;
  if (sig !== signature) {
    signature = sig;
    view = null;
    body.replaceChildren();
    setHeaderIcon(waiting ? null : heroSpriteKey(lines));
    if (waiting) {
      const empty = document.createElement('div');
      empty.className = 'qpm-forecast-widget__empty';
      empty.textContent = t('feature.forecastWidget.waiting');
      body.appendChild(empty);
    } else {
      view = buildForecastView(lines, weatherWindow, viewDeps);
      body.append(...view.nodes);
    }
  }
  view?.tick(now);
}

// Rebuilt only when its content changes: its times are clock times, not countdowns.
function renderExpandedView(now: number): void {
  if (!expandedEl) return;
  expandedEl.hidden = !expanded;
  if (!expanded) return;
  const upcoming = upcomingEntries({ forecast, weather, window: weatherWindow, nowMs: now, weatherDef: getWeatherDefSafe });
  const input = { ...viewDeps, upcoming, log: logState.past, history, nowMs: now };
  const historySig = typeof history === 'string' ? history : history.map((e) => `${e.weatherId}@${e.startsAtMs}`).join(',');
  const sig = JSON.stringify([upcoming, logState.past, historySig, expandedLookSignature(input)]);
  if (sig === expandedSignature) return;
  expandedSignature = sig;
  renderExpanded(expandedEl, input);
}

function render(): void {
  const now = nowMs();
  renderLines(now);
  renderExpandedView(now);
}

function syncLog(): void {
  logState = stepWeatherLog(logState, weather, weatherWindow, nowMs());
}

// Session-wide so the this-session log keeps recording while the card is closed.
function ensureSubscribed(): void {
  if (subscribed || !isGameStateReady()) return;
  subscribed = true;
  forecast = readSync('weatherForecast');
  weatherWindow = readSync('weatherWindow');
  weather = readSync('weather') ?? null;
  syncLog();
  stateCleanups.push(subscribe('weatherForecast', (v) => { forecast = v; render(); }));
  stateCleanups.push(subscribe('weatherWindow', (v) => { weatherWindow = v; syncLog(); render(); }));
  stateCleanups.push(subscribe('weather', (v) => { weather = v ?? null; syncLog(); render(); }));
}

function loadHistory(): void {
  if (typeof history === 'string') history = 'loading';
  void fetchRecentWeatherEvents(HISTORY_ROWS).then((rows) => {
    history = rows ? collapseWeatherHistory(rows, getWeatherDefSafe, HISTORY_LIMIT) : 'error';
    render();
  });
}

function setExpanded(next: boolean): void {
  expanded = next;
  if (expandBtn) {
    expandBtn.textContent = next ? '▴' : '▾';
    expandBtn.title = t(next ? 'feature.forecastWidget.collapse' : 'feature.forecastWidget.expand');
    expandBtn.setAttribute('aria-expanded', String(next));
  }
  if (next) loadHistory();
  render();
}

function notifyOpen(open: boolean): void {
  for (const cb of openListeners) {
    try { cb(open); } catch { /* listener errors stay local */ }
  }
}

function teardown(): void {
  for (const fn of cardCleanups.splice(0)) {
    try { fn(); } catch { /* ignore */ }
  }
  body = null;
  expandedEl = null;
  expandBtn = null;
  expanded = false;
  view = null;
  headerIcon = null;
  signature = '';
  expandedSignature = '';
  notifyOpen(false);
}

function headerButton(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.title = title;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function buildHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = 'qpm-forecast-widget__header';
  const title = document.createElement('div');
  title.className = 'qpm-forecast-widget__title';
  title.textContent = t('feature.forecastWidget.title');
  headerIcon = document.createElement('img');
  headerIcon.className = 'qpm-forecast-widget__head-icon';
  headerIcon.alt = '';
  headerIcon.hidden = true;
  expandBtn = headerButton('qpm-forecast-widget__btn', '▾', t('feature.forecastWidget.expand'), () => { setExpanded(!expanded); });
  expandBtn.setAttribute('aria-expanded', 'false');
  const close = headerButton('qpm-forecast-widget__btn', '×', t('feature.forecastWidget.close'), closeForecastWidget);
  header.append(headerIcon, title, expandBtn, close);
  return header;
}

function mountCard(): void {
  if (hasFloatingCard(CARD_KEY)) return;
  injectForecastWidgetStyles();
  const wrap = document.createElement('div');
  const linesEl = document.createElement('div');
  linesEl.className = 'qpm-forecast-widget__body';
  const extraEl = document.createElement('div');
  extraEl.className = 'qpm-forecast-widget__expanded';
  extraEl.hidden = true;
  wrap.append(linesEl, extraEl);
  body = linesEl;
  expandedEl = extraEl;
  openFloatingCard({
    key: CARD_KEY,
    className: 'qpm-forecast-widget',
    header: buildHeader(),
    body: wrap,
    persistKey: FORECAST_WIDGET_POSITION_KEY,
    defaultPosition: DEFAULT_POSITION,
    baseWidth: 240,
    retainPosition: true,
    dragExcludeSelectors: ['.qpm-forecast-widget__btn', '.qpm-forecast-widget__expanded'],
    onDestroy: teardown,
  });
  ensureSubscribed();
  cardCleanups.push(onDayCycleChange(render));
  // polling-justified: countdowns follow the wall clock and no game event fires as time passes; runs only while the card is open.
  cardCleanups.push(visibleInterval(TICK_ID, () => { ensureSubscribed(); render(); }, 1000));
  render();
  notifyOpen(true);
}

/** Starts the this-session weather log and reopens the card if it was open when the page last closed. */
export function startForecastWidget(): void {
  if (started) return;
  started = true;
  ensureSubscribed();
  if (storage.get<boolean>(FORECAST_WIDGET_OPEN_KEY, false) === true) mountCard();
}

export function stopForecastWidget(): void {
  started = false;
  closeFloatingCard(CARD_KEY);
  for (const fn of stateCleanups.splice(0)) {
    try { fn(); } catch { /* ignore */ }
  }
  subscribed = false;
  logState = EMPTY_WEATHER_LOG;
}

export function openForecastWidget(): void {
  storage.set(FORECAST_WIDGET_OPEN_KEY, true);
  mountCard();
}

export function closeForecastWidget(): void {
  storage.set(FORECAST_WIDGET_OPEN_KEY, false);
  closeFloatingCard(CARD_KEY);
}

export function isForecastWidgetOpen(): boolean {
  return hasFloatingCard(CARD_KEY);
}

export function onForecastWidgetOpenChange(cb: (open: boolean) => void): () => void {
  openListeners.add(cb);
  return () => { openListeners.delete(cb); };
}
