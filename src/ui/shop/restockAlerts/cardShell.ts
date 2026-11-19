import type { NotificationLevel } from '../../../core/notifications';
import type { AlertChip, AlertFigure, AlertSprite } from '../../../features/alertHub/raise';
import { visibleInterval } from '../../../utils/scheduling/timerManager';
import { formatRestockCountdown } from '../../../utils/formatters';
import { ALERT_ENTER_MS, ALERT_EXIT_MS, ALERT_ROOT_ID } from './types';

export const CARD_SHELL_STYLE_ID = 'qpm-alert-card-style';
export const COUNTDOWN_TIMER_ID = 'alert-card-countdown';

const COLOR = 'var(--qpm-alert-color, var(--qpm-accent))';
const tint = (c: string, pct: number): string => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

const SHELL_CSS = [
  `#${ALERT_ROOT_ID}{position:fixed;top:18px;right:18px;z-index:2147483600;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100vw - 36px);max-height:90vh;overflow:visible;pointer-events:none;}`,
  '@keyframes qpm-alert-enter{0%{opacity:0;transform:translateY(-100%)}70%{opacity:1;transform:translateY(6px)}85%{transform:translateY(-2px)}100%{transform:translateY(0)}}',
  '@keyframes qpm-alert-exit{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-100%)}}',
  `.qpm-alert-card{pointer-events:auto;box-sizing:border-box;font-family:var(--qpm-font);color:var(--qpm-text);background:var(--qpm-surface-window);border:1px solid var(--qpm-alert-color, var(--qpm-accent-border));border-radius:var(--qpm-radius-md);box-shadow:var(--qpm-shadow-subtle);width:240px;max-width:100%;padding:6px;display:flex;flex-direction:column;gap:6px;zoom:var(--qpm-alert-scale, 1);animation:qpm-alert-enter ${ALERT_ENTER_MS}ms cubic-bezier(0.22,1,0.36,1) both;will-change:transform,opacity;}`,
  `.qpm-alert-card--accent{box-shadow:0 0 0 1px ${tint(COLOR, 38)},0 0 12px ${tint(COLOR, 15)},var(--qpm-shadow-subtle);}`,
  `.qpm-alert-card--exit{animation:qpm-alert-exit ${ALERT_EXIT_MS}ms cubic-bezier(0.55,0,1,0.45) both;pointer-events:none;}`,
  '.qpm-alert-card__top{display:flex;align-items:flex-start;gap:8px;}',
  `.qpm-alert-card__icon{position:relative;flex-shrink:0;width:40px;height:40px;border-radius:var(--qpm-radius-md);display:flex;align-items:center;justify-content:center;background:${tint(COLOR, 15)};border:1px solid ${tint(COLOR, 38)};box-sizing:border-box;}`,
  '.qpm-alert-card__icon img{width:32px;height:32px;object-fit:contain;}',
  '.qpm-alert-card__icon--sm{width:28px;height:28px;border-radius:var(--qpm-radius-sm);}',
  '.qpm-alert-card__icon--sm img{width:22px;height:22px;}',
  '.qpm-alert-card__count{position:absolute;right:-2px;bottom:-2px;padding:0 2px;border-radius:var(--qpm-radius-sm);background:var(--qpm-surface-1);font-size:var(--qpm-font-xs);font-weight:var(--qpm-weight-bold);line-height:1.3;color:var(--qpm-text);font-variant-numeric:tabular-nums;}',
  '.qpm-alert-card__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
  '.qpm-alert-card__caption{font-size:var(--qpm-font-caption);font-weight:var(--qpm-weight-semibold);letter-spacing:0.5px;text-transform:uppercase;color:var(--qpm-alert-color, var(--qpm-text-muted));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.qpm-alert-card__title{font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-bold);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.qpm-alert-card__body{font-size:var(--qpm-font-body);line-height:1.35;color:var(--qpm-text-muted);}',
  '.qpm-alert-card__close{flex-shrink:0;background:none;border:none;color:var(--qpm-text-muted);font-size:var(--qpm-font-subtitle);line-height:1;cursor:pointer;padding:0 4px;transition:color 0.15s ease;}',
  '.qpm-alert-card__close:hover{color:var(--qpm-text);}',
  '.qpm-alert-card__sprites{display:flex;gap:4px;}',
  '.qpm-alert-card__meta{display:flex;align-items:flex-end;gap:8px;}',
  '.qpm-alert-card__chips{display:flex;flex-wrap:wrap;gap:4px;min-width:0;flex:1;}',
  `.qpm-alert-card__chip{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:var(--qpm-radius-pill);font-size:var(--qpm-font-caption);font-weight:var(--qpm-weight-semibold);line-height:1.4;white-space:nowrap;color:var(--qpm-chip-color);background:${tint('var(--qpm-chip-color)', 15)};border:1px solid ${tint('var(--qpm-chip-color)', 38)};}`,
  '.qpm-alert-card__chip img{width:12px;height:12px;object-fit:contain;}',
  '.qpm-alert-card__figure{display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;margin-left:auto;}',
  '.qpm-alert-card__figure-value{font-size:var(--qpm-font-title);font-weight:var(--qpm-weight-bold);font-variant-numeric:tabular-nums;letter-spacing:-0.3px;line-height:1.15;white-space:nowrap;color:var(--qpm-alert-color, var(--qpm-text));}',
  '.qpm-alert-card__figure-label{font-size:var(--qpm-font-caption);letter-spacing:0.5px;text-transform:uppercase;color:var(--qpm-text-muted);white-space:nowrap;}',
  '.qpm-alert-card__actions{display:flex;gap:6px;align-items:center;}',
  '.qpm-alert-card button:disabled{opacity:0.5;}',
  '.qpm-alert-card__icon-fallback{font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-bold);color:var(--qpm-text-muted);}',
  '.qpm-alert-card__lines{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:var(--qpm-font-body);}',
  '.qpm-alert-card__qty{color:var(--qpm-text);font-variant-numeric:tabular-nums;white-space:nowrap;}',
  '.qpm-alert-card__status{min-width:0;color:var(--qpm-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.qpm-alert-card__icon-btn{flex-shrink:0;background:none;border:none;border-radius:var(--qpm-radius-sm);color:var(--qpm-text-muted);font-size:var(--qpm-font-subtitle);line-height:1;cursor:pointer;padding:2px 4px;transition:color 0.15s ease,background 0.15s ease;}',
  '.qpm-alert-card__icon-btn:hover{color:var(--qpm-text);background:var(--qpm-surface-1);}',
  // Compact stack cards (user 2026-11-15); the centre, History and settings windows keep the 40 px box.
  '.qpm-alert-card>.qpm-alert-card__top>.qpm-alert-card__icon{width:32px;height:32px;}',
  '.qpm-alert-card>.qpm-alert-card__top>.qpm-alert-card__icon img{width:26px;height:26px;}',
  '.qpm-alert-card .qpm-alert-card__title{font-size:var(--qpm-font-body);}',
].join('');

export function ensureCardShellStyles(): void {
  if (document.getElementById(CARD_SHELL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CARD_SHELL_STYLE_ID;
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

const LEVEL_COLOR: Record<NotificationLevel, string | null> = {
  info: null,
  success: 'var(--qpm-positive)',
  warn: 'var(--qpm-warning)',
  error: 'var(--qpm-danger)',
};

/** The accent wins (border + glow); without one, warn/error/success colour the border only. */
export function applyCardColor(card: HTMLElement, accent: string | undefined, level: NotificationLevel | undefined): void {
  const color = accent ?? LEVEL_COLOR[level ?? 'info'];
  if (color) card.style.setProperty('--qpm-alert-color', color);
  card.classList.toggle('qpm-alert-card--accent', accent !== undefined);
  card.dataset.qpmAlertLevel = level ?? 'info';
}

/** Scales the whole card (text, sprites, buttons); 1 clears it. */
export function applyCardScale(card: HTMLElement, scale: number): void {
  if (scale === 1) card.style.removeProperty('--qpm-alert-scale');
  else card.style.setProperty('--qpm-alert-scale', String(scale));
}

export function createIconBox(src: string, alt: string, size: 'lg' | 'sm', count?: number): HTMLDivElement {
  const box = el('div', size === 'lg' ? 'qpm-alert-card__icon' : 'qpm-alert-card__icon qpm-alert-card__icon--sm');
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.decoding = 'async';
  box.append(img);
  if (count !== undefined && count > 1) {
    const badge = el('span', 'qpm-alert-card__count');
    badge.textContent = `x${count}`;
    box.append(badge);
  }
  return box;
}

export function createSpriteStrip(sprites: AlertSprite[], alt: string): HTMLDivElement {
  const strip = el('div', 'qpm-alert-card__sprites');
  for (const s of sprites) strip.append(createIconBox(s.url, alt, 'sm', s.count));
  return strip;
}

const countdowns = new Map<HTMLElement, number>();
let stopTick: (() => void) | null = null;

function renderCountdown(target: HTMLElement, to: number): boolean {
  const left = to - Date.now();
  target.textContent = formatRestockCountdown(left);
  return left > 0;
}

function stopTickerIfIdle(): void {
  if (countdowns.size > 0 || !stopTick) return;
  stopTick();
  stopTick = null;
}

function tick(): void {
  for (const [target, to] of countdowns) {
    if (!target.isConnected || !renderCountdown(target, to)) countdowns.delete(target);
  }
  stopTickerIfIdle();
}

function trackCountdown(target: HTMLElement, to: number): void {
  if (!renderCountdown(target, to)) { untrackCountdown(target); return; }
  countdowns.set(target, to);
  if (stopTick) return;
  // polling-justified: a countdown is wall-clock time; nothing in the game fires once a second for it.
  // One shared timer, alive only while a countdown card is open and still above 0:00.
  stopTick = visibleInterval(COUNTDOWN_TIMER_ID, tick, 1000);
}

export function untrackCountdown(target: HTMLElement): void {
  countdowns.delete(target);
  stopTickerIfIdle();
}

export function getCountdownStats(): { cards: number; ticking: boolean } {
  return { cards: countdowns.size, ticking: stopTick !== null };
}

export function createAlertChip(c: AlertChip): HTMLSpanElement {
  const chip = el('span', 'qpm-alert-card__chip');
  chip.style.setProperty('--qpm-chip-color', c.color ?? COLOR);
  if (c.iconUrl) {
    const img = document.createElement('img');
    img.src = c.iconUrl;
    img.alt = '';
    chip.append(img);
  }
  chip.append(c.text);
  return chip;
}

export interface CardMetaRow {
  row: HTMLDivElement;
  setChips(chips: AlertChip[]): void;
  setFigure(figure: AlertFigure): void;
  dispose(): void;
}

/** Chips on the left, the big figure on the right; hidden while both are empty. */
export function createMetaRow(): CardMetaRow {
  const row = el('div', 'qpm-alert-card__meta');
  const chipsEl = el('div', 'qpm-alert-card__chips');
  const figureEl = el('div', 'qpm-alert-card__figure');
  const valueEl = el('div', 'qpm-alert-card__figure-value');
  const labelEl = el('div', 'qpm-alert-card__figure-label');
  figureEl.append(valueEl, labelEl);
  row.append(chipsEl, figureEl);
  let hasFigure = false;

  const sync = (): void => {
    figureEl.style.display = hasFigure ? '' : 'none';
    row.style.display = hasFigure || chipsEl.childElementCount > 0 ? '' : 'none';
  };

  sync();
  return {
    row,
    setChips(chips) {
      chipsEl.replaceChildren(...chips.map(createAlertChip));
      sync();
    },
    setFigure(figure) {
      hasFigure = true;
      labelEl.textContent = figure.label;
      if ('countdownTo' in figure) {
        trackCountdown(valueEl, figure.countdownTo);
      } else {
        untrackCountdown(valueEl);
        valueEl.textContent = figure.value;
      }
      sync();
    },
    dispose() {
      untrackCountdown(valueEl);
    },
  };
}
