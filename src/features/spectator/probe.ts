import {
  atomObjectFor, CAMERA_KEY_NAMES, explain, isGameStateReady, readSync, writeSync, type GameStateKey,
} from '../../core/gameState';
import { getPixiRefs } from '../../core/pixiCapture';
import { isRecord } from '../../utils/typeGuards';
import { canFollowViews } from './follow';
import { avatarSystemOf, tickerOf, zoomSystemOf, type SpecTicker as TickerLike } from './handles';
import { sameGrid } from './stepAside';

export interface ProbeResult { ok: boolean; missing: string[]; facts: Record<string, unknown> }

/** QPM still booting, the game owns the target, or the player has no seat: retry later, never QPM-SPEC-001. */
export const TRANSIENT_MISSING: ReadonlySet<string> = new Set(['not-ready', 'target-busy', 'not-seated']);

const WRITABLE_KEYS: readonly GameStateKey[] = ['cutsceneCameraTarget', 'freelookCameraPosition', 'zoomIntent', 'keyboardCaptureOwners'];
const ORDER_SAMPLES = 5;
const ORDER_TIMEOUT_MS = 2000;

const avatarViews = (engine: unknown): Map<unknown, unknown> | null => avatarSystemOf(engine)?.views ?? null;

/** S §4.7: every handle present, and a test point written to the cutscene target reaches cameraTarget. The write and
 * its restore happen in one synchronous call, between game frames, so no frame can draw the test point. */
export function startupCheck(): ProbeResult {
  const missing: string[] = [];
  const facts: Record<string, unknown> = {};
  if (!isGameStateReady()) return { ok: false, missing: ['not-ready'], facts };
  try {
    for (const k of CAMERA_KEY_NAMES) if (explain(k).boundVia === null) missing.push(k);
    const engine = readSync('quinoaEngine');
    if (!engine) missing.push('engine');
    if (!tickerOf()) missing.push('ticker');
    if (!zoomSystemOf(engine)) missing.push('zoom');
    const views = avatarViews(engine);
    if (!views) missing.push('avatar-views');
    else if (!canFollowViews(views, performance.now())) missing.push('avatar-view');
    const presence = readSync('localPresence');
    facts.presence = presence;
    if (missing.length > 0) return { ok: false, missing, facts };
    if (presence !== 'seated') return { ok: false, missing: ['not-seated'], facts };
    const held = readSync('cutsceneCameraTarget');
    if (held !== null) return { ok: false, missing: ['target-busy'], facts: { ...facts, held } };
    const before = readSync('cameraTarget');
    const point = { x: (before?.x ?? 0) + 0.5, y: (before?.y ?? 0) + 0.5 };
    const wrote = writeSync('cutsceneCameraTarget', point);
    const seen = readSync('cameraTarget');
    const restored = writeSync('cutsceneCameraTarget', null);
    const after = readSync('cameraTarget');
    facts.writeTest = { before, point, wrote, seen, restored, after };
    if (!wrote || !sameGrid(seen, point)) missing.push('write-test');
    // readSync falls back to null on a failed read, so the derived target must also be back where it was.
    if (!restored || readSync('cutsceneCameraTarget') !== null || (before && !sameGrid(after, before))) missing.push('restore');
  } catch (e) {
    missing.push(`threw:${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: missing.length === 0, missing, facts };
}

function describeOwners(): Record<string, unknown> {
  const owners = readSync('keyboardCaptureOwners');
  return { isArray: Array.isArray(owners), count: owners?.length ?? null, sample: owners?.[0] ? Object.keys(owners[0]) : [] };
}

function describeLocalView(engine: unknown): { ok: boolean; facts: Record<string, unknown> } {
  const views = avatarViews(engine);
  const pid = readSync('playerId');
  const v = views && pid ? views.get(pid) : undefined;
  if (!isRecord(v)) return { ok: false, facts: { views: views?.size ?? null, found: false } };
  const c = isRecord(v.container) ? v.container : null;
  const ps = isRecord(v.positionSmoothing) ? v.positionSmoothing : null;
  const ok = !!c && typeof c.x === 'number' && typeof c.y === 'number' && isRecord(v.gridPosition)
    && typeof v.naturalContainerY === 'number' && !!ps;
  return {
    ok,
    facts: {
      views: views?.size ?? null, label: c?.label, container: c ? { x: c.x, y: c.y } : null, gridPosition: v.gridPosition,
      naturalContainerX: v.naturalContainerX, naturalContainerY: v.naturalContainerY, drawOffsetYPixels: v.drawOffsetYPixels,
      depthYPixels: v.depthYPixels, positionSmoothing: ps ? Object.keys(ps) : null,
    },
  };
}

// PIXI's private listener list (debug only): which priority the engine's onTick and the app's render use.
function listenerList(ticker: TickerLike, engine: Record<string, unknown>): Array<{ pri: unknown; role: string }> {
  const out: Array<{ pri: unknown; role: string }> = [];
  const head = (ticker as unknown as { _head?: unknown })._head;
  let n: unknown = isRecord(head) ? head.next : null;
  const render = getPixiRefs()?.app?.render;
  while (isRecord(n) && out.length < 32) {
    const fn = n._fn;
    out.push({ pri: n.priority, role: fn === engine.tickerCallback ? 'engine' : fn === render ? 'render' : 'other' });
    n = n.next;
  }
  return out;
}

/** The engine stamps lastFrameTimeMs = ticker.lastTime + elapsedMS at the top of onTick (QuinoaCanvas chunk, live 1448):
 * a listener before it reads the previous frame's stamp, one after it reads this frame's. */
function tickerOrder(ticker: TickerLike, engine: Record<string, unknown>): Promise<Record<string, unknown>> {
  const list = listenerList(ticker, engine);
  const enginePri = list.find((l) => l.role === 'engine')?.pri;
  const renderPri = list.find((l) => l.role === 'render')?.pri;
  const base = { list, maxFPS: ticker.maxFPS, enginePri, renderPri };
  if (typeof enginePri !== 'number' || typeof engine.lastFrameTimeMs !== 'number') {
    return Promise.resolve({ ...base, proven: false, reason: 'engine listener or lastFrameTimeMs not found' });
  }
  const before = enginePri + 1;
  const after = enginePri - 1;
  if (typeof renderPri === 'number' && after <= renderPri) return Promise.resolve({ ...base, proven: false, reason: 'no gap before render' });
  const samples: Array<{ beforeSaw: boolean; afterSaw: boolean; dtMs: number }> = [];
  let pending: { now: number; saw: boolean; t: number } | null = null;
  const stamp = (): number => ticker.lastTime + ticker.elapsedMS;
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (reason: string | null): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      try { ticker.remove(beforeFn, null); } catch { /* already gone */ }
      try { ticker.remove(afterFn, null); } catch { /* already gone */ }
      const proven = samples.length > 0 && samples.every((s) => !s.beforeSaw && s.afterSaw && s.dtMs >= 0);
      resolve({ ...base, before, after, samples, proven, reason });
    };
    function beforeFn(): void {
      try { pending = { now: stamp(), saw: engine.lastFrameTimeMs === stamp(), t: performance.now() }; } catch { finish('before threw'); }
    }
    function afterFn(): void {
      try {
        const now = stamp();
        if (!pending || pending.now !== now) return;
        samples.push({ beforeSaw: pending.saw, afterSaw: engine.lastFrameTimeMs === now, dtMs: performance.now() - pending.t });
        pending = null;
        if (samples.length >= ORDER_SAMPLES) finish(null);
      } catch { finish('after threw'); }
    }
    timer = setTimeout(() => finish('timeout'), ORDER_TIMEOUT_MS);
    try {
      ticker.add(beforeFn, null, before);
      ticker.add(afterFn, null, after);
    } catch (e) {
      finish(`add threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

/** Debug: the startup check plus the facts Task 1 records (capture owners, atom kinds, the local AvatarView, ticker order).
 * The two ticker listeners exist only until this resolves. */
export async function probe(): Promise<ProbeResult> {
  const check = startupCheck();
  const missing = [...check.missing];
  const facts: Record<string, unknown> = { ...check.facts };
  try {
    facts.captureOwners = describeOwners();
    facts.primitiveAtoms = Object.fromEntries(WRITABLE_KEYS.map((k) => {
      const atom = atomObjectFor(k);
      return [k, isRecord(atom) && 'init' in atom];
    }));
    const engine = readSync('quinoaEngine');
    facts.engineAppMatches = isRecord(engine) && engine.app === getPixiRefs()?.app;
    const view = describeLocalView(engine);
    facts.avatarView = view.facts;
    if (!view.ok) missing.push('avatar-fields');
    const ticker = tickerOf();
    if (ticker && isRecord(engine)) {
      const order = await tickerOrder(ticker, engine);
      facts.tickerOrder = order;
      if (order.proven !== true) missing.push('ticker-order');
    }
  } catch (e) {
    missing.push(`threw:${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: missing.length === 0, missing, facts };
}
