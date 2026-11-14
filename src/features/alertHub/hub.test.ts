import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));

const notified: Array<{ feature: string; message: string }> = [];
vi.mock('../../core/notifications', () => ({
  notify: (e: { feature: string; message: string }) => { notified.push(e); return e; },
}));
vi.mock('../../ui/shop/restockAlerts/soundConfig', () => ({
  getCustomSounds: () => ({ my1: { name: 'Mine', dataUrl: 'data:audio/x' } }),
  BUILTIN_SOUND_IDS: new Set(['ping', 'chime', 'bell', 'alert', 'gentle']),
}));

const audioPlays: string[] = [];
class FakeAudio {
  src = ''; volume = 1; crossOrigin = '';
  play(): Promise<void> { audioPlays.push(this.src); return Promise.resolve(); }
}
vi.stubGlobal('Audio', FakeAudio);
vi.mock('../../core/pageContext', () => ({ pageWindow: {} }));
vi.mock('../garden/harvestReminder', () => ({ onHarvestToast: () => () => { /* bridge tests in bridge.test.ts */ } }));
vi.mock('../../ui/shop/restockAlerts/hubCard', () => ({
  presentHubCard: () => null,
  closeAllHubCards: () => { /* jsdom card tests live in hubCard.test.ts */ },
  getHubCardCount: () => 0,
}));
const loopStops: string[] = [];
vi.mock('../../utils/scheduling/timerManager', () => ({
  criticalInterval: (id: string) => () => { loopStops.push(id); },
}));

import * as engine from '../../ui/shop/restockAlerts/soundEngine';
import {
  getAlertHubState,
  raiseAlert,
  registerAlertRow,
  setAlertPresenter,
  setAlertRowEnabled,
  setAlertRowSound,
  setAlertSoundsOn,
  type AlertPresenter,
} from './index';

const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function presenterSpy(): { p: AlertPresenter; shown: string[]; updates: string[] } {
  const shown: string[] = [];
  const updates: string[] = [];
  const p: AlertPresenter = (card) => {
    shown.push(card.title);
    return { update: (b) => { updates.push(b); }, close: () => { card.onClose(); } };
  };
  return { p, shown, updates };
}

describe('alert hub', () => {
  beforeEach(() => {
    mem.clear();
    notified.length = 0;
    audioPlays.length = 0;
    loopStops.length = 0;
    setAlertPresenter(null);
    registerAlertRow({ id: 't.row', group: 'qpm', labelKey: 'x', defaultSound: 'my1' });
  });

  it('a row never saved is off: nothing reaches History, sound or presenter', async () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    expect(raiseAlert('t.row', { title: 'Hi' })).toBeNull();
    await flush();
    expect([notified.length, audioPlays.length, s.shown.length]).toEqual([0, 0, 0]);
    expect(getAlertHubState().rows).toEqual([{ id: 't.row', group: 'qpm', enabled: false, soundId: 'my1' }]);
  });

  it('a row on: History entry, its sound, presenter card', async () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    setAlertRowEnabled('t.row', true);
    expect(raiseAlert('t.row', { title: 'Hi', body: 'there' })).not.toBeNull();
    await flush();
    expect(notified).toEqual([expect.objectContaining({ feature: 't.row', message: 'Hi — there' })]);
    expect(audioPlays).toEqual(['data:audio/x']);
    expect(s.shown).toEqual(['Hi']);
  });

  it('sounds off: no play and no loop, card and History still happen; turning off stops loops', async () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    setAlertRowEnabled('t.row', true);
    engine.startLoop('k1', 'ping');
    setAlertSoundsOn(false);
    expect(loopStops).toEqual(['restock-sound-loop-k1']);
    expect(engine.isLooping('k1')).toBe(false);
    const before = engine.getSoundGateStats().dropped;
    raiseAlert('t.row', { title: 'Quiet' });
    engine.startLoop('k2', 'ping');
    await engine.playSound('ping');
    await flush();
    expect(audioPlays).toEqual([]);
    expect(engine.isLooping('k2')).toBe(false);
    expect(engine.getSoundGateStats()).toEqual({ open: false, dropped: before + 3 });
    expect([notified.length, s.shown.length]).toEqual([1, 1]);
  });

  it('preview plays while sounds are off', async () => {
    setAlertSoundsOn(false);
    engine.previewSound('my1', 0.5, true, 'data:audio/preview');
    await flush();
    expect(audioPlays).toEqual(['data:audio/preview']);
  });

  it('same cardKey updates the open card; a closed card is re-presented', async () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    setAlertRowEnabled('t.row', true);
    setAlertRowSound('t.row', 'none');
    const a = raiseAlert('t.row', { title: 'A', body: '1', cardKey: 'k' });
    const b = raiseAlert('t.row', { title: 'A', body: '2', cardKey: 'k' });
    expect(b).toBe(a);
    expect(s.shown).toEqual(['A']);
    expect(s.updates).toEqual(['2']);
    a!.close();
    raiseAlert('t.row', { title: 'A', body: '3', cardKey: 'k' });
    expect(s.shown).toEqual(['A', 'A']);
    await flush();
    expect(audioPlays).toEqual([]);
    expect(notified).toHaveLength(3);
  });

  it('registry is idempotent and unknown rows raise nothing', () => {
    registerAlertRow({ id: 't.row', group: 'pets', labelKey: 'y', defaultSound: 'ping' });
    expect(getAlertHubState().rows).toEqual([{ id: 't.row', group: 'pets', enabled: false, soundId: 'ping' }]);
    expect(raiseAlert('nope', { title: 'x' })).toBeNull();
    expect(getAlertHubState().raise.unknownRow).toBeGreaterThan(0);
  });

  it('settings default to sounds on', () => {
    expect(getAlertHubState().soundsOn).toBe(true);
  });
});
