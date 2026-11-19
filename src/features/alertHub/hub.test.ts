import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));

const notified: Array<{ feature: string; message: string; title?: string; body?: string; iconUrl?: string }> = [];
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
vi.mock('../../sprite-v2/compat', () => ({ isSpritesReady: () => false, getAnySpriteDataUrl: () => '' }));
const resized: Array<[string, number]> = [];
vi.mock('../../ui/shop/restockAlerts/hubCard', () => ({
  resizeHubCards: (id: string, scale: number) => { resized.push([id, scale]); },
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
  closeAllAlertCards,
  getAlertHubState,
  getAlertRow,
  getRowCardSize,
  previewAlertRowCardSize,
  raiseAlert,
  resolveRowLabel,
  registerAlertRow,
  setAlertPresenter,
  setAlertRowCardSize,
  setAlertRowEnabled,
  setRowDesktop,
  setAlertRowSound,
  setAlertSoundsOn,
  type AlertCardPatch,
  type AlertPayload,
  type AlertPresenter,
} from './index';

const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function presenterSpy(): { p: AlertPresenter; shown: string[]; updates: string[]; cards: AlertPayload[]; patches: AlertCardPatch[] } {
  const shown: string[] = [];
  const updates: string[] = [];
  const cards: AlertPayload[] = [];
  const patches: AlertCardPatch[] = [];
  const p: AlertPresenter = (card) => {
    shown.push(card.title);
    cards.push(card);
    return { update: (patch) => { patches.push(patch); updates.push(patch.body ?? ''); }, close: () => { card.onClose(); } };
  };
  return { p, shown, updates, cards, patches };
}

const sprite = (n: number): { url: string; count: number } => ({ url: `data:image/png;base64,S${n}`, count: n });
const chip = (n: number): { text: string; color: string } => ({ text: `c${n}`, color: 'var(--qpm-accent)' });

describe('alert hub', () => {
  beforeEach(() => {
    mem.clear();
    notified.length = 0;
    audioPlays.length = 0;
    loopStops.length = 0;
    resized.length = 0;
    setAlertPresenter(null);
    registerAlertRow({ id: 't.row', group: 'qpm', labelKey: 'x', defaultSound: 'my1' });
  });

  it('a row never saved is off: nothing reaches History, sound or presenter', async () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    expect(raiseAlert('t.row', { title: 'Hi' })).toBeNull();
    await flush();
    expect([notified.length, audioPlays.length, s.shown.length]).toEqual([0, 0, 0]);
    expect(getAlertHubState().rows).toEqual([{ id: 't.row', group: 'qpm', enabled: false, soundId: 'my1', cardSize: 1, icon: false, summary: null, accent: null }]);
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

  it('onClose runs once when the raised card closes, by its own close or closeAll', () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    setAlertRowEnabled('t.row', true);
    setAlertRowSound('t.row', 'none');
    const first = vi.fn();
    const a = raiseAlert('t.row', { title: 'A', cardKey: 'oc1' }, { onClose: first });
    raiseAlert('t.row', { title: 'A', cardKey: 'oc1' }, { onClose: vi.fn() });
    a!.close();
    a!.close();
    expect(first).toHaveBeenCalledTimes(1);
    const second = vi.fn();
    raiseAlert('t.row', { title: 'B', cardKey: 'oc2' }, { onClose: second });
    closeAllAlertCards();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('registry is idempotent and unknown rows raise nothing', () => {
    registerAlertRow({ id: 't.row', group: 'pets', labelKey: 'y', defaultSound: 'ping' });
    expect(getAlertHubState().rows).toEqual([{ id: 't.row', group: 'pets', enabled: false, soundId: 'ping', cardSize: 1, icon: false, summary: null, accent: null }]);
    expect(raiseAlert('nope', { title: 'x' })).toBeNull();
    expect(getAlertHubState().raise.unknownRow).toBeGreaterThan(0);
  });

  it('settings default to sounds on', () => {
    expect(getAlertHubState().soundsOn).toBe(true);
  });

  it('rich fields reach the presenter; sprites cap at 4 and chips at 3', () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    setAlertRowEnabled('t.row', true);
    setAlertRowSound('t.row', 'none');
    const figure = { countdownTo: 1_700_000_000_000, label: 'MAX STR IN' };
    raiseAlert('t.row', {
      title: 'Rich',
      accent: 'var(--qpm-dawn)',
      level: 'warn',
      sprites: [1, 2, 3, 4, 5].map(sprite),
      chips: [1, 2, 3, 4].map(chip),
      figure,
    });
    const card = s.cards[0]!;
    expect(card.accent).toBe('var(--qpm-dawn)');
    expect(card.level).toBe('warn');
    expect(card.sprites).toEqual([1, 2, 3, 4].map(sprite));
    expect(card.chips).toEqual([1, 2, 3].map(chip));
    expect(card.figure).toEqual(figure);
  });

  it('update in place carries chips and figure; absent fields are left out of the patch', () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    setAlertRowEnabled('t.row', true);
    setAlertRowSound('t.row', 'none');
    raiseAlert('t.row', { title: 'A', body: '1', cardKey: 'k-rich', chips: [chip(1)], figure: { value: '1', label: 'EGGS' } });
    raiseAlert('t.row', { title: 'A', body: '2', cardKey: 'k-rich', chips: [1, 2, 3, 4].map(chip), figure: { value: '3', label: 'EGGS' } });
    raiseAlert('t.row', { title: 'A', cardKey: 'k-rich' });
    expect(s.shown).toEqual(['A']);
    expect(s.patches).toEqual([
      { body: '2', chips: [1, 2, 3].map(chip), figure: { value: '3', label: 'EGGS' } },
      { body: '' },
    ]);
  });

  it('History event carries title, body and iconUrl beside the joined message', () => {
    setAlertRowEnabled('t.row', true);
    setAlertRowSound('t.row', 'none');
    raiseAlert('t.row', { title: 'Frozen', body: '12 crops', iconUrl: 'data:image/png;base64,I' });
    raiseAlert('t.row', { title: 'Plain' });
    expect(notified).toEqual([
      expect.objectContaining({ message: 'Frozen — 12 crops', title: 'Frozen', body: '12 crops', iconUrl: 'data:image/png;base64,I' }),
      expect.objectContaining({ message: 'Plain', title: 'Plain' }),
    ]);
    expect(notified[1]).not.toHaveProperty('body');
    expect(notified[1]).not.toHaveProperty('iconUrl');
  });

  it('registry keeps icon, summary and accent and stays idempotent', () => {
    const icon = (): string | null => 'data:image/png;base64,R';
    const summary = (): string => 'Below 25%';
    registerAlertRow({ id: 't.rich', group: 'pets', labelKey: 'x', defaultSound: 'none', icon, summary, accent: 'var(--qpm-amber)' });
    registerAlertRow({ id: 't.rich', group: 'pets', labelKey: 'x', defaultSound: 'none', icon, summary, accent: 'var(--qpm-dawn)' });
    const row = getAlertRow('t.rich');
    expect([row?.icon?.(), row?.summary?.(), row?.accent]).toEqual(['data:image/png;base64,R', 'Below 25%', 'var(--qpm-dawn)']);
    expect(getAlertHubState().rows.filter((r) => r.id === 't.rich')).toHaveLength(1);
  });

  it('state resolves icon, summary and an accent resolver; a throwing resolver reads as null', () => {
    let bell: string | null = 'var(--qpm-amber)';
    registerAlertRow({ id: 't.live', group: 'garden', labelKey: 'x', defaultSound: 'none', icon: () => 'data:i', summary: () => 'Belled: Wet', accent: () => bell });
    registerAlertRow({ id: 't.bad', group: 'garden', labelKey: 'x', defaultSound: 'none', icon: () => { throw new Error('x'); }, summary: () => { throw new Error('x'); }, accent: () => { throw new Error('x'); } });
    const pick = (id: string): unknown => getAlertHubState().rows.find((r) => r.id === id);
    expect(pick('t.live')).toMatchObject({ icon: true, summary: 'Belled: Wet', accent: 'var(--qpm-amber)' });
    bell = null;
    expect(pick('t.live')).toMatchObject({ accent: null });
    expect(pick('t.bad')).toMatchObject({ icon: false, summary: null, accent: null });
  });

  it('repeat loops the row sound on the card key until the card closes', () => {
    const s = presenterSpy();
    setAlertPresenter(s.p);
    setAlertRowEnabled('t.row', true);
    setAlertRowSound('t.row', 'ping');
    const card = raiseAlert('t.row', { title: 'R', cardKey: 'rep' }, { repeat: { intervalMs: 5000 } });
    expect(engine.isLooping('alert:rep')).toBe(true);
    expect(getAlertHubState().raise.loops).toBe(1);
    raiseAlert('t.row', { title: 'R', cardKey: 'rep' }, { repeat: {} });
    expect(getAlertHubState().raise.loops).toBe(1);
    card!.close();
    expect(engine.isLooping('alert:rep')).toBe(false);
    expect(loopStops).toContain('restock-sound-loop-alert:rep');
    expect(getAlertHubState().raise.loops).toBe(0);
  });

  it('repeat: no loop with sounds off, sound none, no cardKey or no card; closeAll stops loops', () => {
    setAlertRowEnabled('t.row', true);
    setAlertRowSound('t.row', 'ping');
    raiseAlert('t.row', { title: 'R', cardKey: 'nocard' }, { repeat: {} });
    expect(engine.isLooping('alert:nocard')).toBe(false);
    const s = presenterSpy();
    setAlertPresenter(s.p);
    raiseAlert('t.row', { title: 'R' }, { repeat: {} });
    setAlertSoundsOn(false);
    raiseAlert('t.row', { title: 'R', cardKey: 'off' }, { repeat: {} });
    expect(engine.isLooping('alert:off')).toBe(false);
    setAlertSoundsOn(true);
    setAlertRowSound('t.row', 'none');
    raiseAlert('t.row', { title: 'R', cardKey: 'silent' }, { repeat: {} });
    expect(engine.isLooping('alert:silent')).toBe(false);
    setAlertRowSound('t.row', 'my1');
    raiseAlert('t.row', { title: 'R', cardKey: 'custom' }, { repeat: {} });
    expect(engine.isLooping('alert:custom')).toBe(true);
    closeAllAlertCards();
    expect(engine.isLooping('alert:custom')).toBe(false);
    expect(getAlertHubState().raise.loops).toBe(0);
  });

  it('label params fill the row label', () => {
    registerAlertRow({ id: 't.row', group: 'pets', labelKey: 'feature.chargedReady.row', labelParams: { ability: 'Dawn Capture' }, defaultSound: 'none' });
    expect(resolveRowLabel(getAlertRow('t.row')!)).toBe('Charged: Dawn Capture');
  });

  it('card size: 1 by default, clamped to 0.7–1.3 in 0.1 steps, kept through other row writes (ALR-17.11a)', () => {
    expect(getRowCardSize('t.row')).toBe(1);
    expect(setAlertRowCardSize('t.row', 0.84)).toBe(0.8);
    expect(resized).toEqual([['t.row', 0.8]]);
    setAlertRowEnabled('t.row', true);
    setAlertRowSound('t.row', 'chime');
    setRowDesktop('t.row', true);
    expect(getRowCardSize('t.row')).toBe(0.8);
    expect(getAlertHubState().rows.find((r) => r.id === 't.row')).toMatchObject({ enabled: true, soundId: 'chime', cardSize: 0.8 });
    expect(setAlertRowCardSize('t.row', 9)).toBe(1.3);
    expect(setAlertRowCardSize('t.row', 0.1)).toBe(0.7);
    expect(setAlertRowCardSize('t.row', Number.NaN)).toBe(1);
    const row = (mem.get('qpm.alertHub.v1') as { rows: Record<string, Record<string, unknown>> }).rows['t.row'];
    expect(row).not.toHaveProperty('size');
    expect(row).toMatchObject({ enabled: true, soundId: 'chime', desktop: true });
  });

  it('card size on a row never saved keeps its defaults; preview resizes without storing', () => {
    setAlertRowCardSize('t.row', 1.2);
    expect((mem.get('qpm.alertHub.v1') as { rows: Record<string, unknown> }).rows['t.row']).toEqual({ enabled: false, soundId: 'my1', size: 1.2 });
    previewAlertRowCardSize('t.row', 0.73);
    expect(resized.at(-1)).toEqual(['t.row', 0.7]);
    expect(getRowCardSize('t.row')).toBe(1.2);
  });
});
