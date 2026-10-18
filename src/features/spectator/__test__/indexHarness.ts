import type { CaptureSource } from '../photo/capture';
import type { PhotoDeps } from '../photo/mode';
import { createFakeTicker, createFakeZoomSys } from './fakeGame';

// The module fakes index.test.ts installs with vi.mock. The state object is created inside vi.hoisted in the test file, so
// it survives vi.resetModules (the factories run again and get the same object).

type Cb<T> = (v: T) => void;
interface BarRecord { destroyed: boolean; popOpen: boolean; actions: { exitKey(): string; exit(): void; photo?(): void } }
interface CardSource {
  closeKey(): string; hidden(): boolean; setHidden(h: boolean): void; slot(id: string): unknown; watch(cb: () => void): () => void;
}
interface Player { id: string; name: string; seat: number; online: boolean }

export function createHarnessState() {
  return {
    mem: new Map<string, unknown>(),
    lineSource: null as (() => string | null) | null,
    check: { ok: true, missing: [] as string[], facts: {} },
    warns: [] as Array<{ code: string; ctx: unknown }>,
    infos: [] as Array<{ code: string; ctx: unknown }>,
    handles: null as unknown,
    block: null as string | null,
    capture: new Set<() => void>(),
    room: new Set<(room: unknown, why: string) => void>(),
    engineSubs: new Set<Cb<unknown>>(),
    engine: { id: 'engine-1' } as object,
    activity: 0,
    players: [] as Player[],
    playerSubs: new Set<Cb<unknown>>(),
    notices: [] as string[],
    bars: [] as BarRecord[],
    cards: [] as Array<{ destroyed: boolean; src: CardSource }>,
    watched: [] as string[],
    ticker: createFakeTicker(),
    zoomSys: createFakeZoomSys(() => {}),
    canvas: null as HTMLCanvasElement | null,
    canvasSaw: 0,
    views: new Map<unknown, unknown>(),
    photo: newPhotoGame(),
  };
}
export type HarnessState = ReturnType<typeof createHarnessState>;

// Cinematic Mode as photo mode sees it, plus what photo mode put on the page.
function newPhotoGame() {
  return { cine: false, toggles: 0, uiHidden: false, captures: 0, strips: [] as Array<{ destroyed: boolean }>, subs: new Set<() => void>() };
}

export const photoLiveMock = (h: HarnessState) => ({
  livePhotoDeps: (): PhotoDeps => ({
    game: () => ({
      cinematic: () => h.photo.cine,
      onCinematic: (cb) => { h.photo.subs.add(cb); return () => { h.photo.subs.delete(cb); }; },
      toggleCinematic: () => { h.photo.toggles++; h.photo.cine = !h.photo.cine; return true; },
      source: {} as CaptureSource,
    }),
    capture: () => { h.photo.captures++; return { result: Promise.resolve(null), cancel: () => {} }; },
    strip: () => {
      const s = { destroyed: false };
      h.photo.strips.push(s);
      return { update: () => {}, destroy: () => { s.destroyed = true; } };
    },
    pageUiHidden: (hidden) => { h.photo.uiHidden = hidden; },
    output: { save: () => {}, copy: async () => true, downloads: () => true, preview: () => () => {} },
    unavailable: () => {},
    blocked: () => {},
  }),
});

export const barMock = (h: HarnessState) => ({
  mountBar: (_store: unknown, actions: BarRecord['actions']) => {
    const b: BarRecord = { destroyed: false, popOpen: false, actions };
    h.bars.push(b);
    return {
      setWaypointsMenu: () => {},
      closePopover: () => { const was = b.popOpen; b.popOpen = false; return was; },
      destroy: () => { b.destroyed = true; },
    };
  },
});

export const infoCardMock = (h: HarnessState) => ({
  mountInfoCard: (_store: unknown, src: CardSource) => {
    const c = { destroyed: false, src };
    h.cards.push(c);
    return { toggle: () => { src.setHidden(!src.hidden()); }, destroy: () => { c.destroyed = true; } };
  },
});

export const waypointMenuMock = () => ({
  createWaypointMenu: () => ({ el: document.createElement('div'), render: () => {}, endEdit: () => {}, destroy: () => {} }),
});

export const playersMock = <T extends object>(h: HarnessState, orig: T) => ({
  ...orig,
  listSeatedPlayers: () => h.players,
  onPlayersChange: (cb: Cb<unknown>) => { h.playerSubs.add(cb); return () => { h.playerSubs.delete(cb); }; },
});

export const notificationsMock = (h: HarnessState) => ({ notify: (e: { message: string }) => { h.notices.push(e.message); } });

export const i18nMock = () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) });

export const storageMock = (h: HarnessState) => ({
  storage: {
    get: (k: string, d: unknown = null) => (h.mem.has(k) ? h.mem.get(k) : d),
    set: (k: string, v: unknown) => { h.mem.set(k, v); },
  },
});

export const gameStateMock = (h: HarnessState) => ({
  readSync: (k: string) => (h.mem.has(k) ? h.mem.get(k) : null),
  writeSync: (k: string, v: unknown) => { h.mem.set(k, v); return true; },
  subscribe: (k: string, cb: Cb<unknown>) => {
    if (k !== 'quinoaEngine') { h.watched.push(k); return () => {}; }
    h.engineSubs.add(cb);
    cb(h.engine);
    return () => { h.engineSubs.delete(cb); };
  },
});

export const pixiCaptureMock = (h: HarnessState) => ({
  onPixiCaptureChange: (cb: () => void) => { h.capture.add(cb); return () => { h.capture.delete(cb); }; },
});

export const roomEventsMock = (h: HarnessState) => ({
  onRoomConnectionChange: (cb: (room: unknown, why: string) => void) => {
    h.room.add(cb);
    cb(null, 'initial');
    return () => { h.room.delete(cb); };
  },
});

export const camera3dMock = (h: HarnessState) => ({ setCamera3dExternalBlock: (r: string | null) => { h.block = r; } });

export const copyPayloadMock = (h: HarnessState) => ({
  setSpectatorLineSource: (s: (() => string | null) | null) => { h.lineSource = s; },
});

export const featureDiagnosticsMock = (h: HarnessState) => ({
  createFeatureDiagnostics: () => ({
    ensureBusRegistered: () => {}, publishOk: () => {},
    warnFeature: (code: string, ctx: unknown) => { h.warns.push({ code, ctx }); },
    diag: { info: (code: string, ctx: unknown) => { h.infos.push({ code, ctx }); } },
  }),
});

export const probeMock = (h: HarnessState) => ({
  startupCheck: () => h.check,
  TRANSIENT_MISSING: new Set(['target-busy', 'not-seated']),
});

export const handlesMock = (h: HarnessState) => ({
  resolveHandles: () => h.handles,
  zoomSystemOf: () => (h.handles as { zoomSys: unknown } | null)?.zoomSys ?? null,
  hotbarTopCss: () => null,
});

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => { queueMicrotask(r); });
};

export const press = (code: string, key: string): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { code, key, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

export function pointer(h: HarnessState, type: string, x: number, y: number): void {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1 });
  (type === 'pointerdown' && h.canvas ? h.canvas : window).dispatchEvent(e);
}

// A seated avatar on screen, standing on tile (gx, gy) (live 1448 shape: container = natural, 192 px rest offset).
export function avatarAt(gx: number, gy: number) {
  const ncx = (gx + 0.5) * 256, ncy = (gy + 0.5) * 256 - 192;
  return {
    naturalContainerX: ncx, naturalContainerY: ncy, gridPosition: { x: gx, y: gy }, isInViewport: true, container: { x: ncx, y: ncy },
    positionSmoothing: { isInterpolating: false, lastGoalWorldY: ncy, advance: () => ({ x: ncx, y: ncy }) },
  };
}

export const OTHER_OWNER = { ownerName: 'gameDialog', token: 'gameDialog:1', allowMovementKeys: 'none' };

/** The beforeEach state: a seated player at (24, 24), two others on screen, nothing of spectator's installed. */
export function resetHarness(h: HarnessState): void {
  h.mem.clear();
  h.warns.length = 0;
  h.infos.length = 0;
  h.check = { ok: true, missing: [], facts: {} };
  h.mem.set('localPresence', 'seated');
  h.mem.set('cameraTarget', { x: 24, y: 23.75 });
  h.mem.set('localPosition', { x: 24, y: 24 });
  h.mem.set('cutsceneCameraTarget', null);
  h.mem.set('activeCutscene', null);
  h.mem.set('tramJourney', null);
  h.mem.set('keyboardCaptureOwners', [OTHER_OWNER]);
  h.mem.set('zoomIntent', null);
  h.mem.set('qpm.spectator.hints.v1', { entered: true });
  h.bars.length = 0;
  h.cards.length = 0;
  h.photo = newPhotoGame();
  h.ticker = createFakeTicker();
  h.zoomSys = createFakeZoomSys((t) => { h.mem.set('zoomIntent', t); });
  h.activity = 0;
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  h.canvas = canvas;
  document.body.append(canvas);
  h.canvasSaw = 0;
  canvas.addEventListener('pointerdown', () => { h.canvasSaw++; });
  h.views.clear();
  h.views.set('b', avatarAt(30, 20));
  h.views.set('c', avatarAt(40, 20));
  h.players = [{ id: 'b', name: 'Bee', seat: 2, online: true }, { id: 'c', name: 'Cee', seat: 4, online: true }];
  h.notices.length = 0;
  h.handles = {
    engine: h.engine, ticker: h.ticker, zoomSys: h.zoomSys, viewSize: () => ({ w: 1278, h: 632 }), cameraPoint: () => null,
    notifyActivity: () => { h.activity++; }, liveZoom: () => h.zoomSys.zoom,
    avatars: { views: h.views, userPositions: new Map() },
    // 60 px per tile with tile (0, 0) at the top left: the click maths of World's transform.
    pointer: {
      isCanvas: (t: EventTarget | null) => t === canvas, toGlobal: (x: number, y: number) => ({ x, y }), overUi: () => false,
      toGrid: (x: number, y: number) => ({ x: x / 60 - 0.5, y: y / 60 - 0.5 }),
    },
  };
}
