import type { PixiHooks, SpriteState } from '../types';
import { createPixiHooks, waitForPixi } from '../hooks';
import { pageWindow } from '../../core/pageContext';
import type { PixiBundle } from './types';
import { hasExtractCanvas, updateBootReportRenderer } from './bootReport';

// PIXI hooks must install BEFORE the game calls __PIXI_APP_INIT__. main.ts calls
// initPixiHooks() as its very first statement so this stays at the same document-start
// timing that the old module-scope side-effect had.
let hooks: PixiHooks | null = null;

export function initPixiHooks(): void {
  if (hooks) return;
  hooks = createPixiHooks();
}

function requirePixiHooks(): PixiHooks {
  if (!hooks) hooks = createPixiHooks();
  return hooks;
}

/**
 * Get the page window context — delegates to pageContext for Firefox wrappedJSObject support.
 */
function getRoot(): any {
  return pageWindow;
}

/**
 * Traverse React fiber tree to find QuinoaEngine and extract PIXI renderer.
 * This is a fallback when hooks and global polling fail.
 */
function findPixiViaFiber(): PixiBundle | null {
  try {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;

    let element: Element | null = canvas;
    let fiber: any = null;

    while (element && !fiber) {
      const keys = Object.keys(element);
      for (const key of keys) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$')) {
          fiber = (element as any)[key];
          break;
        }
      }
      element = element.parentElement;
    }

    if (!fiber) return null;

    const queue: any[] = [fiber];
    const visited = new WeakSet();
    let iterations = 0;
    const maxIterations = 10000;

    while (queue.length > 0 && iterations++ < maxIterations) {
      const node = queue.shift();
      if (!node || visited.has(node)) continue;
      visited.add(node);

      let state = node.memoizedState;
      let hookDepth = 0;
      while (state && hookDepth++ < 50) {
        const ms = state.memoizedState !== undefined ? state.memoizedState : state;

        if (ms && typeof ms === 'object') {
          // Check for QuinoaEngine structure (has canvasSpriteCache with renderer)
          if (ms.canvasSpriteCache?.renderer) {
            return {
              app: ms.app || null,
              renderer: ms.canvasSpriteCache.renderer,
              version: null,
              runtimeHints: [ms.canvasSpriteCache, ms.gameTextureCache, ms],
            } as any;
          }
          if (ms.gameTextureCache?.renderer) {
            return {
              app: ms.app || null,
              renderer: ms.gameTextureCache.renderer,
              version: null,
              runtimeHints: [ms.gameTextureCache, ms.canvasSpriteCache, ms],
            } as any;
          }
          // Direct PIXI app check (has stage, renderer, ticker)
          if (ms.stage && ms.renderer && ms.ticker) {
            return { app: ms, renderer: ms.renderer, version: null };
          }
          if (ms.extract && ms.render && (ms.gl || ms.context)) {
            return { app: null, renderer: ms, version: null };
          }
        }

        state = state.next;
      }

      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
      if (node.return && !visited.has(node.return)) queue.push(node.return);
    }
  } catch {
    // Silent failure - will try other detection methods
  }

  return null;
}

export async function resolvePixiFast(): Promise<PixiBundle> {
  const root = getRoot();

  // Check 1: Injected script captured PIXI (critical for Chrome!)
  const checkInjectedCapture = (): PixiBundle | null => {
    const captured = root.__QPM_PIXI_CAPTURED__;
    if (captured?.app && captured?.renderer) {
      return {
        app: captured.app,
        renderer: captured.renderer,
        version: captured.version || null,
        runtimeHints: [captured.app?.canvasSpriteCache, captured.app?.gameTextureCache, captured.engine],
      } as any;
    }
    return null;
  };

  // Check 2: Global PIXI variables
  const checkGlobals = (): PixiBundle | null => {
    const app = root.__PIXI_APP__ || root.PIXI_APP || root.app || null;
    const renderer = root.__PIXI_RENDERER__ || root.PIXI_RENDERER__ || root.renderer || app?.renderer || null;

    if (app && renderer) {
      const version = root.__PIXI_VERSION__ || root.__PIXI__?.VERSION || root.PIXI?.VERSION || null;
      return {
        app,
        renderer,
        version,
        runtimeHints: [app?.canvasSpriteCache, app?.gameTextureCache, renderer?.canvasSpriteCache, renderer?.gameTextureCache],
      } as any;
    }
    return null;
  };

  // Check 3: Aries Mod's sprite service (piggyback if available)
  const checkAriesService = (): PixiBundle | null => {
    const ariesService = root.__MG_SPRITE_SERVICE__;
    if (ariesService?.state?.renderer) {
      return {
        app: ariesService.state.app || null,
        renderer: ariesService.state.renderer,
        version: ariesService.state.version || null,
        runtimeHints: [ariesService.state?.canvasSpriteCache, ariesService.state?.gameTextureCache, ariesService.state],
      } as any;
    }
    return null;
  };

  // Check 4: React fiber traversal (direct DOM inspection). Expensive — up to
  // ~10k-node BFS per call. Rate-limited on the poll path (see FIBER_MIN_INTERVAL_MS
  // below) after cheap checks have missed a few times in a row.
  const checkFiber = (): PixiBundle | null => findPixiViaFiber();

  const cheapCheck = (): PixiBundle | null =>
    checkInjectedCapture() || checkGlobals() || checkAriesService();

  // Try immediately (include fiber — a hit here skips all polling)
  const hit = cheapCheck() || checkFiber();
  if (hit) return hit;

  // Poll for up to 15 seconds. Cheap checks every 100ms; the expensive fiber
  // BFS at most once per second of WALL time (not iterations — background-tab
  // timer throttling collapses iteration counts) and only after a streak of
  // cheap misses.
  const maxMs = 15000;
  const pollStart = performance.now();
  const FIBER_MIN_MISS_STREAK = 5;
  const FIBER_MIN_INTERVAL_MS = 1000;
  let cheapMissStreak = 0;
  let lastFiberAt = pollStart;

  while (performance.now() - pollStart < maxMs) {
    await new Promise(r => setTimeout(r, 100));

    const cheap = cheapCheck();
    if (cheap) return cheap;
    cheapMissStreak += 1;

    if (
      cheapMissStreak >= FIBER_MIN_MISS_STREAK &&
      performance.now() - lastFiberAt >= FIBER_MIN_INTERVAL_MS
    ) {
      lastFiberAt = performance.now();
      const fibered = checkFiber();
      if (fibered) return fibered;
    }
  }

  // Final fallback: wait on hooks
  const waited = await waitForPixi(requirePixiHooks(), 5000).catch(() => ({ app: null, renderer: null, version: null }));

  if (waited.renderer || waited.app?.renderer) {
    return { app: waited.app, renderer: waited.renderer || waited.app?.renderer, version: waited.version };
  }

  throw new Error('PIXI app timeout');
}

export function resolveActiveRenderer(state: SpriteState, preferred?: any): any {
  const candidates: any[] = [];
  const push = (value: any) => {
    if (!value) return;
    if (!candidates.includes(value)) candidates.push(value);
  };

  push(state.app?.renderer);
  push(preferred);
  push(state.renderer);
  push(state.app?.render);

  const withExtract = candidates.find((renderer) => hasExtractCanvas(renderer));
  const picked = withExtract ?? candidates[0] ?? null;
  if (picked && picked !== state.renderer) {
    state.renderer = picked;
    updateBootReportRenderer(state);
  }
  return picked;
}
