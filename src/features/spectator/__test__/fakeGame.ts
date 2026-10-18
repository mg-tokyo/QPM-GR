import type { SpecTicker, SpecZoomSys } from '../handles';

/** Runs listeners highest priority first, as PIXI's ticker does. */
export function createFakeTicker(deltaMS = 1000 / 30): SpecTicker & { tick(n?: number): void; priorities(): number[] } {
  const fns = new Map<() => void, number>();
  const t = {
    deltaMS,
    elapsedMS: deltaMS,
    maxFPS: 0,
    lastTime: 0,
    add(fn: () => void, _ctx: null, priority: number) { fns.set(fn, priority); return t; },
    remove(fn: () => void) { fns.delete(fn); return t; },
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        t.lastTime += t.deltaMS;
        for (const [fn] of [...fns].sort((a, b) => b[1] - a[1])) fn();
      }
    },
    priorities: () => [...fns.values()],
  };
  return t;
}

/** The live 1448 controller's shape: intent is the real zoom; writeIntent mirrors it into zoomIntentAtom (onWrite). */
export function createFakeZoomSys(onWrite: (intent: number) => void, intent = 60): SpecZoomSys & { blocked: boolean; stepped: number[] } {
  const zoom = {
    intent,
    inputBlocked: false,
    region: { w: 101, h: 60 },
    get effective() { return zoom.intent; },
    get intentTileSize() { return zoom.intent; },
    stepKeyboard(dir: number) { zoom.setIntent(zoom.intent * (dir > 0 ? 1.3 : 1 / 1.3)); },
    applySteppedZoom(t: number) { sys.stepped.push(t); zoom.setIntent(t); },
    setIntent(t: number) { zoom.intent = t; onWrite(t); },
  };
  const sys = {
    zoom,
    blocked: false,
    stepped: [] as number[],
    shouldBlockZoom: () => sys.blocked,
  };
  return sys;
}
