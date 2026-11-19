// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const timer = vi.hoisted(() => ({ cb: null as (() => void) | null, stops: 0, starts: 0 }));
vi.mock('../../../utils/scheduling/timerManager', () => ({
  visibleInterval: (_id: string, cb: () => void) => {
    timer.cb = cb;
    timer.starts += 1;
    return () => { timer.cb = null; timer.stops += 1; };
  },
}));
vi.mock('../../../utils/formatters', () => ({
  formatRestockCountdown: (ms: number) => `${Math.max(0, Math.floor(ms / 1000))}s`,
}));

import { applyCardColor, applyCardScale, createIconBox, createMetaRow, createSpriteStrip, ensureCardShellStyles, getCountdownStats } from './cardShell';

const NOW = 1_000_000;

describe('card shell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    Object.assign(timer, { cb: null, stops: 0, starts: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('accent sets the colour and the glow class; level colours only without an accent', () => {
    const a = document.createElement('div');
    applyCardColor(a, 'var(--qpm-dawn)', 'warn');
    expect([a.style.getPropertyValue('--qpm-alert-color'), a.classList.contains('qpm-alert-card--accent'), a.dataset.qpmAlertLevel]).toEqual(['var(--qpm-dawn)', true, 'warn']);
    const w = document.createElement('div');
    applyCardColor(w, undefined, 'warn');
    expect([w.style.getPropertyValue('--qpm-alert-color'), w.classList.contains('qpm-alert-card--accent')]).toEqual(['var(--qpm-warning)', false]);
    const e = document.createElement('div');
    applyCardColor(e, undefined, 'error');
    expect(e.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-danger)');
    const i = document.createElement('div');
    applyCardColor(i, undefined, undefined);
    expect([i.style.getPropertyValue('--qpm-alert-color'), i.dataset.qpmAlertLevel]).toEqual(['', 'info']);
  });

  it('card scale sets the zoom variable; 1 clears it; compact sizes are scoped to stack cards (ALR-17.11a)', () => {
    const card = document.createElement('div');
    applyCardScale(card, 1.3);
    expect(card.style.getPropertyValue('--qpm-alert-scale')).toBe('1.3');
    applyCardScale(card, 1);
    expect(card.style.getPropertyValue('--qpm-alert-scale')).toBe('');
    ensureCardShellStyles();
    const css = document.getElementById('qpm-alert-card-style')?.textContent ?? '';
    expect(css).toContain('.qpm-alert-card{');
    expect(css).toMatch(/\.qpm-alert-card\{[^}]*width:240px;[^}]*padding:6px;[^}]*zoom:var\(--qpm-alert-scale, 1\)/);
    expect(css).toContain('.qpm-alert-card>.qpm-alert-card__top>.qpm-alert-card__icon{width:32px;height:32px;}');
    expect(css).toContain('.qpm-alert-card .qpm-alert-card__title{font-size:var(--qpm-font-body);}');
    expect(css).toMatch(/\.qpm-alert-card__icon\{position:relative;flex-shrink:0;width:40px;height:40px;/);
  });

  it('icon boxes are smooth, sized by class, and show a count only above one', () => {
    const lg = createIconBox('data:a', 'Pet', 'lg');
    expect([lg.className, lg.querySelector('img')?.style.imageRendering, lg.querySelector('.qpm-alert-card__count')]).toEqual(['qpm-alert-card__icon', '', null]);
    const strip = createSpriteStrip([{ url: 'data:1' }, { url: 'data:2', count: 3 }, { url: 'data:3', count: 1 }], 'Egg');
    const boxes = [...strip.children];
    expect(boxes.map((b) => b.classList.contains('qpm-alert-card__icon--sm'))).toEqual([true, true, true]);
    expect(boxes.map((b) => b.querySelector('.qpm-alert-card__count')?.textContent ?? null)).toEqual([null, 'x3', null]);
  });

  it('meta row stays hidden until chips or a figure arrive; chips carry colour and icon', () => {
    const meta = createMetaRow();
    expect(meta.row.style.display).toBe('none');
    meta.setChips([{ text: 'Frozen', color: 'var(--qpm-info)', iconUrl: 'data:m' }, { text: '6/6' }]);
    expect(meta.row.style.display).toBe('');
    const chips = [...meta.row.querySelectorAll<HTMLElement>('.qpm-alert-card__chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Frozen', '6/6']);
    expect(chips[0]?.style.getPropertyValue('--qpm-chip-color')).toBe('var(--qpm-info)');
    expect(chips[1]?.style.getPropertyValue('--qpm-chip-color')).toBe('var(--qpm-alert-color, var(--qpm-accent))');
    expect(chips[0]?.querySelector('img')?.getAttribute('src')).toBe('data:m');
    expect((meta.row.querySelector('.qpm-alert-card__figure') as HTMLElement).style.display).toBe('none');
    meta.setChips([]);
    expect(meta.row.style.display).toBe('none');
  });

  it('a value figure shows value over label and starts no timer', () => {
    const meta = createMetaRow();
    meta.setFigure({ value: '12', label: 'Crops' });
    expect(meta.row.querySelector('.qpm-alert-card__figure-value')?.textContent).toBe('12');
    expect(meta.row.querySelector('.qpm-alert-card__figure-label')?.textContent).toBe('Crops');
    expect(getCountdownStats()).toEqual({ cards: 0, ticking: false });
  });

  it('countdowns share one timer, tick, drop at zero, and the timer stops with the last', () => {
    const a = createMetaRow();
    const b = createMetaRow();
    document.body.append(a.row, b.row);
    a.setFigure({ countdownTo: NOW + 3_000, label: 'Max STR in' });
    b.setFigure({ countdownTo: NOW + 10_000, label: 'Ends in' });
    const value = (m: typeof a): string | null | undefined => m.row.querySelector('.qpm-alert-card__figure-value')?.textContent;
    expect([value(a), value(b), timer.starts]).toEqual(['3s', '10s', 1]);
    vi.setSystemTime(NOW + 3_000);
    timer.cb?.();
    expect([value(a), getCountdownStats()]).toEqual(['0s', { cards: 1, ticking: true }]);
    b.dispose();
    expect([getCountdownStats(), timer.stops]).toEqual([{ cards: 0, ticking: false }, 1]);
  });

  it('switching a countdown figure to a value releases the timer', () => {
    const m = createMetaRow();
    document.body.append(m.row);
    m.setFigure({ countdownTo: NOW + 5_000, label: 'Ends in' });
    expect(getCountdownStats().ticking).toBe(true);
    m.setFigure({ value: '3', label: 'Eggs' });
    expect([getCountdownStats(), m.row.querySelector('.qpm-alert-card__figure-value')?.textContent]).toEqual([{ cards: 0, ticking: false }, '3']);
  });

  it('a countdown already past starts no timer; a detached card drops on the next tick', () => {
    const past = createMetaRow();
    past.setFigure({ countdownTo: NOW - 1, label: 'Ends in' });
    expect(getCountdownStats()).toEqual({ cards: 0, ticking: false });
    const loose = createMetaRow();
    loose.setFigure({ countdownTo: NOW + 5_000, label: 'Ends in' });
    timer.cb?.();
    expect(getCountdownStats()).toEqual({ cards: 0, ticking: false });
  });
});
