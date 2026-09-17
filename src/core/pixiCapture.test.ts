import { describe, it, expect, vi, beforeEach } from 'vitest';

const page: Record<string, unknown> = {};
vi.mock('./pageContext', () => ({
  get pageWindow() { return page; },
  readSharedGlobal: (name: string) => page[name],
  ensurePageObject: (name: string) => {
    if (!page[name] || typeof page[name] !== 'object') page[name] = {};
    return page[name] as Record<string, unknown>;
  },
}));
vi.mock('../diagnostics/logger', () => ({
  createNamedLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {} }),
}));
vi.mock('../utils/environment', () => ({ isDiscordSurface: false }));
(globalThis as unknown as { document: unknown }).document = { querySelector: () => null };
// getGameCanvas() uses `instanceof HTMLCanvasElement`; the node env has no such
// global. querySelector returns null so the class is never actually used, but
// the reference itself must resolve.
class HTMLCanvasElementStub {}
(globalThis as unknown as { HTMLCanvasElement: unknown }).HTMLCanvasElement = HTMLCanvasElementStub;

import {
  getPixiRefs, getCaptureDiag, getCaptureGeneration, repairPixiCapture, onPixiCaptureChange,
} from './pixiCapture';

const liveStage = () => ({ children: [{}], parent: null, destroyed: false });
const liveApp = () => ({ renderer: {}, stage: liveStage() });
const deadApp = () => ({ renderer: {}, stage: null });

beforeEach(() => { for (const k of Object.keys(page)) delete page[k]; });

describe('pixiCapture', () => {
  it('prefers a live service candidate even when the first candidate mirrors the dead app (S6-3)', () => {
    const dead = deadApp(); const live = liveApp();
    page.__QPM_PIXI_CAPTURED__ = { app: dead, renderer: dead.renderer, version: '8' };
    page.__QPM_SPRITE_SERVICE__ = { state: { app: dead, renderer: dead.renderer } };
    page.__MG_SPRITE_STATE__ = { app: live, renderer: live.renderer };
    const g0 = getCaptureGeneration();
    expect(getPixiRefs()?.stage).toBe(live.stage);
    expect((page.__QPM_PIXI_CAPTURED__ as { app: unknown }).app).toBe(live);
    expect(getCaptureGeneration()).toBe(g0 + 1);
    expect(getCaptureDiag().lastSource).toBe('service-live');
  });

  it('recovers the stage structurally and memoises it while the app stays dead (S6-4)', () => {
    const dead = deadApp(); const stage = liveStage();
    (dead.renderer as { lastObjectRendered?: unknown }).lastObjectRendered = stage;
    page.__QPM_PIXI_CAPTURED__ = { app: dead, renderer: dead.renderer };
    const a = getPixiRefs(); const b = getPixiRefs();
    expect(a?.stage).toBe(stage);
    expect(b?.stage).toBe(stage);
    expect(getCaptureDiag(b).stageSource).toBe('structural');
    stage.destroyed = true;
    expect(getPixiRefs()?.stage).toBeNull();
  });

  it('replaces only a present-but-dead app', () => {
    const live = liveApp(); const other = liveApp();
    page.__QPM_PIXI_CAPTURED__ = { app: live, renderer: live.renderer };
    const g0 = getCaptureGeneration();
    repairPixiCapture({ app: other, renderer: other.renderer }, 'hook-app-init');
    expect((page.__QPM_PIXI_CAPTURED__ as { app: unknown }).app).toBe(live);
    expect(getCaptureGeneration()).toBe(g0);
  });

  it('notifies listeners on fill and replace, never on reads', () => {
    const seen: string[] = [];
    const off = onPixiCaptureChange((e) => seen.push(e.kind));
    const dead = deadApp();
    repairPixiCapture({ app: dead, renderer: dead.renderer }, 'first');
    getPixiRefs(); getPixiRefs();
    const live = liveApp();
    repairPixiCapture({ app: live, renderer: live.renderer }, 'hook-app-init');
    off();
    repairPixiCapture({ version: '9' }, 'late');
    expect(seen).toEqual(['filled', 'replaced']);
  });

  it('diag carries the surface and the live flags', () => {
    const live = liveApp();
    page.__QPM_PIXI_CAPTURED__ = { app: live, renderer: live.renderer };
    const d = getCaptureDiag();
    expect(d).toMatchObject({ appPresent: true, appLive: true, stageLive: true, stageSource: 'app', surface: 'web' });
    expect(d).not.toHaveProperty('canvasStamped');
  });
});
