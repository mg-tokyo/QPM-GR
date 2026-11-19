// Forecast widget hero + rows (ALR-17.7, spec D5): tinted in the colour of the weather's mutation.
import { createProgressBar, createSectionHeader } from '../components';
import { createAlertChip, createIconBox, el, ensureCardShellStyles } from '../shop/restockAlerts/cardShell';
import { findVariantBadge } from '../../features/mutations/data/variantBadges';
import { getMutationName, getWeatherDefsInGroupSafe } from '../../utils/game/catalogHelpers';
import type { WeatherDefSafe } from '../../utils/game/catalogHelpers';
import { formatRestockCountdown } from '../../utils/formatters';
import { t } from '../../i18n';
import { weatherLook } from './model';
import type { ForecastLine } from './model';
import type { AlertChip } from '../../features/alertHub/raise';
import type { WeatherWindow } from '../../types/gameAtoms';

// Atlas keys checked live 2026-11-16; the game's weather station uses the same stage icons
// (beta client weatherStation/dayNightTabContent.ts:99-104).
const SPRITE_CLEAR = 'sprite/ui/SunnyIcon';
const SPRITE_DUSK = 'sprite/ui/SunsetIcon';
const SPRITE_NIGHT = 'sprite/ui/MidnightIcon';
const NIGHT_COLOR = 'var(--qpm-dawn)';
const CLEAR_COLOR = 'var(--qpm-info)';
const BAR_MAX = 1000;

export interface ForecastViewDeps {
  spriteUrl: (key: string | null) => string | null;
  weatherDef: (weatherId: string) => WeatherDefSafe | null;
}

export interface ForecastView {
  nodes: HTMLElement[];
  tick(nowMs: number): void;
}

interface LineLook {
  color: string | null;
  spriteKeys: string[];
  faded: boolean;
  chip: AlertChip | null;
}

export function lineLabel(line: ForecastLine): string {
  if (line.kind === 'night') return t(line.active ? 'feature.forecastWidget.night' : 'feature.forecastWidget.nightfall');
  if (line.kind === 'hidden') return t('feature.forecastWidget.hiddenEvent', { group: line.groupId ?? '' });
  return line.label ?? '';
}

function timeText(line: ForecastLine, now: number): string {
  if (line.atMs === null) return '—';
  const ms = line.atMs - now;
  if (ms <= 0) return t('feature.forecastWidget.now');
  const time = formatRestockCountdown(ms);
  return t(line.active ? 'feature.forecastWidget.endsIn' : 'feature.forecastWidget.in', { time });
}

function lineLook(line: ForecastLine, deps: ForecastViewDeps): LineLook {
  if (line.kind === 'night') return { color: NIGHT_COLOR, spriteKeys: [line.active ? SPRITE_NIGHT : SPRITE_DUSK], faded: false, chip: null };
  if (line.kind === 'hidden') {
    const keys = line.groupId ? getWeatherDefsInGroupSafe(line.groupId).map((d) => d.spriteKey) : [];
    return { color: null, spriteKeys: [...new Set(keys.filter((k): k is string => k !== null))], faded: true, chip: null };
  }
  const look = weatherLook(line.weatherId ? deps.weatherDef(line.weatherId) : null, findVariantBadge);
  const iconUrl = look ? deps.spriteUrl(look.iconKey) : null;
  const chip: AlertChip | null = look
    ? { text: getMutationName(look.mutation), ...(look.color ? { color: look.color } : {}), ...(iconUrl ? { iconUrl } : {}) }
    : null;
  return { color: look?.color ?? null, spriteKeys: line.spriteKey ? [line.spriteKey] : [], faded: false, chip };
}

const runningLine = (lines: readonly ForecastLine[]): ForecastLine | null =>
  lines.find((l) => l.active && l.kind !== 'night') ?? null;

export function heroSpriteKey(lines: readonly ForecastLine[]): string | null {
  const running = runningLine(lines);
  return running ? running.spriteKey : SPRITE_CLEAR;
}

/** Changes when a resolved sprite, colour or chip icon appears (sprites and catalogs load late). */
export function lookSignature(lines: readonly ForecastLine[], deps: ForecastViewDeps): string {
  const hero = deps.spriteUrl(heroSpriteKey(lines)) ? 'h' : '-';
  return hero + lines.map((l) => {
    const look = lineLook(l, deps);
    return `${look.spriteKeys.map((k) => (deps.spriteUrl(k) ? 'i' : '-')).join('')}${look.color ?? ''}${look.chip?.iconUrl ? 'c' : ''}`;
  }).join('|');
}

// Icon only, name on hover (user 2026-11-16 at the live check): a named chip clipped "Thunderstorm" at 240 px.
function createRowChip(chip: AlertChip): HTMLSpanElement {
  if (!chip.iconUrl) return createAlertChip(chip);
  const node = createAlertChip({ ...chip, text: '' });
  node.classList.add('qpm-forecast-widget__chip--icon');
  node.title = chip.text;
  node.setAttribute('aria-label', chip.text);
  return node;
}

/** One tinted line row; the caller fills `time` (countdown here, clock times in the expanded view). */
export function createForecastRow(line: ForecastLine, deps: ForecastViewDeps): { row: HTMLElement; time: HTMLElement } {
  const look = lineLook(line, deps);
  const row = el('div', 'qpm-forecast-widget__row qpm-forecast-widget__row--card');
  if (look.color) {
    row.style.setProperty('--qpm-alert-color', look.color);
    row.classList.add('qpm-forecast-widget__row--tinted');
  }
  const icons = el('span', `qpm-forecast-widget__icons${look.faded ? ' qpm-forecast-widget__icons--faded' : ''}`);
  for (const key of look.spriteKeys) {
    const url = deps.spriteUrl(key);
    if (!url) continue;
    const img = el('img', 'qpm-forecast-widget__icon');
    img.src = url;
    img.alt = '';
    icons.append(img);
  }
  if (icons.childElementCount === 0) icons.append(el('span', 'qpm-forecast-widget__icon'));
  const label = el('span', 'qpm-forecast-widget__label');
  label.textContent = lineLabel(line);
  const time = el('span', 'qpm-forecast-widget__time');
  row.append(icons, label);
  if (look.chip) row.append(createRowChip(look.chip));
  row.append(time);
  return { row, time };
}

function createHero(lines: readonly ForecastLine[], window: WeatherWindow | null, deps: ForecastViewDeps): ForecastView {
  const running = runningLine(lines);
  const next = running ? null : lines.find((l) => l.kind !== 'night') ?? null;
  const look = running ? lineLook(running, deps) : null;
  const color = running ? look?.color ?? 'var(--qpm-accent)' : CLEAR_COLOR;
  const root = el('div', 'qpm-forecast-widget__hero');
  root.style.setProperty('--qpm-alert-color', color);

  const top = el('div', 'qpm-forecast-widget__hero-top');
  const url = deps.spriteUrl(heroSpriteKey(lines));
  const icon = url ? createIconBox(url, '', 'lg') : el('div', 'qpm-alert-card__icon');
  const text = el('div', 'qpm-alert-card__text');
  const caption = el('div', 'qpm-alert-card__caption');
  caption.textContent = t('feature.forecastWidget.nowCaption');
  const title = el('div', 'qpm-alert-card__title');
  title.textContent = running ? lineLabel(running) : t('feature.forecastWidget.clearSkies');
  text.append(caption, title);
  if (look?.chip) {
    const chips = el('div', 'qpm-alert-card__chips');
    chips.append(createAlertChip(look.chip));
    text.append(chips);
  } else if (next) {
    const body = el('div', 'qpm-forecast-widget__hero-body');
    body.textContent = t('feature.forecastWidget.nextNamed', { name: lineLabel(next) });
    text.append(body);
  }
  top.append(icon, text);

  const target = running?.atMs ?? next?.atMs ?? null;
  const value = el('div', 'qpm-alert-card__figure-value');
  if (target !== null) {
    const figure = el('div', 'qpm-alert-card__figure');
    const label = el('div', 'qpm-alert-card__figure-label');
    label.textContent = t(running ? 'feature.forecastWidget.endsInLabel' : 'feature.forecastWidget.nextIn');
    figure.append(value, label);
    top.append(figure);
  }
  root.append(top);

  const span = running && window ? window.endsAtMs - window.startsAtMs : 0;
  const bar = span > 0 ? createProgressBar({ value: 0, max: BAR_MAX, color, height: 4 }) : null;
  if (bar) root.append(bar.root);

  return {
    nodes: [root],
    tick(now) {
      if (target !== null) value.textContent = formatRestockCountdown(target - now);
      if (bar && window) bar.update(Math.min(BAR_MAX, Math.max(0, ((now - window.startsAtMs) / span) * BAR_MAX)));
    },
  };
}

/** Hero for the running weather (or clear sky), then one row per other line. */
export function buildForecastView(lines: readonly ForecastLine[], window: WeatherWindow | null, deps: ForecastViewDeps): ForecastView {
  ensureCardShellStyles();
  const hero = createHero(lines, window, deps);
  const running = runningLine(lines);
  const rows = lines.filter((l) => l !== running).map((line) => ({ line, ...createForecastRow(line, deps) }));
  const nodes = [...hero.nodes];
  if (rows.length > 0) nodes.push(createSectionHeader(t('feature.forecastWidget.next'), { size: 'compact' }).root);
  nodes.push(...rows.map((r) => r.row));
  return {
    nodes,
    tick(now) {
      hero.tick(now);
      for (const r of rows) r.time.textContent = timeText(r.line, now);
    },
  };
}
