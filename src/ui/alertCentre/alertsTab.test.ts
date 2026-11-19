// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertRowDef } from '../../features/alertHub';
import type { LinkedRow } from './linkedRows';

vi.mock('../../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
}));

const rows = new Map<string, AlertRowDef>();
const stored = new Map<string, { enabled: boolean; soundId: string }>();
let soundsOn = true;
const sizes = new Map<string, number>();
const previewed: Array<[string, number]> = [];
const desktop: { on: boolean; availability: string; permission: NotificationPermission | null; discord: boolean } = {
  on: false, availability: 'available', permission: 'default', discord: false,
};
const desktopRows = new Set<string>();
let promptAnswer: NotificationPermission = 'granted';
let requests = 0;
vi.mock('../../features/alertHub', () => {
  const settings = (id: string, defaultSound: string, defaultEnabled = false) =>
    stored.get(id) ?? { enabled: defaultEnabled, soundId: defaultSound };
  const def = (id: string) => rows.get(id);
  return {
    listAlertRows: () => [...rows.values()],
    getAlertRowSettings: settings,
    setAlertRowEnabled: (id: string, enabled: boolean) => {
      const d = def(id);
      stored.set(id, { ...settings(id, d?.defaultSound ?? 'none', d?.defaultEnabled), enabled });
    },
    setAlertRowSound: (id: string, soundId: string) => {
      const d = def(id);
      stored.set(id, { ...settings(id, d?.defaultSound ?? 'none', d?.defaultEnabled), soundId });
    },
    ALERT_CARD_SIZE: { min: 0.7, max: 1.3, step: 0.1, default: 1 },
    getRowCardSize: (id: string) => sizes.get(id) ?? 1,
    setAlertRowCardSize: (id: string, size: number) => { sizes.set(id, size); return size; },
    previewAlertRowCardSize: (id: string, size: number) => { previewed.push([id, size]); },
    areAlertSoundsOn: () => soundsOn,
    setAlertSoundsOn: (on: boolean) => { soundsOn = on; },
    getDesktopState: () => ({ ...desktop, availability: desktop.permission === 'denied' ? 'blocked' : desktop.availability }),
    isRowDesktop: (id: string) => desktopRows.has(id),
    setRowDesktop: (id: string, on: boolean) => { if (on) desktopRows.add(id); else desktopRows.delete(id); },
    setDesktopOn: (on: boolean) => { desktop.on = on; },
    requestDesktopPermission: () => {
      requests += 1;
      if (desktop.permission === 'default') desktop.permission = promptAnswer;
      return Promise.resolve(desktop.permission);
    },
    resolveRowLabel: (d: AlertRowDef) => d.labelKey,
    resolveRowIcon: (d: AlertRowDef | null) => d?.icon?.() ?? null,
    resolveRowSummary: (d: AlertRowDef | null) => d?.summary?.() ?? null,
    resolveRowAccent: (d: AlertRowDef | null) => (typeof d?.accent === 'function' ? d.accent() : d?.accent ?? null),
  };
});
const atlas = new Set<string>();
vi.mock('../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getAnySpriteDataUrl: (key: string) => (atlas.has(key) ? `data:${key}` : ''),
  onSpritesReady: () => () => { /* already ready in tests */ },
}));
vi.mock('../shop/restockAlerts/soundConfig', () => ({ BUILTIN_SOUNDS: [{ id: 'chime', name: 'Chime' }], getCustomSounds: () => ({}) }));
vi.mock('../shop/restockAlerts/soundEngine', () => ({ previewSound: vi.fn() }));
let linked: LinkedRow[] = [];
vi.mock('./linkedRows', () => ({ getLinkedRows: () => linked }));

import { renderAlertsTab } from './alertsTab';

let hungerSummary = 'below 25';
let container: HTMLElement;
let cleanup: () => void;

function card(id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-qpm-alert-centre-row="${id}"]`);
  if (!found) throw new Error(`no card ${id}`);
  return found;
}
const toggleOf = (id: string): HTMLButtonElement => card(id).querySelector<HTMLButtonElement>('.qpm-alert-centre-card__controls [role="switch"]')!;
const tickOf = (id: string): HTMLButtonElement | null =>
  card(id).querySelector<HTMLButtonElement>(`[data-qpm-alert-centre-desktop-tick="${id}"] [role="switch"]`);
const desktopCard = (): HTMLElement => container.querySelector<HTMLElement>('[data-qpm-alert-centre-desktop]')!;
const masterText = (): string => container.querySelector('[data-qpm-alert-centre-master] .qpm-alert-centre-card__summary')!.textContent ?? '';
const badgeOf = (group: string): string | null =>
  container.querySelector(`[data-qpm-alert-centre-group="${group}"] span[style*="border-radius"]`)?.textContent ?? null;

beforeEach(() => {
  rows.clear();
  stored.clear();
  sizes.clear();
  previewed.length = 0;
  soundsOn = true;
  Object.assign(desktop, { on: false, availability: 'available', permission: 'default', discord: false });
  desktopRows.clear();
  promptAnswer = 'granted';
  requests = 0;
  atlas.clear();
  atlas.add('sprite/ui/NotifierBellOn');
  hungerSummary = 'below 25';
  rows.set('pets.hunger', {
    id: 'pets.hunger', group: 'pets', labelKey: 'hunger', defaultSound: 'chime',
    icon: () => 'data:pet', summary: () => hungerSummary, accent: 'var(--qpm-hunger-low)', settingsAction: () => {},
  });
  rows.set('pets.trough', { id: 'pets.trough', group: 'pets', labelKey: 'trough', defaultSound: 'none' });
  const subs: Array<(on: boolean) => void> = [];
  let bagOn = true;
  linked = [
    {
      id: 'linked.restock', group: 'shops', labelKey: 'restock', noteKey: 'note', open: () => {}, summary: () => 'pins', accent: 'var(--qpm-accent)',
      cardSize: { get: () => sizes.get('linked.restock') ?? 1, preview: (v) => { previewed.push(['linked.restock', v]); }, commit: (v) => { sizes.set('linked.restock', v); } },
    },
    {
      id: 'linked.bagFull', group: 'garden', labelKey: 'bag', noteKey: 'note', open: () => {},
      toggle: { get: () => bagOn, set: (on) => { bagOn = on; for (const s of subs) s(on); }, subscribe: (cb) => { subs.push(cb); return () => { subs.splice(subs.indexOf(cb), 1); }; } },
    },
  ];
  container = document.createElement('div');
  container.dataset.qpmAlertCentreTab = 'alerts';
  document.body.append(container);
  cleanup = renderAlertsTab(container);
});

afterEach(() => {
  cleanup();
  container.remove();
});

describe('centre Alerts tab (ALR-17.5)', () => {
  it('renders one card per row with its data attribute, name, summary and icon', () => {
    expect(container.querySelectorAll('[data-qpm-alert-centre-row]').length).toBe(4);
    const hunger = card('pets.hunger');
    expect(hunger.querySelector('.qpm-alert-centre-card__name')?.textContent).toBe('hunger');
    expect(hunger.querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('below 25');
    expect(hunger.querySelector('img')?.getAttribute('src')).toBe('data:pet');
    expect(card('pets.trough').querySelector('.qpm-alert-card__icon-fallback')?.textContent).toBe('T');
    expect(card('linked.restock').textContent).toContain('feature.alertCentre.open');
  });

  it('counts follow toggles in the group badge and the master card', () => {
    expect(masterText()).toBe('feature.alertCentre.master.count {"on":1,"total":3}');
    expect(badgeOf('pets')).toBe('feature.alertCentre.groupCount {"on":0,"total":2}');
    expect(badgeOf('shops')).toBeNull();
    toggleOf('pets.hunger').click();
    expect(stored.get('pets.hunger')?.enabled).toBe(true);
    expect(badgeOf('pets')).toBe('feature.alertCentre.groupCount {"on":1,"total":2}');
    expect(masterText()).toBe('feature.alertCentre.master.count {"on":2,"total":3}');
    toggleOf('linked.bagFull').click();
    expect(badgeOf('garden')).toBe('feature.alertCentre.groupCount {"on":0,"total":1}');
    expect(masterText()).toBe('feature.alertCentre.master.count {"on":1,"total":3}');
  });

  it('border colour follows on/off', () => {
    const hunger = card('pets.hunger');
    expect(hunger.classList.contains('qpm-alert-centre-card--on')).toBe(false);
    expect(hunger.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-text-muted)');
    toggleOf('pets.hunger').click();
    expect(hunger.classList.contains('qpm-alert-centre-card--on')).toBe(true);
    expect(hunger.dataset.qpmAlertCentreOn).toBe('true');
    expect(hunger.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-hunger-low)');
    expect(card('linked.restock').classList.contains('qpm-alert-centre-card--on')).toBe(true);
  });

  it('summary and stored state re-render when the pointer returns to the centre', () => {
    hungerSummary = 'below 40';
    stored.set('pets.hunger', { enabled: true, soundId: 'chime' });
    container.dispatchEvent(new Event('pointerenter'));
    const hunger = card('pets.hunger');
    expect(hunger.querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('below 40');
    expect(toggleOf('pets.hunger').getAttribute('aria-checked')).toBe('true');
    expect(masterText()).toBe('feature.alertCentre.master.count {"on":2,"total":3}');
  });

  it('a row registered after open appears on the next refresh', () => {
    rows.set('garden.nightfall', { id: 'garden.nightfall', group: 'garden', labelKey: 'night', defaultSound: 'chime' });
    window.dispatchEvent(new Event('qpm:sprite-hydration-state-change'));
    expect(container.querySelector('[data-qpm-alert-centre-row="garden.nightfall"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-qpm-alert-centre-row]').length).toBe(5);
  });

  it('master card shows the bell and ON/OFF state', () => {
    const master = container.querySelector<HTMLElement>('[data-qpm-alert-centre-master]')!;
    expect(master.querySelector('.qpm-alert-centre-master__state')?.textContent).toBe('feature.alertCentre.master.on');
    expect(master.querySelector('img')?.getAttribute('src')).toBe('data:sprite/ui/NotifierBellOn');
    master.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    expect(soundsOn).toBe(false);
    expect(master.querySelector('.qpm-alert-centre-master__state')?.textContent).toBe('feature.alertCentre.master.off');
    expect(master.classList.contains('qpm-alert-centre-card--on')).toBe(false);
  });

  it('hub rows carry a Card size slider: drag previews, release stores (ALR-17.11a)', () => {
    sizes.set('pets.trough', 1.2);
    container.dispatchEvent(new Event('pointerenter'));
    const range = (id: string): HTMLInputElement => card(id).querySelector<HTMLInputElement>(`[data-qpm-alert-centre-size="${id}"] input[type="range"]`)!;
    expect(range('pets.hunger').value).toBe('1');
    expect(range('pets.trough').value).toBe('1.2');
    expect([range('pets.hunger').min, range('pets.hunger').max, range('pets.hunger').step]).toEqual(['0.7', '1.3', '0.1']);
    expect(card('pets.hunger').textContent).toContain('feature.alertCentre.cardSize');
    expect(card('linked.bagFull').querySelector('[data-qpm-alert-centre-size]')).toBeNull();
    const r = range('pets.hunger');
    r.value = '0.8';
    r.dispatchEvent(new Event('input'));
    expect(previewed).toEqual([['pets.hunger', 0.8]]);
    expect(sizes.has('pets.hunger')).toBe(false);
    r.dispatchEvent(new Event('change'));
    expect(sizes.get('pets.hunger')).toBe(0.8);
  });

  it('a linked row with size hooks carries the same slider; refresh re-reads it (ALR-17.11b)', () => {
    const range = (): HTMLInputElement => card('linked.restock').querySelector<HTMLInputElement>('[data-qpm-alert-centre-size="linked.restock"] input[type="range"]')!;
    expect(range().value).toBe('1');
    expect(card('linked.restock').textContent).toContain('feature.alertCentre.cardSize');
    range().value = '1.2';
    range().dispatchEvent(new Event('input'));
    expect(previewed).toEqual([['linked.restock', 1.2]]);
    expect(sizes.has('linked.restock')).toBe(false);
    range().dispatchEvent(new Event('change'));
    expect(sizes.get('linked.restock')).toBe(1.2);
    sizes.set('linked.restock', 0.7);
    container.dispatchEvent(new Event('pointerenter'));
    expect(range().value).toBe('0.7');
  });

  it('desktop card: off by default, never asks on render; ticks on hub rows and the pins row only (ALR-13.3)', () => {
    expect(requests).toBe(0);
    expect(desktopCard().dataset.qpmAlertCentreDesktopView).toBe('off');
    expect(desktopCard().querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('feature.alertCentre.desktop.summaryOff');
    expect(tickOf('pets.hunger')).not.toBeNull();
    expect(tickOf('linked.restock')).toBeNull();
    expect(tickOf('linked.bagFull')).toBeNull();
    expect(tickOf('pets.hunger')!.disabled).toBe(true);
    expect(card('pets.hunger').querySelector<HTMLElement>('[data-qpm-alert-centre-desktop-tick]')!.title).toBe('feature.alertCentre.desktop.rowTickOff');
  });

  it('switching on asks once, then frees the ticks and counts them', async () => {
    linked[0] = { ...linked[0]!, desktop: true };
    cleanup();
    container.replaceChildren();
    cleanup = renderAlertsTab(container);
    desktopCard().querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toBe(1);
    expect(desktop.on).toBe(true);
    expect(desktopCard().dataset.qpmAlertCentreDesktopView).toBe('on');
    expect(tickOf('pets.hunger')!.disabled).toBe(false);
    tickOf('pets.hunger')!.click();
    tickOf('linked.restock')!.click();
    expect([...desktopRows]).toEqual(['pets.hunger', 'linked.restock']);
    expect(desktopCard().querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('feature.alertCentre.desktop.summaryOn {"count":2}');
    desktopCard().querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    expect(desktop.on).toBe(false);
    expect(tickOf('pets.hunger')!.disabled).toBe(true);
    expect(tickOf('pets.hunger')!.getAttribute('aria-checked')).toBe('true');
  });

  it('a denied prompt leaves it off with the blocked state and a disabled switch', async () => {
    promptAnswer = 'denied';
    desktopCard().querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(desktop.on).toBe(false);
    expect(desktopCard().dataset.qpmAlertCentreDesktopView).toBe('blocked');
    expect(desktopCard().querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('feature.alertCentre.desktop.blocked');
    expect(desktopCard().querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
  });

  it('stored on without permission reads off; Discord after its attempt and no API read not available', () => {
    desktop.on = true;
    container.dispatchEvent(new Event('pointerenter'));
    expect(desktopCard().dataset.qpmAlertCentreDesktopView).toBe('off');
    desktop.permission = 'granted';
    container.dispatchEvent(new Event('pointerenter'));
    expect(desktopCard().dataset.qpmAlertCentreDesktopView).toBe('on');
    Object.assign(desktop, { availability: 'blocked', discord: true });
    container.dispatchEvent(new Event('pointerenter'));
    expect(desktopCard().dataset.qpmAlertCentreDesktopView).toBe('unavailable');
    Object.assign(desktop, { availability: 'unsupported', discord: false, permission: null });
    container.dispatchEvent(new Event('pointerenter'));
    expect(desktopCard().querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('feature.alertCentre.desktop.unavailable');
  });

  it('cleanup removes the listeners', () => {
    cleanup();
    cleanup = () => {};
    hungerSummary = 'changed';
    container.dispatchEvent(new Event('pointerenter'));
    expect(card('pets.hunger').querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('below 25');
  });
});
