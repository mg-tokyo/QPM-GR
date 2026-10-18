// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessState } from './__test__/indexHarness';

const h: HarnessState = await vi.hoisted(async () => (await import('./__test__/indexHarness')).createHarnessState());
vi.mock('./ui/bar', async () => (await import('./__test__/indexHarness')).barMock(h));
vi.mock('./ui/infoCard', async () => (await import('./__test__/indexHarness')).infoCardMock(h));
vi.mock('./ui/cardCatalog', () => ({ cardCatalog: {} }));
vi.mock('./ui/waypointMenu', async () => (await import('./__test__/indexHarness')).waypointMenuMock());
vi.mock('./players', async (orig) => (await import('./__test__/indexHarness')).playersMock(h, await orig<typeof import('./players')>()));
vi.mock('../../core/notifications', async () => (await import('./__test__/indexHarness')).notificationsMock(h));
vi.mock('../../ui/components', () => ({ showToast: () => {} }));
vi.mock('../../i18n', async () => (await import('./__test__/indexHarness')).i18nMock());
vi.mock('../../utils/storage', async () => (await import('./__test__/indexHarness')).storageMock(h));
vi.mock('../../core/gameState', async () => (await import('./__test__/indexHarness')).gameStateMock(h));
vi.mock('../../core/pixiCapture', async () => (await import('./__test__/indexHarness')).pixiCaptureMock(h));
vi.mock('../../websocket/roomConnectionEvents', async () => (await import('./__test__/indexHarness')).roomEventsMock(h));
vi.mock('../camera3d', async () => (await import('./__test__/indexHarness')).camera3dMock(h));
vi.mock('../../diagnostics/copyPayload', async () => (await import('./__test__/indexHarness')).copyPayloadMock(h));
vi.mock('../../diagnostics/perfMonitor', () => ({ recordProbe: () => {} }));
vi.mock('../../diagnostics/featureDiagnostics', async () => (await import('./__test__/indexHarness')).featureDiagnosticsMock(h));
vi.mock('./probe', async () => (await import('./__test__/indexHarness')).probeMock(h));
vi.mock('./handles', async () => (await import('./__test__/indexHarness')).handlesMock(h));
vi.mock('./photo/live', async () => (await import('./__test__/indexHarness')).photoLiveMock(h));

import { flush, OTHER_OWNER as other, pointer as pointerAt, press, resetHarness } from './__test__/indexHarness';
import { setSpectatorSetting } from './settings';
import { cyclePlayer, detach, enterSpectator, exitSpectator, followPlayer, getSpectatorState, isSpectatorActive, startSpectator, stopSpectator } from './index';

let ticker: HarnessState['ticker'];
let zoomSys: HarnessState['zoomSys'];
const pointer = (type: string, x: number, y: number): void => { pointerAt(h, type, x, y); };
const following = (): unknown => ({ mode: getSpectatorState().mode, targetId: getSpectatorState().targetId });

function expectNothingLeft(): void {
  expect(isSpectatorActive()).toBe(false);
  expect(h.mem.get('cutsceneCameraTarget')).toBeNull();
  expect(h.mem.get('keyboardCaptureOwners')).toEqual([other]);
  expect(zoomSys.zoom.intentTileSize).toBe(60);
  expect(h.mem.get('zoomIntent')).toBeNull();
  expect(h.block).toBeNull();
  expect(ticker.priorities()).toEqual([]);
  expect(h.capture.size + h.room.size + h.engineSubs.size + h.playerSubs.size).toBe(0);
  expect(h.bars.every((b) => b.destroyed)).toBe(true);
  expect(h.cards.every((c) => c.destroyed)).toBe(true);
  expect(h.photo).toMatchObject({ cine: false, uiHidden: false });
  expect(h.photo.strips.every((s) => s.destroyed)).toBe(true);
  expect(h.photo.subs.size).toBe(0);
  const before = h.canvasSaw;
  pointer('pointerdown', 100, 100);
  pointer('pointerup', 100, 100);
  expect(h.canvasSaw).toBe(before + 1);
}

beforeEach(() => {
  stopSpectator();
  resetHarness(h);
  ticker = h.ticker;
  zoomSys = h.zoomSys;
});

describe('spectator lifecycle', () => {
  it('start and stop are idempotent and own the copy line', () => {
    startSpectator();
    startSpectator();
    expect(h.lineSource?.()).toBe('Spectator: off seat=seated fails=0');
    stopSpectator();
    stopSpectator();
    expect(h.lineSource).toBeNull();
  });

  it('enter refuses before start, then enters at the camera with every piece in place', () => {
    expect(enterSpectator()).toBe(false);
    startSpectator();
    expect(enterSpectator()).toBe(true);
    expect(getSpectatorState()).toMatchObject({ active: true, mode: 'free', view: '2d', pose: { x: 24, y: 23.75 } });
    expect(h.block).toBe('spectator');
    expect(ticker.priorities()).toEqual([1]);
    expect(h.mem.get('keyboardCaptureOwners')).toHaveLength(2);
    press('KeyW', 'w');
    expect(h.activity).toBe(1);
    expect(enterSpectator()).toBe(false);
    exitSpectator('test');
    exitSpectator('test');
    expectNothingLeft();
  });

  it('a failed check warns QPM-SPEC-001 once per missing set; transient misses never warn', () => {
    startSpectator();
    h.check = { ok: false, missing: ['target-busy'], facts: {} };
    expect(enterSpectator()).toBe(false);
    expect(h.warns).toEqual([]);
    h.check = { ok: false, missing: ['keyboardCaptureOwners'], facts: {} };
    enterSpectator();
    enterSpectator();
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]).toMatchObject({ code: 'QPM-SPEC-001', ctx: { missing: ['keyboardCaptureOwners'] } });
    expect(h.lineSource?.()).toBe('Spectator: off seat=seated fails=0 unavail=keyboardCaptureOwners');
    h.check = { ok: true, missing: [], facts: {} };
    h.handles = ['zoom'];
    expect(enterSpectator()).toBe(false);
    expect(h.warns[1]).toMatchObject({ code: 'QPM-SPEC-001', ctx: { missing: ['zoom'] } });
  });

  it('a piece that throws while entering unwinds the ones already in', () => {
    startSpectator();
    ticker.add = () => { throw new Error('ticker gone'); };
    expect(enterSpectator()).toBe(false);
    expect(h.warns[0]).toMatchObject({ code: 'QPM-SPEC-001', ctx: { missing: ['init:driver'] } });
    expectNothingLeft();
  });

  // Review focus 1: each way out leaves the cutscene target, the owners, the zoom, camera3d and every listener as found.
  const paths: Array<[string, () => void | Promise<void>]> = [
    ['G (flies home first)', async () => { press('KeyG', 'g'); ticker.tick(40); await flush(); }],
    ['Esc', async () => { press('Escape', 'Escape'); ticker.tick(40); await flush(); }],
    ['room socket replaced', () => { for (const cb of [...h.room]) cb({}, 'socket'); }],
    ['engine swapped', () => { for (const cb of [...h.engineSubs]) cb({ id: 'engine-2' }); }],
    ['PIXI re-captured', () => { for (const cb of [...h.capture]) cb(); }],
    ['seat lost', async () => { h.mem.set('localPresence', 'unseated'); ticker.tick(); await flush(); }],
    ['frame error', async () => { zoomSys.shouldBlockZoom = () => { throw new Error('boom'); }; ticker.tick(); await flush(); }],
    ['feature turned off', () => { setSpectatorSetting('enabled', false); }],
    ['stopSpectator', () => { stopSpectator(); }],
  ];
  // Task 9: the same ways out with photo mode open also put Cinematic Mode and QPM's UI back.
  for (const [name, leave, photo] of [false, true].flatMap((p) => paths.map(([n, l]) => [n, l, p] as const))) {
    it(`exit by ${name}${photo ? ' in photo mode' : ''} leaves nothing behind`, async () => {
      setSpectatorSetting('enabled', true);
      startSpectator();
      expect(enterSpectator()).toBe(true);
      press('KeyW', 'w');
      ticker.tick(5);
      press('KeyE', 'e');
      expect(followPlayer('b')).toBe(true);
      pointer('pointerdown', 100, 100);
      expect(zoomSys.zoom.intentTileSize).not.toBe(60);
      if (photo) {
        press('KeyP', 'p');
        expect(h.photo).toMatchObject({ cine: true, uiHidden: true });
        // The first Esc leaves photo mode only.
        if (name === 'Esc') press('Escape', 'Escape');
      }
      await leave();
      expectNothingLeft();
    });
  }

  it('G is ignored while a game window owns input; G then enters and G again flies home', async () => {
    startSpectator();
    zoomSys.blocked = true;
    press('KeyG', 'g');
    expect(isSpectatorActive()).toBe(false);
    zoomSys.blocked = false;
    press('KeyG', 'g');
    expect(isSpectatorActive()).toBe(true);
    press('KeyG', 'g');
    ticker.tick(3);
    expect(isSpectatorActive()).toBe(true);
    ticker.tick(40);
    await flush();
    expectNothingLeft();
  });

  it('three frame errors disable spectating until reload', async () => {
    // The count is per page session, so a fresh module stands in for a reload.
    vi.resetModules();
    const fresh = await import('./index');
    fresh.startSpectator();
    for (let i = 0; i < 3; i++) {
      expect(fresh.enterSpectator()).toBe(true);
      zoomSys.shouldBlockZoom = () => { throw new Error('boom'); };
      ticker.tick();
      await flush();
      zoomSys.shouldBlockZoom = () => zoomSys.blocked;
    }
    expect(fresh.enterSpectator()).toBe(false);
    expect(h.warns.filter((w) => w.code === 'QPM-SPEC-003')).toHaveLength(3);
    expect(h.infos.filter((w) => w.code === 'QPM-SPEC-004')).toHaveLength(1);
    expect(h.lineSource?.()).toContain('fails=3');
    fresh.stopSpectator();
  });
});

describe('following players', () => {
  it('] and [ step through the seats, F stays put in free cam', () => {
    startSpectator();
    enterSpectator();
    expect(press('BracketRight', ']').defaultPrevented).toBe(true);
    expect(following()).toEqual({ mode: 'follow', targetId: 'b' });
    press('BracketRight', ']');
    expect(following()).toEqual({ mode: 'follow', targetId: 'c' });
    press('BracketRight', ']');
    expect(following()).toEqual({ mode: 'follow', targetId: 'b' });
    press('BracketLeft', '[');
    expect(following()).toEqual({ mode: 'follow', targetId: 'c' });
    ticker.tick(40);
    expect(h.mem.get('cutsceneCameraTarget')).toEqual({ x: 40, y: 19.75 });
    press('KeyF', 'f');
    expect(following()).toEqual({ mode: 'free', targetId: null });
    ticker.tick(5);
    expect(h.mem.get('cutsceneCameraTarget')).toEqual({ x: 40, y: 19.75 });
  });

  it('a seat digit follows that seat; a seat with nobody else in it leaves the key alone', () => {
    startSpectator();
    enterSpectator();
    expect(press('Digit4', '4').defaultPrevented).toBe(true);
    expect(following()).toEqual({ mode: 'follow', targetId: 'c' });
    expect(press('Digit1', '1').defaultPrevented).toBe(false);
    expect(following()).toEqual({ mode: 'follow', targetId: 'c' });
  });

  it('WASD detaches where the camera is, even a tap released before the next frame', () => {
    startSpectator();
    enterSpectator();
    followPlayer('b');
    ticker.tick(40);
    press('KeyD', 'd');
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd' }));
    expect(following()).toEqual({ mode: 'free', targetId: null });
    ticker.tick(3);
    expect(h.mem.get('cutsceneCameraTarget')).toEqual({ x: 30, y: 19.75 });
  });

  it('the followed player leaving or going offline says so and drops to free cam; others changing does not', () => {
    startSpectator();
    enterSpectator();
    followPlayer('b');
    const emit = (): void => { for (const cb of [...h.playerSubs]) cb(h.players); };
    h.players = [{ id: 'b', name: 'Bee', seat: 2, online: true }];
    emit();
    expect(h.notices).toEqual([]);
    h.players = [{ id: 'b', name: 'Bee', seat: 2, online: false }];
    emit();
    expect(h.notices).toEqual(['feature.spectator.followLost {"name":"Bee"}']);
    expect(following()).toEqual({ mode: 'free', targetId: null });
    expect(isSpectatorActive()).toBe(true);
  });

  it('an offline player is skipped by ] and refused by their seat digit and by follow', () => {
    startSpectator();
    enterSpectator();
    h.players = [{ id: 'b', name: 'Bee', seat: 2, online: false }, { id: 'c', name: 'Cee', seat: 4, online: true }];
    press('BracketRight', ']');
    expect(following()).toEqual({ mode: 'follow', targetId: 'c' });
    press('BracketRight', ']');
    expect(following()).toEqual({ mode: 'follow', targetId: 'c' });
    expect(press('Digit2', '2').defaultPrevented).toBe(false);
    expect(followPlayer('b')).toBe(false);
    expect(following()).toEqual({ mode: 'follow', targetId: 'c' });
  });

  it('nobody to follow says so; following someone not seated is refused', () => {
    startSpectator();
    enterSpectator();
    h.players = [];
    cyclePlayer(1);
    expect(h.notices).toEqual(['feature.spectator.noPlayers']);
    expect(followPlayer('zz')).toBe(false);
    expect(following()).toEqual({ mode: 'free', targetId: null });
  });

  it('a click near a player follows them; a click on empty ground does nothing; a drag detaches and pans', () => {
    startSpectator();
    enterSpectator();
    // b's body is drawn 0.75 tile above tile (30, 20): grid (30, 19.25) is screen (1830, 1185).
    pointer('pointerdown', 1832, 1180);
    pointer('pointerup', 1832, 1180);
    expect(h.canvasSaw).toBe(0);
    expect(following()).toEqual({ mode: 'follow', targetId: 'b' });
    pointer('pointerdown', 600, 600);
    pointer('pointerup', 600, 600);
    expect(following()).toEqual({ mode: 'follow', targetId: 'b' });
    ticker.tick(40);
    pointer('pointerdown', 600, 600);
    pointer('pointermove', 660, 600);
    expect(following()).toEqual({ mode: 'free', targetId: null });
    pointer('pointerup', 660, 600);
    ticker.tick();
    expect(h.mem.get('cutsceneCameraTarget')).toEqual({ x: 29, y: 19.75 });
  });

  it('nothing to follow before spectating', () => {
    startSpectator();
    expect(followPlayer('b')).toBe(false);
    detach();
    cyclePlayer(1);
    expect(isSpectatorActive()).toBe(false);
  });
});

describe('the spectator bar in a session', () => {
  it('mounts on entry with the toggle key for Exit, and its Exit flies home', async () => {
    startSpectator();
    enterSpectator();
    expect(h.bars).toHaveLength(1);
    expect(h.bars[0]?.actions.exitKey()).toBe('G');
    h.bars[0]?.actions.exit();
    ticker.tick(40);
    await flush();
    expectNothingLeft();
  });

  it('Esc closes an open list first and only then leaves', async () => {
    startSpectator();
    enterSpectator();
    h.bars[0]!.popOpen = true;
    expect(press('Escape', 'Escape').defaultPrevented).toBe(true);
    ticker.tick(40);
    await flush();
    expect(isSpectatorActive()).toBe(true);
    press('Escape', 'Escape');
    ticker.tick(40);
    await flush();
    expectNothingLeft();
  });

  it('H hides and shows the spectator UI; idle, H is left alone', () => {
    startSpectator();
    expect(press('KeyH', 'h').defaultPrevented).toBe(false);
    enterSpectator();
    expect(press('KeyH', 'h').defaultPrevented).toBe(true);
    expect(getSpectatorState().uiHidden).toBe(true);
    press('KeyH', 'h');
    expect(getSpectatorState().uiHidden).toBe(false);
    exitSpectator('test');
    expect(getSpectatorState().uiHidden).toBe(false);
  });

  it('the first entry explains the keys once, with the bindings and the room\'s seats', () => {
    h.mem.delete('qpm.spectator.hints.v1');
    h.mem.set('userSlots', [null, null, null, null, null, null]);
    startSpectator();
    enterSpectator();
    exitSpectator('test');
    enterSpectator();
    expect(h.notices).toEqual([
      'feature.spectator.hint.first {"move":"WASD","prev":"[","next":"]","seats":"1–6","hide":"H","exit":"G"}',
    ]);
  });
});

describe('the info card in a session', () => {
  it('mounts on entry with I as its close key and reads the followed player\'s slot', async () => {
    h.mem.set('userSlots', [{ userId: 'me' }, { userId: 'b', data: { coinsCount: 1 } }]);
    startSpectator();
    enterSpectator();
    expect(h.cards).toHaveLength(1);
    expect(h.cards[0]?.src.closeKey()).toBe('I');
    expect(h.cards[0]?.src.slot('b')).toEqual({ userId: 'b', data: { coinsCount: 1 } });
    expect(h.cards[0]?.src.slot('gone')).toBeNull();
    h.watched.length = 0;
    h.cards[0]?.src.watch(() => {})();
    // userSlots skips hunger patches; seatPetSlots carries them.
    expect(h.watched).toEqual(['userSlots', 'seatPetSlots', 'players']);
    h.bars[0]?.actions.exit();
    ticker.tick(40);
    await flush();
    expectNothingLeft();
  });

  it('I hides it until I again, across spectating sessions; idle, I is left alone', () => {
    startSpectator();
    expect(press('KeyI', 'i').defaultPrevented).toBe(false);
    enterSpectator();
    expect(press('KeyI', 'i').defaultPrevented).toBe(true);
    expect(h.cards[0]?.src.hidden()).toBe(true);
    exitSpectator('test');
    enterSpectator();
    expect(h.cards[1]?.src.hidden()).toBe(true);
    press('KeyI', 'i');
    expect(h.cards[1]?.src.hidden()).toBe(false);
    exitSpectator('test');
  });
});

describe('photo mode in a session', () => {
  it('P and the bar\'s Photo turn it on and off; Enter captures only while it is on', () => {
    startSpectator();
    enterSpectator();
    expect(press('Enter', 'Enter').defaultPrevented).toBe(false);
    h.bars[0]?.actions.photo?.();
    expect(h.photo).toMatchObject({ cine: true, uiHidden: true, toggles: 1 });
    expect(press('Enter', 'Enter').defaultPrevented).toBe(true);
    expect(h.photo.captures).toBe(1);
    press('KeyP', 'p');
    expect(h.photo).toMatchObject({ cine: false, uiHidden: false, toggles: 2 });
    expect(isSpectatorActive()).toBe(true);
    exitSpectator('test');
  });

  it('entering closes an open popover; Esc then leaves photo mode, a popover, and spectating, in that order', async () => {
    startSpectator();
    enterSpectator();
    h.bars[0]!.popOpen = true;
    press('KeyP', 'p');
    expect(h.bars[0]?.popOpen).toBe(false);
    h.bars[0]!.popOpen = true;
    press('Escape', 'Escape');
    expect(h.photo.cine).toBe(false);
    expect(h.bars[0]?.popOpen).toBe(true);
    press('Escape', 'Escape');
    expect(h.bars[0]?.popOpen).toBe(false);
    expect(isSpectatorActive()).toBe(true);
    press('Escape', 'Escape');
    ticker.tick(40);
    await flush();
    expectNothingLeft();
  });
});
