// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { WeatherDefSafe } from '../../utils/game/catalogHelpers';
import type { ExpandedInput, HistoryState } from './expanded';

vi.mock('../../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
}));

// literal-list-justified: test fixture in the live weatherCatalog shape (probed 2026-11-16), not runtime data.
const DEFS: Record<string, WeatherDefSafe> = {
  Rain: { id: 'Rain', name: 'Rain', groupId: 'Hydro', spriteKey: 'sprite/ui/RainIcon', mutation: 'Wet' },
  Frost: { id: 'Frost', name: 'Snow', groupId: 'Hydro', spriteKey: 'sprite/ui/FrostIcon', mutation: 'Chilled' },
  Dawn: { id: 'Dawn', name: 'Dawn', groupId: 'Lunar', spriteKey: 'sprite/ui/DawnIcon', mutation: 'Dawnlit' },
  AmberMoon: { id: 'AmberMoon', name: 'Amber Moon', groupId: 'Lunar', spriteKey: 'sprite/ui/AmberMoonIcon', mutation: 'Ambershine' },
};
const BADGES: Record<string, { color?: string; iconKey?: string }> = {
  Wet: { color: 'wet-colour', iconKey: 'sprite/ui/MutationWet' },
  Chilled: { color: 'chilled-colour', iconKey: 'sprite/ui/MutationChilled' },
};

vi.mock('../../utils/game/catalogHelpers', () => ({
  getMutationName: (id: string) => id,
  getWeatherDefsInGroupSafe: (group: string) => Object.values(DEFS).filter((d) => d.groupId === group),
}));
vi.mock('../../features/mutations/data/variantBadges', () => ({ findVariantBadge: (m: string) => BADGES[m] }));

const { renderExpanded, expandedLookSignature } = await import('./expanded');
const { CARD_SHELL_STYLE_ID } = await import('../shop/restockAlerts/cardShell');

const NOW = new Date(2026, 10, 16, 12, 0).getTime();
const MIN = 60_000;
const hhmm = (ms: number): string => new Date(ms).toLocaleString([], { hour: '2-digit', minute: '2-digit' });
const sprites = (key: string | null): string | null => (key ? `data:${key}` : null);

function input(over: Partial<ExpandedInput> = {}): ExpandedInput {
  return {
    upcoming: [
      { groupId: 'Hydro', weatherId: 'Frost', startsAtMs: NOW + 5 * MIN, endsAtMs: NOW + 10 * MIN },
      { groupId: 'Lunar', weatherId: null, startsAtMs: NOW + 30 * MIN, endsAtMs: NOW + 40 * MIN },
    ],
    log: [{ weatherId: 'Rain', startsAtMs: NOW - 20 * MIN, endsAtMs: NOW - 15 * MIN }],
    history: [{ weatherId: 'Frost', startsAtMs: NOW - 60 * MIN }],
    nowMs: NOW,
    weatherDef: (id: string) => DEFS[id] ?? null,
    spriteUrl: sprites,
    ...over,
  };
}

function render(over: Partial<ExpandedInput> = {}): [HTMLElement, HTMLElement, HTMLElement] {
  const host = document.createElement('div');
  renderExpanded(host, input(over));
  expect(host.childElementCount).toBe(3);
  return [...host.children] as [HTMLElement, HTMLElement, HTMLElement];
}
const rowsIn = (section: HTMLElement): HTMLElement[] => [...section.querySelectorAll<HTMLElement>('.qpm-forecast-widget__row')];
const textOf = (el: Element, sel: string): string | null | undefined => el.querySelector(sel)?.textContent;

describe('forecast expanded view', () => {
  it('three sections, every row on the tinted row component with its clock time', () => {
    const [upcoming, session, earlier] = render();
    expect(upcoming.textContent).toContain('feature.forecastWidget.upcoming');
    expect(session.textContent).toContain('feature.forecastWidget.thisSession');
    expect(earlier.textContent).toContain('feature.forecastWidget.earlier');

    const [snow, lunar] = rowsIn(upcoming) as [HTMLElement, HTMLElement];
    expect(snow.classList.contains('qpm-forecast-widget__row--card')).toBe(true);
    expect(snow.style.getPropertyValue('--qpm-alert-color')).toBe('chilled-colour');
    expect(textOf(snow, '.qpm-forecast-widget__label')).toBe('Snow');
    expect(textOf(snow, '.qpm-forecast-widget__time')).toBe(hhmm(NOW + 5 * MIN));
    expect(snow.title).toBe(`${hhmm(NOW + 5 * MIN)} – ${hhmm(NOW + 10 * MIN)}`);
    const chip = snow.querySelector<HTMLElement>('.qpm-alert-card__chip')!;
    expect(chip.title).toBe('Chilled');
    expect(chip.querySelector('img')?.getAttribute('src')).toBe('data:sprite/ui/MutationChilled');

    expect(lunar.querySelector('.qpm-forecast-widget__icons--faded')).not.toBeNull();
    expect([...lunar.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['data:sprite/ui/DawnIcon', 'data:sprite/ui/AmberMoonIcon']);
    expect(textOf(lunar, '.qpm-forecast-widget__label')).toBe('feature.forecastWidget.hiddenEvent {"group":"Lunar"}');
    expect(lunar.classList.contains('qpm-forecast-widget__row--tinted')).toBe(false);

    const [rain] = rowsIn(session) as [HTMLElement];
    expect(rain.style.getPropertyValue('--qpm-alert-color')).toBe('wet-colour');
    expect(textOf(rain, '.qpm-forecast-widget__time')).toBe(hhmm(NOW - 20 * MIN));
    expect(rain.title).toBe(`${hhmm(NOW - 20 * MIN)} – ${hhmm(NOW - 15 * MIN)}`);

    const [past] = rowsIn(earlier) as [HTMLElement];
    expect(textOf(past, '.qpm-forecast-widget__label')).toBe('Snow');
    expect(textOf(past, '.qpm-forecast-widget__time')).toBe(hhmm(NOW - 60 * MIN));
    expect(past.title).toBe('');
    expect(document.getElementById(CARD_SHELL_STYLE_ID)).not.toBeNull();
  });

  it('empty sections show their notes', () => {
    const [upcoming, session, earlier] = render({ upcoming: [], log: [], history: [] });
    expect(textOf(upcoming, '.qpm-forecast-widget__empty')).toBe('feature.forecastWidget.noneUpcoming');
    expect(textOf(session, '.qpm-forecast-widget__empty')).toBe('feature.forecastWidget.sessionEmpty');
    expect(textOf(earlier, '.qpm-forecast-widget__empty')).toBe('feature.forecastWidget.historyEmpty');
    expect(rowsIn(earlier)).toHaveLength(0);
  });

  it.each<[HistoryState, string]>([
    ['loading', 'common.loading'],
    ['error', 'feature.forecastWidget.historyError'],
  ])('EARLIER %s state', (history, text) => {
    const earlier = render({ history })[2];
    expect(rowsIn(earlier)).toHaveLength(0);
    expect(earlier.textContent).toContain(text);
  });

  it('look signature changes when a row sprite resolves late, and is stable otherwise', () => {
    const before = expandedLookSignature(input({ spriteUrl: (k) => (k === 'sprite/ui/RainIcon' ? null : sprites(k)) }));
    const after = expandedLookSignature(input());
    expect(before).not.toBe(after);
    expect(expandedLookSignature(input())).toBe(after);
  });
});
