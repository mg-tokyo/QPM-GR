// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationEvent } from '../../core/notifications';
import type { AlertRowDef } from '../../features/alertHub';

vi.mock('../../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
}));

let buffer: NotificationEvent[] = [];
const subs = new Set<(events: NotificationEvent[]) => void>();
const emit = (): void => { for (const s of subs) s(buffer.slice()); };
vi.mock('../../core/notifications', () => ({
  onNotifications: (cb: (events: NotificationEvent[]) => void) => {
    subs.add(cb);
    cb(buffer.slice());
    return () => { subs.delete(cb); };
  },
  clearNotifications: () => { buffer = []; emit(); },
}));

const rows = new Map<string, AlertRowDef>();
vi.mock('../../features/alertHub', () => ({
  getAlertRow: (id: string) => rows.get(id) ?? null,
  getBridgedRowId: (feature: string) => (feature === 'Locker' ? 'qpm.lockerBlock' : null),
  listAlertRows: () => [...rows.values()],
  resolveRowLabel: (d: AlertRowDef) => d.labelKey,
  resolveRowIcon: (d: AlertRowDef | null) => d?.icon?.() ?? null,
  resolveRowAccent: (d: AlertRowDef | null) => (typeof d?.accent === 'function' ? d.accent() : d?.accent ?? null),
  resolveRowSummary: () => null,
}));
vi.mock('../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getAnySpriteDataUrl: () => '',
  onSpritesReady: () => () => { /* already ready in tests */ },
}));
vi.mock('../shop/restockAlerts/soundConfig', () => ({ BUILTIN_SOUNDS: [], getCustomSounds: () => ({}) }));
vi.mock('../shop/restockAlerts/soundEngine', () => ({ previewSound: vi.fn() }));

import { renderHistoryTab } from './historyTab';

let container: HTMLElement;
let cleanup: () => void;
let n = 0;

function push(e: Partial<NotificationEvent> & Pick<NotificationEvent, 'feature'>): void {
  n += 1;
  buffer.push({ id: `e${n}`, level: 'info', message: '', timestamp: Date.UTC(2026, 10, 16, 12, 0, n), ...e });
  emit();
}

const entries = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[data-qpm-alert-history-entry]')];
const pills = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('[data-qpm-alert-history-filters] button')];
const pill = (label: string): HTMLButtonElement => {
  const found = pills().find((b) => b.textContent === label);
  if (!found) throw new Error(`no pill ${label}`);
  return found;
};
const titles = (): string[] => entries().map((e) => e.querySelector('.qpm-alert-centre-card__name')?.textContent ?? '');

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  buffer = [];
  subs.clear();
  rows.clear();
  rows.set('pets.hunger', { id: 'pets.hunger', group: 'pets', labelKey: 'Pet hunger', defaultSound: 'none', icon: () => 'data:row-pet', accent: 'var(--qpm-hunger-low)' });
  rows.set('garden.bell', { id: 'garden.bell', group: 'garden', labelKey: 'Mutation bell', defaultSound: 'none', accent: 'var(--qpm-positive)' });
  rows.set('qpm.lockerBlock', { id: 'qpm.lockerBlock', group: 'qpm', labelKey: 'Locker', defaultSound: 'none' });
  container = document.createElement('div');
  document.body.append(container);
  cleanup = renderHistoryTab(container);
});

afterEach(() => { cleanup(); });

describe('renderHistoryTab', () => {
  it('shows the empty state with Clear disabled, then entries newest first', () => {
    expect(container.textContent).toContain('feature.alertCentre.history.empty');
    const clear = [...container.querySelectorAll('button')].find((b) => b.textContent === 'feature.alertCentre.history.clear')!;
    expect(clear.disabled).toBe(true);
    push({ feature: 'pets.hunger', title: 'Chicken is hungry', body: 'Hunger 77%', message: 'Chicken is hungry — Hunger 77%' });
    push({ feature: 'garden.bell', title: 'Frozen', message: 'Frozen' });
    expect(titles()).toEqual(['Frozen', 'Chicken is hungry']);
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(entries()).toHaveLength(0);
    expect(container.textContent).toContain('feature.alertCentre.history.empty');
  });

  it('uses the event sprite, then the row icon, then a letter', () => {
    push({ feature: 'pets.hunger', title: 'A', iconUrl: 'data:exact-pet' });
    push({ feature: 'pets.hunger', title: 'B' });
    push({ feature: 'battleship', message: 'Your turn' });
    const [plain, rowIcon, exact] = entries();
    expect(exact!.querySelector('img')!.getAttribute('src')).toBe('data:exact-pet');
    expect(rowIcon!.querySelector('img')!.getAttribute('src')).toBe('data:row-pet');
    expect(plain!.querySelector('img')).toBeNull();
    expect(plain!.querySelector('.qpm-alert-card__icon-fallback')!.textContent).toBe('B');
  });

  it('names plain notify events after their row (or feature) and shows the message as body', () => {
    push({ feature: 'Locker', level: 'warn', message: 'Blocked selling a locked crop' });
    const [card] = entries();
    expect(card!.querySelector('.qpm-alert-centre-card__name')!.textContent).toBe('Locker');
    expect(card!.querySelector('.qpm-alert-centre-history__body')!.textContent).toBe('Blocked selling a locked crop');
    expect(card!.dataset.qpmAlertHistoryEntry).toBe('qpm');
  });

  it('colours the level dot: info follows the row accent, others the level token', () => {
    push({ feature: 'pets.hunger', title: 'info' });
    push({ feature: 'pets.hunger', title: 'warn', level: 'warn' });
    push({ feature: 'pets.hunger', title: 'error', level: 'error' });
    push({ feature: 'pets.hunger', title: 'ok', level: 'success' });
    const dot = (c: HTMLElement): string => c.querySelector<HTMLElement>('.qpm-alert-centre-history__dot')!.style.getPropertyValue('--qpm-level-color');
    const [success, error, warn, info] = entries();
    expect(info!.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-hunger-low)');
    expect(dot(info!)).toBe('var(--qpm-alert-color)');
    expect(dot(warn!)).toBe('var(--qpm-warning)');
    expect(dot(error!)).toBe('var(--qpm-danger)');
    expect(dot(success!)).toBe('var(--qpm-positive)');
  });

  it('filters by group; events without a row file under QPM; empty group has its own text', () => {
    push({ feature: 'pets.hunger', title: 'pet' });
    push({ feature: 'garden.bell', title: 'garden' });
    push({ feature: 'gardenPainter', message: 'Saved' });
    expect(pills().map((b) => b.textContent)).toEqual([
      'feature.alertCentre.history.all',
      'feature.alertCentre.group.pets',
      'feature.alertCentre.group.garden',
      'feature.alertCentre.group.shops',
      'feature.alertCentre.group.qpm',
    ]);
    pill('feature.alertCentre.group.pets').click();
    expect(titles()).toEqual(['pet']);
    pill('feature.alertCentre.group.qpm').click();
    expect(titles()).toEqual(['gardenPainter']);
    pill('feature.alertCentre.group.shops').click();
    expect(entries()).toHaveLength(0);
    expect(container.textContent).toContain('feature.alertCentre.history.emptyGroup {"group":"feature.alertCentre.group.shops"}');
    push({ feature: 'pets.hunger', title: 'second pet' });
    expect(entries()).toHaveLength(0);
    pill('feature.alertCentre.history.all').click();
    expect(entries()).toHaveLength(4);
  });

  it('adds a Room pill only once a room alert is registered', () => {
    expect(pills().some((b) => b.textContent === 'feature.alertCentre.group.room')).toBe(false);
    rows.set('room.full', { id: 'room.full', group: 'room', labelKey: 'Room full', defaultSound: 'none' });
    push({ feature: 'room.full', title: 'Room is full' });
    pill('feature.alertCentre.group.room').click();
    expect(titles()).toEqual(['Room is full']);
  });

  it('stops listening after cleanup', () => {
    cleanup();
    push({ feature: 'pets.hunger', title: 'late' });
    expect(entries()).toHaveLength(0);
    cleanup = () => {};
  });
});
