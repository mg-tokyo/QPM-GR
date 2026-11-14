import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertModel } from './types';

const mem = new Map<string, unknown>();
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
}));

// The card DOM is out of scope: an upsert opens a card unless the test says creation fails.
const upsertCalls: string[] = [];
const fakeCards = new Map<string, unknown>();
let createFails = false;
vi.mock('./alertState', () => ({ activeAlerts: fakeCards }));
vi.mock('./alertDom', () => ({
  upsertAlert: (model: { key: string }) => {
    upsertCalls.push(model.key);
    if (!createFails) fakeCards.set(model.key, { model });
  },
}));

const sent: Array<{ title: string; body: string | undefined; tag: string | undefined }> = [];
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission(): Promise<NotificationPermission> { return Promise.resolve('granted'); }
  onshow: (() => void) | null = null;
  onclick: (() => void) | null = null;
  constructor(title: string, opts: NotificationOptions = {}) { sent.push({ title, body: opts.body, tag: opts.tag }); }
  close(): void { /* nothing to close in a test */ }
}
vi.stubGlobal('Notification', FakeNotification);
vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: () => undefined, removeEventListener: () => undefined });

const { upsertAlertWithDesktop, PIN_DESKTOP_ROW } = await import('./desktopRelay');
const { setDesktopOn, setRowDesktop } = await import('../../../features/alertHub/desktop');

const seed = (over: Partial<AlertModel> = {}): AlertModel => ({
  key: 'seed:Carrot', shopType: 'seed', itemId: 'Carrot', stockCycleId: 'restock:1', label: 'Carrot Seed', quantity: 5, priceCoins: 10, ...over,
});

describe('restock + weather pins reach the desktop path (ALR-13.2)', () => {
  beforeEach(() => {
    mem.clear();
    sent.length = 0;
    upsertCalls.length = 0;
    fakeCards.clear();
    createFails = false;
    setDesktopOn(true);
    setRowDesktop(PIN_DESKTOP_ROW, true);
  });

  it('a new pin card → one notification with the card lines, tagged by the alert key', () => {
    upsertAlertWithDesktop(seed());
    expect(sent).toEqual([{
      title: 'feature.restockAlert.pinnedRestocked',
      body: 'Carrot Seed\nfeature.restockAlert.available{"qty":5}',
      tag: 'seed:Carrot',
    }]);
  });

  it('a quantity update of an open card → none', () => {
    upsertAlertWithDesktop(seed());
    upsertAlertWithDesktop(seed({ quantity: 3 }));
    expect(upsertCalls).toEqual(['seed:Carrot', 'seed:Carrot']);
    expect(sent).toHaveLength(1);
  });

  it('the pins row unticked (or the master off) → none; an upsert that opens no card → none', () => {
    setRowDesktop(PIN_DESKTOP_ROW, false);
    upsertAlertWithDesktop(seed());
    fakeCards.clear();
    setRowDesktop(PIN_DESKTOP_ROW, true);
    setDesktopOn(false);
    upsertAlertWithDesktop(seed());
    fakeCards.clear();
    setDesktopOn(true);
    createFails = true;
    upsertAlertWithDesktop(seed());
    expect(upsertCalls).toHaveLength(3);
    expect(sent).toEqual([]);
  });

  it('a weather card uses the weather title and the event length, or "active now" without one', () => {
    upsertAlertWithDesktop(seed({ key: 'weather:Rain', shopType: 'weather', itemId: 'Rain', label: 'Rain', quantity: 1, isWeatherAlert: true, weatherDurationMs: 299_000 }));
    upsertAlertWithDesktop(seed({ key: 'weather:Frost', shopType: 'weather', itemId: 'Frost', label: 'Frost', quantity: 1, isWeatherAlert: true, weatherDurationMs: 0 }));
    expect(sent).toEqual([
      { title: 'feature.restockAlert.weatherActive', body: 'Rain\nfeature.restockAlert.minEvent{"min":5}', tag: 'weather:Rain' },
      { title: 'feature.restockAlert.weatherActive', body: 'Frost\nfeature.restockAlert.activeNow', tag: 'weather:Frost' },
    ]);
  });
});
