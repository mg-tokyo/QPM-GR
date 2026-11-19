import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../../core/notifications', () => ({ notify: (e: unknown) => e }));
vi.mock('../../ui/shop/restockAlerts/soundConfig', () => ({ getCustomSounds: () => ({}), BUILTIN_SOUND_IDS: new Set(['ping']) }));
vi.mock('../../ui/shop/restockAlerts/soundEngine', () => ({
  isBuiltinSound: () => false, playSound: vi.fn(), playCustomSound: vi.fn(), getSoundGateStats: () => ({}), stopAllLoops: vi.fn(),
}));
vi.mock('../../sprite-v2/compat', () => ({ isSpritesReady: () => false, getAnySpriteDataUrl: () => '' }));

const sent: Array<{ title: string; tag: string | undefined; silent: boolean | undefined }> = [];
const requests = { count: 0 };
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission(): Promise<NotificationPermission> { requests.count += 1; return Promise.resolve('granted'); }
  onshow: (() => void) | null = null;
  onclick: (() => void) | null = null;
  constructor(title: string, opts: NotificationOptions = {}) { sent.push({ title, tag: opts.tag, silent: opts.silent ?? undefined }); }
  close(): void { /* nothing to close in a test */ }
}
const doc = { visibilityState: 'hidden' as DocumentVisibilityState, addEventListener: () => undefined, removeEventListener: () => undefined };
const nav = { userActivation: { isActive: false } };
vi.stubGlobal('Notification', FakeNotification);
vi.stubGlobal('document', doc);
vi.stubGlobal('navigator', nav);

const { raiseAlert, registerAlertRow, setAlertRowEnabled, setAlertRowSound, getAlertHubState } = await import('./index');
const { getDesktopState, requestDesktopPermission, setDesktopOn, setRowDesktop } = await import('./desktop');

describe('desktop notifications (ALR-13.1)', () => {
  beforeEach(() => {
    mem.clear();
    sent.length = 0;
    requests.count = 0;
    FakeNotification.permission = 'granted';
    doc.visibilityState = 'hidden';
    nav.userActivation.isActive = false;
    registerAlertRow({ id: 'd.row', group: 'qpm', labelKey: 'x', defaultSound: 'none' });
    setAlertRowEnabled('d.row', true);
    setDesktopOn(true);
    setRowDesktop('d.row', true);
  });

  it('hidden + granted + ticked → one silent notification tagged by the card key', () => {
    raiseAlert('d.row', { title: 'Eggs', body: '3 ready', cardKey: 'egg:1' });
    expect(sent).toEqual([{ title: 'Eggs', tag: 'egg:1', silent: true }]);
    expect(getDesktopState().sent).toBe(1);
  });

  it('the row id is the tag without a card key; a repeat raise reuses it for the OS to replace', () => {
    raiseAlert('d.row', { title: 'A' });
    raiseAlert('d.row', { title: 'A' });
    expect(sent.map((s) => s.tag)).toEqual(['d.row', 'd.row']);
  });

  it('drops with a reason: visible tab, row unticked, master off, permission default/denied', () => {
    const before = getDesktopState().dropped;
    doc.visibilityState = 'visible';
    raiseAlert('d.row', { title: 'x' });
    doc.visibilityState = 'hidden';
    setRowDesktop('d.row', false);
    raiseAlert('d.row', { title: 'x' });
    setRowDesktop('d.row', true);
    setDesktopOn(false);
    raiseAlert('d.row', { title: 'x' });
    setDesktopOn(true);
    FakeNotification.permission = 'default';
    raiseAlert('d.row', { title: 'x' });
    FakeNotification.permission = 'denied';
    raiseAlert('d.row', { title: 'x' });
    const after = getDesktopState().dropped;
    expect(sent).toEqual([]);
    expect([after.visible - before.visible, after.rowOff - before.rowOff, after.masterOff - before.masterOff, after.permission - before.permission])
      .toEqual([1, 1, 1, 2]);
    expect(getDesktopState().availability).toBe('blocked');
  });

  it('a row switched off sends nothing to the desktop either', () => {
    setAlertRowEnabled('d.row', false);
    expect(raiseAlert('d.row', { title: 'x' })).toBeNull();
    expect(sent).toEqual([]);
  });

  it('never asks for permission without a user gesture', async () => {
    FakeNotification.permission = 'default';
    expect(await requestDesktopPermission()).toBe('noGesture');
    expect(requests.count).toBe(0);
    nav.userActivation.isActive = true;
    expect(await requestDesktopPermission()).toBe('granted');
    expect(requests.count).toBe(1);
  });

  it('the desktop tick survives sound and on/off edits and stays out of the public row shape', () => {
    setAlertRowSound('d.row', 'ping');
    setAlertRowEnabled('d.row', true);
    raiseAlert('d.row', { title: 'still ticked' });
    expect(sent).toHaveLength(1);
    expect(getAlertHubState().rows.find((r) => r.id === 'd.row')).toEqual({ id: 'd.row', group: 'qpm', enabled: true, soundId: 'ping', cardSize: 1, icon: false, summary: null, accent: null });
  });
});
