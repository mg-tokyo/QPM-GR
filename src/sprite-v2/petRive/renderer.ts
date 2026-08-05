import type { LowLevelRive } from '../../rive-engine/types';
import { spriteLog } from '../diagnostics';
import { dispatchCustomEventAll } from '../../core/pageContext';
import {
  petRiveState,
  type RivePetsFile,
  type RivePetsArtboard,
  type RivePetsRenderer,
} from './state';
import { cacheCanvas, clearPetRiveCache } from './cache';

// Native pets.riv artboard is 600×850; render into a 850×850 square so no
// downscale happens at source. UI downscales when needed (smoothly).
const OUTPUT_SIZE = 850;
const CONTAINER_ARTBOARD = 'Pets';

type RiveRuntimeWithEnums = LowLevelRive & {
  Fit?: { contain?: unknown };
  Alignment?: { center?: unknown };
  makeRenderer(canvas: HTMLCanvasElement): unknown;
  resolveAnimationFrame?(): void;
};

function createOffscreenCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  canvas.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;pointer-events:none;';
  return canvas;
}

function attachContextLossListener(canvas: HTMLCanvasElement, onRestore: () => void): () => void {
  const onLost = (ev: Event): void => {
    ev.preventDefault();
    petRiveState.ready = false;
    clearPetRiveCache();
    spriteLog('warn', 'pet-rive-context-lost', 'WebGL context lost on pet renderer canvas');
  };
  const onRestored = (): void => {
    spriteLog('info', 'pet-rive-context-restored', 'WebGL context restored — scheduling re-warm');
    try {
      onRestore();
    } catch (error) {
      spriteLog('warn', 'pet-rive-restore-failed', 'Re-warm after context restore failed', {
        error: String((error as Error)?.message ?? error),
      });
    }
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
  };
}

export async function setupRenderer(
  runtime: LowLevelRive,
  bytes: Uint8Array,
  onContextRestore: () => void,
): Promise<{ file: RivePetsFile; renderer: RivePetsRenderer; canvas: HTMLCanvasElement } | null> {
  const withEnums = runtime as RiveRuntimeWithEnums;

  const canvas = createOffscreenCanvas();
  document.body.appendChild(canvas);

  let renderer: RivePetsRenderer;
  try {
    renderer = withEnums.makeRenderer(canvas) as RivePetsRenderer;
  } catch (error) {
    canvas.remove();
    spriteLog('warn', 'pet-rive-renderer-failed', 'makeRenderer() failed', {
      error: String((error as Error)?.message ?? error),
    });
    return null;
  }

  let file: RivePetsFile;
  try {
    file = (await Promise.resolve(runtime.load(bytes))) as RivePetsFile;
  } catch (error) {
    canvas.remove();
    spriteLog('warn', 'pet-rive-load-failed', 'runtime.load(pets.riv) failed', {
      error: String((error as Error)?.message ?? error),
    });
    return null;
  }

  petRiveState.cleanups.push(attachContextLossListener(canvas, onContextRestore));

  return { file, renderer, canvas };
}

function renderArtboardToWorkCanvas(
  runtime: LowLevelRive,
  renderer: RivePetsRenderer,
  workCanvas: HTMLCanvasElement,
  artboard: RivePetsArtboard,
): boolean {
  const withEnums = runtime as RiveRuntimeWithEnums;
  const fit = withEnums.Fit?.contain;
  const alignment = withEnums.Alignment?.center;
  if (fit === undefined || alignment === undefined) return false;

  let sm: { advance(seconds: number): void; delete?(): void } | null = null;
  try {
    const smDef = artboard.stateMachineByIndex(0);
    if (smDef) {
      const SmiCtor = (runtime as unknown as {
        StateMachineInstance: new (def: unknown, ab: unknown) => { advance(s: number): void; delete?(): void };
      }).StateMachineInstance;
      sm = new SmiCtor(smDef, artboard);
    }

    if (sm) sm.advance(0);
    artboard.advance(0);

    renderer.invalidateGLState?.();
    renderer.clear();
    renderer.save();
    renderer.align(
      fit,
      alignment,
      { minX: 0, minY: 0, maxX: workCanvas.width, maxY: workCanvas.height },
      artboard.bounds,
    );
    artboard.draw(renderer);
    renderer.restore();
    renderer.flush?.();
    withEnums.resolveAnimationFrame?.();
    renderer.unbindGLInternalResources?.();
    return true;
  } catch (error) {
    spriteLog('warn', 'pet-rive-draw-failed', `artboard.draw failed for '${artboard.name}'`, {
      error: String((error as Error)?.message ?? error),
    });
    return false;
  } finally {
    try { sm?.delete?.(); } catch { /* ignore */ }
  }
}

// Alpha threshold below which a pixel is treated as fully transparent.
// Rive artboards have wide transparent padding for animation reach (motion,
// thought bubbles); the actual pet sits in a small central area. Cropping to
// visible bounds means the pet fills the output canvas and downstream sizes
// (32/48/64/96 px) don't shrink it to a speck.
const ALPHA_CROP_THRESHOLD = 8;
const ALPHA_CROP_MARGIN = 2;

function findAlphaBounds(pixels: Uint8ClampedArray, w: number, h: number):
  { x: number; y: number; w: number; h: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const alpha = pixels[(y * w + x) * 4 + 3] ?? 0;
      if (alpha <= ALPHA_CROP_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const pad = ALPHA_CROP_MARGIN;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(w, maxX + 1 + pad);
  const y1 = Math.min(h, maxY + 1 + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function extractSpeciesCanvas(source: HTMLCanvasElement): HTMLCanvasElement | null {
  // First blit the WebGL canvas into a 2D canvas so we can read pixels.
  const full = document.createElement('canvas');
  full.width = source.width;
  full.height = source.height;
  const fullCtx = full.getContext('2d');
  if (!fullCtx) return null;
  try {
    fullCtx.drawImage(source, 0, 0);
  } catch {
    return null;
  }

  let imageData: ImageData;
  try {
    imageData = fullCtx.getImageData(0, 0, full.width, full.height);
  } catch {
    return full;
  }
  const bounds = findAlphaBounds(imageData.data, full.width, full.height);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return full;

  const out = document.createElement('canvas');
  out.width = bounds.w;
  out.height = bounds.h;
  const outCtx = out.getContext('2d');
  if (!outCtx) return full;
  try {
    outCtx.drawImage(full, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    return out;
  } catch {
    return full;
  }
}

export function warmupAllSpecies(
  runtime: LowLevelRive,
  file: RivePetsFile,
  renderer: RivePetsRenderer,
  workCanvas: HTMLCanvasElement,
): { rendered: string[]; skipped: string[] } {
  const rendered: string[] = [];
  const skipped: string[] = [];
  const count = file.artboardCount();

  for (let i = 0; i < count; i += 1) {
    const artboard = file.artboardByIndex(i);
    if (!artboard) continue;
    const name = artboard.name;

    if (name === CONTAINER_ARTBOARD) {
      try { artboard.delete?.(); } catch { /* ignore */ }
      continue;
    }

    petRiveState.artboardNames.add(name);

    const ok = renderArtboardToWorkCanvas(runtime, renderer, workCanvas, artboard);
    if (ok) {
      const extracted = extractSpeciesCanvas(workCanvas);
      if (extracted) {
        cacheCanvas(name, extracted);
        rendered.push(name);
      } else {
        skipped.push(name);
      }
    } else {
      skipped.push(name);
    }

    try { artboard.delete?.(); } catch { /* ignore */ }
  }

  return { rendered, skipped };
}

export function notifySpritesRefresh(): void {
  try {
    dispatchCustomEventAll('qpm:sprite-hydration-state-change', {
      source: 'petRive',
      cached: petRiveState.artboardNames.size,
    });
  } catch {
    // event dispatch is best-effort — UIs will re-render naturally on next redraw
  }
}
