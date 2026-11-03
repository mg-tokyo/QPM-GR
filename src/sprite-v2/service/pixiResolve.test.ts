// Boot-miss reproduction for tri-2026-10-31-003 / -011: the PIXI init hook never
// fired, so __QPM_PIXI_CAPTURED__ stayed empty and every capture consumer (the
// tooltip anchor included) was dead until a reload. Live 2026-11-02 (game 1847):
// the React fiber tree holds no PIXI shape (findPixiViaFiber finds nothing), while
// quinoaEngine.page.app is the very app the hook captures.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const page: Record<string, unknown> = {};
vi.mock('../../core/pageContext', () => ({
  get pageWindow() { return page; },
  isIsolatedContext: false,
  readSharedGlobal: (name: string) => page[name],
  shareGlobal: (name: string, value: unknown) => { page[name] = value; },
  ensurePageObject: (name: string) => {
    if (!page[name] || typeof page[name] !== 'object') page[name] = {};
    return page[name] as Record<string, unknown>;
  },
}));
vi.mock('../../diagnostics/logger', () => ({
  createNamedLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
  isVerboseLogsEnabled: () => false,
  writeShimConsole: () => {},
}));
vi.mock('../diagnostics', () => ({ spriteLog: () => {} }));
vi.mock('../../utils/environment', () => ({ isDiscordSurface: false }));

let engine: unknown = null;
vi.mock('../../core/gameState', () => ({
  isGameStateReady: () => true,
  readSync: (key: string) => (key === 'quinoaEngine' ? engine : null),
  subscribe: () => () => {},
}));

class HTMLCanvasElementStub {
  width = 1000;
  height = 500;
  parentElement: unknown = null;
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 500 }; }
}
(globalThis as unknown as { HTMLCanvasElement: unknown }).HTMLCanvasElement = HTMLCanvasElementStub;

const canvas = new HTMLCanvasElementStub();
// A React fiber with no PIXI shape in any hook state — what the live tree holds.
const emptyFiber = { memoizedState: { memoizedState: { foo: 1 }, next: null }, child: null, sibling: null, return: null };
(canvas as unknown as Record<string, unknown>)['__reactFiber$test'] = emptyFiber;

(globalThis as unknown as { document: unknown }).document = {
  readyState: 'complete',
  visibilityState: 'visible',
  head: { appendChild: () => {} },
  documentElement: { appendChild: () => {} },
  createElement: () => ({ textContent: '', remove: () => {} }),
  querySelector: (sel: string) => (sel === '.QuinoaCanvas canvas' || sel === 'canvas' ? canvas : null),
  querySelectorAll: (sel: string) => (sel === 'canvas' ? [canvas] : []),
};

interface Node { label: string; children: Node[]; parent: Node | null; destroyed: boolean; visible: boolean; getBounds?: () => unknown }
const node = (label: string, children: Node[] = []): Node => {
  const n: Node = { label, children, parent: null, destroyed: false, visible: true };
  for (const c of children) c.parent = n;
  return n;
};

function buildGame() {
  const card = node('GardenInfoCardSystem');
  card.getBounds = () => ({ x: 100, y: 300, width: 200, height: 100 });
  const stage = node('Stage', [node('UI', [card]), node('StageUiRoot')]);
  const app = { stage, renderer: { screen: { width: 1000, height: 500 }, view: canvas }, ticker: {} };
  return { app, stage };
}

async function loadModules() {
  vi.resetModules();
  const resolve = await import('./pixiResolve');
  const capture = await import('../../core/pixiCapture');
  const anchor = await import('../../features/standalone/tooltipInjection/pixiAnchor');
  return { resolve, capture, anchor };
}

beforeEach(() => {
  for (const k of Object.keys(page)) delete page[k];
  engine = null;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  // Faked performance.now() starts at 0; the anchor's 2 s miss throttle
  // (pixiAnchor.ts discoverCard) would read that as "missed just now".
  vi.advanceTimersByTime(5_000);
});
afterEach(() => { vi.useRealTimers(); });

describe('PIXI capture boot miss', () => {
  it('control: when the init hook fires, the capture fills and the anchor finds the card', async () => {
    const { resolve, capture, anchor } = await loadModules();
    const { app, stage } = buildGame();
    resolve.initPixiHooks();
    (page.__PIXI_APP_INIT__ as (a: unknown, v: string) => void)(app, '8.22.0');

    await expect(resolve.resolvePixiFast()).resolves.toMatchObject({ app });
    expect(capture.getPixiRefs()?.stage).toBe(stage);
    expect(anchor.getCardBounds()).not.toBeNull();
  });

  it('recovers when the init hook never fired but the game engine holds the app', async () => {
    const { resolve, capture, anchor } = await loadModules();
    const { app, stage } = buildGame();
    resolve.initPixiHooks();
    engine = { page: { app, playerViews: {}, rendererScope: {} }, lastFrameTimeMs: 0 };

    const boot = resolve.resolvePixiFast().then(() => 'resolved', (err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(25_000);
    const bootOutcome = await boot;
    // The rest of the session: nothing else is allowed to change state.
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(capture.getPixiRefs()?.stage ?? null).toBe(stage);
    expect(anchor.getCardBounds()).not.toBeNull();
    expect(bootOutcome).toBe('resolved');
  });

  it('pixiFromEngine only accepts an app with a stage and a renderer', async () => {
    const { resolve } = await loadModules();
    const { app } = buildGame();
    expect(resolve.pixiFromEngine({ page: { app } })?.app).toBe(app);
    expect(resolve.pixiFromEngine({ getSystem: () => null })).toBeNull();
    expect(resolve.pixiFromEngine({ boot: { seatScope: {} } })).toBeNull();
    expect(resolve.pixiFromEngine({ page: { app: { renderer: {} } } })).toBeNull();
    expect(resolve.pixiFromEngine({ page: { app: { stage: {} } } })).toBeNull();
    expect(resolve.pixiFromEngine(null)).toBeNull();
  });

  it('times out with a compact message and keeps the full probe', async () => {
    const { resolve } = await loadModules();
    resolve.initPixiHooks();

    const boot = resolve.resolvePixiFast().then(
      () => null,
      (err: Error & { qpmDiagnostic?: Record<string, unknown> }) => err,
    );
    await vi.advanceTimersByTimeAsync(25_000);
    const err = await boot;

    expect(err?.message).toMatch(/^PIXI app timeout \(hook=\S+ engine=0 cap=0\/0 /);
    expect(err?.message).not.toContain('{');
    expect(err?.qpmDiagnostic).toMatchObject({ engineApp: false, injectedApp: false, appInitHook: 'function' });
  });
});
