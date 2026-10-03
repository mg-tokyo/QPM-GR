import { readSync } from '../../core/gameState';
import { getGameTexture } from '../../sprite-v2/gameTextures';
import { getEngineSystem } from '../../utils/quinoaEngine';
import { getCamera3dPasses, getCamera3dRuntime } from './index';
import type { WeatherTuning } from './scene/weather';

export const wait = (ms: number): Promise<void> => new Promise((res) => { setTimeout(res, ms); });

/** Spec §6.8.1 tuning (on, radiusTiles, thinTiles, standScale); returns the current values. */
export function weatherTune(t?: Partial<WeatherTuning>): WeatherTuning | null {
  const w = getCamera3dPasses()?.weather;
  if (!w) return null;
  if (t) Object.assign(w, t);
  return { ...w };
}

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/** GPU ms per 3D frame (timer query). Unlike frame gaps, an unfocused test window does not distort it. */
export async function gpu(ms = 3000): Promise<{ frames: number; avg: number; p95: number; disjoint: number } | string> {
  const r = getCamera3dRuntime();
  const gl = r?.caps.scene.renderer.gl;
  const ext = gl ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as unknown as TimerExt | null) : null;
  if (!r || !gl || !ext) return 'no timer query';
  const pending: WebGLQuery[] = [];
  const times: number[] = [];
  let open: WebGLQuery | null = null;
  let disjoint = 0;
  const collect = (): void => {
    while (pending.length && gl.getQueryParameter(pending[0]!, gl.QUERY_RESULT_AVAILABLE) === true) {
      const q = pending.shift()!;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT) === true) disjoint++;
      else times.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
      gl.deleteQuery(q);
    }
  };
  const close = (): void => { if (open) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(open); open = null; } };
  const offStage = r.onStageRender(() => {
    if (open || !r.isLive()) return;
    const q = gl.createQuery();
    if (!q) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    open = q;
  });
  const offFrame = r.onFrame(() => { close(); collect(); });
  try { await wait(ms); } finally { offStage(); offFrame(); close(); }
  await wait(250);
  collect();
  for (const q of pending) gl.deleteQuery(q);
  times.sort((a, b) => a - b);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  return { frames: times.length, avg: +avg.toFixed(3), p95: times.length ? +times[Math.floor(times.length * 0.95)]!.toFixed(3) : 0, disjoint };
}

let sim: { undo(): void } | null = null;

/** Debug-only and visual-only: the game's weather system draws `id` (e.g. 'Rain') as if the server sent it, by
 * shadowing its frame context's `weatherPresence`. Other systems that read `weatherPresence` see it too. null restores. */
export function simulateWeather(id: string | null): string {
  sim?.undo();
  sim = null;
  if (id === null) return 'restored';
  if (!getGameTexture(`weather/${id}Animation`)) return `unknown weather ${id}`;
  let engine: unknown = null;
  try { engine = readSync('quinoaEngine'); } catch { engine = null; }
  const sys = getEngineSystem(engine, 'weather') as Record<string, unknown> | null;
  const draw = sys?.draw;
  if (!sys || typeof draw !== 'function') return 'no weather system';
  const orig = draw as (...x: unknown[]) => unknown;
  const own = Object.prototype.hasOwnProperty.call(sys, 'draw');
  const presence = [{ weatherId: id, opacity01: 1 }];
  let ctx: Record<string, unknown> | null = null;
  let shadow: unknown = undefined;
  const undo = (): void => {
    if (ctx) { delete ctx.weatherPresence; ctx.weatherPresence = shadow; ctx = null; }
    if (own) sys.draw = orig; else delete sys.draw;
  };
  sys.draw = function (this: unknown, ...a: unknown[]): unknown {
    const c = a[0];
    if (!ctx && c && typeof c === 'object' && 'weatherPresence' in c) {
      ctx = c as Record<string, unknown>;
      shadow = ctx.weatherPresence;
      Object.defineProperty(ctx, 'weatherPresence', { configurable: true, enumerable: true, get: () => presence, set: (v: unknown) => { shadow = v; } });
    }
    try {
      return orig.apply(this, a);
    } catch {
      // A simulated id the game can't draw: put everything back and draw this frame as the game would.
      undo();
      sim = null;
      return orig.apply(this, a);
    }
  };
  sim = { undo };
  return `simulating ${id}`;
}
