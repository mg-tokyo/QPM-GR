// The sprite service's texture map (atlas key → the game's own GPU texture), for code that draws with the game's
// textures (the 3D camera's standing decor and fences). Canvas renders still go through compat.ts.
import { serviceReady } from './compat';
import { isRecord } from '../utils/typeGuards';

let tex: Map<string, unknown> | null = null;
let started = false;

export function startGameTextures(): void {
  if (started) return;
  started = true;
  void serviceReady.then((svc) => { tex = svc?.state.tex ?? null; });
}

export function getGameTexture(key: string): unknown {
  return tex?.get(key) ?? null;
}

export function getKeysByFrame(prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!tex) return out;
  for (const [key, t] of tex) {
    if (!key.startsWith(prefix) || !isRecord(t) || !isRecord(t.frame)) continue;
    out.set(`${String(t.frame.x)},${String(t.frame.y)}`, key);
  }
  return out;
}
