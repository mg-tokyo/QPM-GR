import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));

interface Evt { id: string; feature: string; level: string; message: string; timestamp: number }
const buffer: Evt[] = [];
const subs = new Set<(e: Evt[]) => void>();
let n = 0;
function notify(e: Omit<Evt, 'id' | 'timestamp'>): Evt {
  const ev = { ...e, id: `e${++n}`, timestamp: n };
  buffer.push(ev);
  for (const s of subs) s(buffer.slice());
  return ev;
}
vi.mock('../../core/notifications', () => ({
  notify: (e: Omit<Evt, 'id' | 'timestamp'>) => notify(e),
  onNotifications: (cb: (e: Evt[]) => void) => { subs.add(cb); cb(buffer.slice()); return () => { subs.delete(cb); }; },
}));
let harvestCb: ((text: string) => void) | null = null;
vi.mock('../garden/harvestReminder', () => ({
  onHarvestToast: (cb: (text: string) => void) => { harvestCb = cb; return () => { harvestCb = null; }; },
}));
const played: string[] = [];
vi.mock('../../ui/shop/restockAlerts/soundEngine', () => ({
  isBuiltinSound: () => true,
  playSound: (id: string) => { played.push(id); return Promise.resolve(); },
  playCustomSound: () => Promise.resolve(),
}));
vi.mock('../../ui/shop/restockAlerts/soundConfig', () => ({ getCustomSounds: () => ({}) }));
let spritesReady = true;
vi.mock('../../sprite-v2/compat', () => ({
  isSpritesReady: () => spritesReady,
  getAnySpriteDataUrl: (key: string) => `data:${key}`,
}));

import { getAlertBridgeStats, HARVEST_ROW, LOCKER_ROW, startAlertBridge, stopAlertBridge, VERSION_ROW } from './bridge';
import { getAlertRow, resolveRowAccent, resolveRowIcon, resolveRowSummary } from './registry';
import { closeAllAlertCards, setAlertPresenter, type AlertPresenter } from './raise';
import { writeAlertRowSettings } from './settings';

interface Shown { rowId: string; title: string; body: string | undefined }
const shown: Shown[] = [];
const updates: string[] = [];
const presenter: AlertPresenter = (card) => {
  shown.push({ rowId: card.rowId, title: card.title, body: card.body });
  return { update: (p) => { updates.push(p.body ?? ''); }, close: () => { card.onClose(); } };
};

describe('silent-path bridge', () => {
  beforeEach(() => {
    stopAlertBridge();
    closeAllAlertCards();
    mem.clear();
    buffer.length = 0;
    shown.length = 0;
    updates.length = 0;
    played.length = 0;
    setAlertPresenter(presenter);
  });

  it('version and Locker are on by default: one card each, no second History entry', () => {
    startAlertBridge();
    notify({ feature: 'versionChecker', level: 'info', message: 'QPM update available: v1 → v2' });
    notify({ feature: 'Locker', level: 'warn', message: 'Blocked selling a favourite' });
    expect(shown).toEqual([
      { rowId: VERSION_ROW, title: 'feature.alertHub.version.title', body: 'QPM update available: v1 → v2' },
      { rowId: LOCKER_ROW, title: 'feature.alertHub.locker.title', body: 'Blocked selling a favourite' },
    ]);
    expect(buffer).toHaveLength(2);
    expect(played).toEqual(['bell', 'ping']);
  });

  it('a second Locker block updates the open card in place', () => {
    startAlertBridge();
    notify({ feature: 'Locker', level: 'warn', message: 'first' });
    notify({ feature: 'Locker', level: 'warn', message: 'second' });
    expect(shown).toHaveLength(1);
    expect(updates).toEqual(['second']);
  });

  it('other features and logger events stay History-only', () => {
    startAlertBridge();
    notify({ feature: 'qpm.logger', level: 'error', message: 'x' });
    notify({ feature: 'pets.hunger', level: 'warn', message: 'y' });
    expect(shown).toEqual([]);
  });

  it('a row switched off keeps the History entry and shows no card', () => {
    writeAlertRowSettings(LOCKER_ROW, { enabled: false, soundId: 'ping' });
    startAlertBridge();
    notify({ feature: 'Locker', level: 'warn', message: 'blocked' });
    expect([shown.length, buffer.length]).toEqual([0, 1]);
  });

  it('events buffered before start show once; a restart never re-raises them', () => {
    notify({ feature: 'versionChecker', level: 'info', message: 'early' });
    startAlertBridge();
    expect(shown).toHaveLength(1);
    stopAlertBridge();
    closeAllAlertCards();
    startAlertBridge();
    notify({ feature: 'qpm.other', level: 'info', message: 'z' });
    expect(shown).toHaveLength(1);
  });

  it('harvest is off by default; on, it raises a card with one History entry', () => {
    startAlertBridge();
    harvestCb?.('Carrot is ready');
    expect([shown.length, buffer.length]).toEqual([0, 0]);
    writeAlertRowSettings(HARVEST_ROW, { enabled: true, soundId: 'chime' });
    harvestCb?.('Carrot is ready');
    expect(shown).toEqual([{ rowId: HARVEST_ROW, title: 'feature.alertHub.harvest.title', body: 'Carrot is ready' }]);
    expect(buffer.map((e) => e.feature)).toEqual([HARVEST_ROW]);
    expect(getAlertBridgeStats()).toMatchObject({ started: true, harvestCards: 1 });
  });

  it('bridged rows declare a game UI sprite, a summary and a token colour', () => {
    startAlertBridge();
    const look = (id: string): unknown[] => { const d = getAlertRow(id); return [resolveRowIcon(d), resolveRowSummary(d), resolveRowAccent(d)]; };
    expect(look(VERSION_ROW)).toEqual(['data:sprite/ui/ToastStatusInfoIcon', 'feature.alertHub.version.summary', 'var(--qpm-info)']);
    expect(look(LOCKER_ROW)).toEqual(['data:sprite/ui/Locked', 'feature.alertHub.locker.summary', 'var(--qpm-warning)']);
    expect(look(HARVEST_ROW)).toEqual(['data:sprite/ui/PatchHarvest', 'feature.alertHub.harvest.summary', 'var(--qpm-positive)']);
    spritesReady = false;
    expect(resolveRowIcon(getAlertRow(LOCKER_ROW))).toBeNull();
    spritesReady = true;
  });

  it('stop detaches both listeners', () => {
    startAlertBridge();
    stopAlertBridge();
    expect([subs.size, harvestCb]).toEqual([0, null]);
  });
});
