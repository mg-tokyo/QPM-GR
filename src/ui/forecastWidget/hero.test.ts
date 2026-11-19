// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { WeatherDefSafe } from '../../utils/game/catalogHelpers';
import type { ForecastLine } from './model';

vi.mock('../../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
}));

// literal-list-justified: test fixture in the live weatherCatalog shape (probed 2026-11-16), not runtime data.
const DEFS: Record<string, WeatherDefSafe> = {
  Rain: { id: 'Rain', name: 'Rain', groupId: 'Hydro', spriteKey: 'sprite/ui/RainIcon', mutation: 'Wet' },
  Frost: { id: 'Frost', name: 'Snow', groupId: 'Hydro', spriteKey: 'sprite/ui/FrostIcon', mutation: 'Chilled' },
  Dawn: { id: 'Dawn', name: 'Dawn', groupId: 'Lunar', spriteKey: 'sprite/ui/DawnIcon', mutation: 'Dawnlit' },
  AmberMoon: { id: 'AmberMoon', name: 'Amber Moon', groupId: 'Lunar', spriteKey: 'sprite/ui/AmberMoonIcon', mutation: 'Ambershine' },
  Plain: { id: 'Plain', name: 'Plain', groupId: 'Hydro', spriteKey: 'sprite/ui/PlainIcon', mutation: null },
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

const { buildForecastView, heroSpriteKey } = await import('./hero');

const deps = { spriteUrl: (key: string | null) => (key ? `data:${key}` : null), weatherDef: (id: string) => DEFS[id] ?? null };
const line = (over: Partial<ForecastLine>): ForecastLine => ({
  key: 'k', kind: 'weather', label: null, weatherId: null, groupId: null, spriteKey: null, active: false, atMs: null, ...over,
});
const T0 = 1_000_000;
const RAIN_NOW = line({ key: 'active:Hydro', label: 'Rain', weatherId: 'Rain', groupId: 'Hydro', spriteKey: 'sprite/ui/RainIcon', active: true, atMs: T0 + 300_000 });
const SNOW_NEXT = line({ key: 'group:Hydro', label: 'Snow', weatherId: 'Frost', groupId: 'Hydro', spriteKey: 'sprite/ui/FrostIcon', atMs: T0 + 724_000 });
const LUNAR = line({ key: 'group:Lunar', kind: 'hidden', groupId: 'Lunar', atMs: T0 + 2_290_000 });
const NIGHTFALL = line({ key: 'night', kind: 'night', atMs: T0 + 3_730_000 });
const NIGHT = line({ key: 'night', kind: 'night', active: true, atMs: T0 + 200_000 });

function mount(lines: ForecastLine[], window: { startsAtMs: number; endsAtMs: number } | null, now = T0): HTMLElement {
  const host = document.createElement('div');
  const view = buildForecastView(lines, window, deps);
  host.append(...view.nodes);
  view.tick(now);
  return host;
}
const q = (host: Element, sel: string): HTMLElement | null => host.querySelector<HTMLElement>(sel);

describe('forecast hero', () => {
  it('running weather: tinted in its mutation colour, chip, ends-in countdown and window bar', () => {
    const host = mount([RAIN_NOW, LUNAR, NIGHTFALL], { startsAtMs: T0 - 300_000, endsAtMs: T0 + 300_000 });
    const hero = q(host, '.qpm-forecast-widget__hero')!;
    expect(hero.style.getPropertyValue('--qpm-alert-color')).toBe('wet-colour');
    expect(q(hero, '.qpm-alert-card__caption')?.textContent).toBe('feature.forecastWidget.nowCaption');
    expect(q(hero, '.qpm-alert-card__title')?.textContent).toBe('Rain');
    expect(q(hero, '.qpm-alert-card__icon img')?.getAttribute('src')).toBe('data:sprite/ui/RainIcon');
    const chip = q(hero, '.qpm-alert-card__chip')!;
    expect(chip.textContent).toBe('Wet');
    expect(chip.style.getPropertyValue('--qpm-chip-color')).toBe('wet-colour');
    expect(q(chip, 'img')?.getAttribute('src')).toBe('data:sprite/ui/MutationWet');
    expect(q(hero, '.qpm-alert-card__figure-value')?.textContent).toBe('5:00');
    expect(q(hero, '.qpm-alert-card__figure-label')?.textContent).toBe('feature.forecastWidget.endsInLabel');
    expect(hero.childElementCount).toBe(2);
    const fill = hero.lastElementChild?.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(heroSpriteKey([RAIN_NOW, NIGHTFALL])).toBe('sprite/ui/RainIcon');
  });

  it('rows: hidden Lunar event shows the group sprites faded; nightfall is dawn-tinted with the dusk icon', () => {
    const host = mount([RAIN_NOW, LUNAR, NIGHTFALL], null);
    expect(q(host, '.qpm-forecast-widget__hero')?.childElementCount).toBe(1);
    const rows = [...host.querySelectorAll<HTMLElement>('.qpm-forecast-widget__row')];
    expect(rows).toHaveLength(2);
    const [lunar, night] = rows as [HTMLElement, HTMLElement];
    expect(q(lunar, '.qpm-forecast-widget__icons--faded')).not.toBeNull();
    expect([...lunar.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['data:sprite/ui/DawnIcon', 'data:sprite/ui/AmberMoonIcon']);
    expect(lunar.classList.contains('qpm-forecast-widget__row--tinted')).toBe(false);
    expect(q(lunar, '.qpm-forecast-widget__time')?.textContent).toBe('feature.forecastWidget.in {"time":"38:10"}');
    expect(night.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-dawn)');
    expect(q(night, 'img')?.getAttribute('src')).toBe('data:sprite/ui/SunsetIcon');
    expect(q(night, '.qpm-forecast-widget__label')?.textContent).toBe('feature.forecastWidget.nightfall');
  });

  it('clear skies: info tint, "Clear skies", next event named with its countdown, next row carries its chip', () => {
    const host = mount([SNOW_NEXT, NIGHTFALL], null);
    const hero = q(host, '.qpm-forecast-widget__hero')!;
    expect(hero.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-info)');
    expect(q(hero, '.qpm-alert-card__title')?.textContent).toBe('feature.forecastWidget.clearSkies');
    expect(q(hero, '.qpm-alert-card__icon img')?.getAttribute('src')).toBe('data:sprite/ui/SunnyIcon');
    expect(q(hero, '.qpm-forecast-widget__hero-body')?.textContent).toBe('feature.forecastWidget.nextNamed {"name":"Snow"}');
    expect(q(hero, '.qpm-alert-card__figure-value')?.textContent).toBe('12:04');
    expect(q(hero, '.qpm-alert-card__figure-label')?.textContent).toBe('feature.forecastWidget.nextIn');
    expect(q(hero, '.qpm-alert-card__chip')).toBeNull();
    const snow = host.querySelector<HTMLElement>('.qpm-forecast-widget__row')!;
    expect(snow.style.getPropertyValue('--qpm-alert-color')).toBe('chilled-colour');
    const rowChip = q(snow, '.qpm-alert-card__chip')!;
    expect(rowChip.textContent).toBe('');
    expect(rowChip.title).toBe('Chilled');
    expect(rowChip.getAttribute('aria-label')).toBe('Chilled');
    expect(q(rowChip, 'img')?.getAttribute('src')).toBe('data:sprite/ui/MutationChilled');
  });

  it('clear skies with only the night ahead: no next line, no figure; night uses the midnight icon', () => {
    const host = mount([NIGHT], null);
    const hero = q(host, '.qpm-forecast-widget__hero')!;
    expect(q(hero, '.qpm-forecast-widget__hero-body')).toBeNull();
    expect(q(hero, '.qpm-alert-card__figure')).toBeNull();
    const night = host.querySelector<HTMLElement>('.qpm-forecast-widget__row')!;
    expect(q(night, 'img')?.getAttribute('src')).toBe('data:sprite/ui/MidnightIcon');
    expect(q(night, '.qpm-forecast-widget__time')?.textContent).toBe('feature.forecastWidget.endsIn {"time":"3:20"}');
  });

  it('a weather without a mutator gets the accent and no chip; a missing sprite leaves an empty box', () => {
    const plain = line({ key: 'active:Hydro', label: 'Plain', weatherId: 'Plain', groupId: 'Hydro', spriteKey: null, active: true, atMs: T0 + 60_000 });
    const host = mount([plain], null);
    const hero = q(host, '.qpm-forecast-widget__hero')!;
    expect(hero.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-accent)');
    expect(q(hero, '.qpm-alert-card__chip')).toBeNull();
    expect(q(hero, '.qpm-alert-card__icon img')).toBeNull();
    expect(q(host, '.qpm-forecast-widget__row')).toBeNull();
  });
});
