import {
  awaitRiveSingleton,
  type LowLevelRive,
} from '../../rive-engine';
import { listSeenRivUrls } from '../../rive-engine/fetchInterceptor';
import { pageWindow } from '../../core/pageContext';

interface RiveFile {
  defaultArtboard(): RiveArtboard;
  artboardByName(name: string): RiveArtboard | null;
  artboardByIndex(index: number): RiveArtboard | null;
  delete?(): void;
}

interface RiveArtboard {
  width: number;
  height: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stateMachineByIndex(index: number): unknown;
  stateMachineByName(name: string): unknown;
  stateMachineCount(): number;
  advance(dt: number): void;
  draw(renderer: RiveRenderer): void;
  delete?(): void;
}

interface RiveStateMachine {
  inputCount(): number;
  input(index: number): RiveSMIInput | null;
  advance(dt: number): boolean;
  delete?(): void;
}

interface RiveSMIInput {
  name: string;
  type: number;
  asBool(): { value: boolean };
  asNumber(): { value: number };
  asTrigger(): { fire(): void };
}

interface RiveRenderer {
  clear(): void;
  save(): void;
  restore(): void;
  align(fit: unknown, alignment: unknown, dest: object, src: object): void;
  flush(): void;
  delete?(): void;
}

interface RiveAsset {
  name: string;
  isImage?: boolean;
  setRenderImage?(image: unknown): void;
}

type ExtendedRive = LowLevelRive & {
  Fit?: Record<string, unknown>;
  Alignment?: Record<string, unknown>;
  resolveAnimationFrame?(): void;
  CustomFileAssetLoader: new (opts: {
    loadContents: (asset: RiveAsset, bytes: Uint8Array) => boolean;
  }) => unknown;
};

export interface RivePreviewOpts {
  canvas: HTMLCanvasElement;
  rivUrl: string;
  artboardName?: string;
  /**
   * Called at the end of each RAF tick, after `renderer.flush()` and before
   * the frame is returned to the compositor. Blobling uses this to snapshot
   * the canvas via `drawImage` — WebGL's `preserveDrawingBuffer:false`
   * clears the buffer once RAF returns, so an outside-the-loop read blanks.
   */
  onAfterFrame?: () => void;
}

export interface RivePreviewHandle {
  setNumberInput(name: string, value: number): void;
  setBoolInput(name: string, value: boolean): void;
  fireTrigger(name: string): void;
  setImageAsset(assetNameLower: string, imageUrl: string): Promise<void>;
  dispose(): void;
}

/**
 * Discover a fetched `.riv` URL matching a pattern from the engine's fetch
 * interceptor history. Returns null if nothing seen yet. Consumers may
 * layer a more targeted discovery on top (e.g. current-avatar instance).
 */
export function discoverRivUrl(pattern: RegExp): string | null {
  for (const url of listSeenRivUrls()) {
    if (pattern.test(url) && url.endsWith('.riv')) return url;
  }
  return null;
}

/**
 * Create an offline Rive preview rendering into the given canvas. Fetches
 * the `.riv` bytes, loads via the low-level runtime with an inline asset
 * loader (so per-asset setRenderImage calls can swap textures), instantiates
 * artboard + state machine, and drives a RAF loop.
 *
 * Returns null on any load failure (network, decoding, no artboard, etc.).
 * Callers must call `dispose()` when the canvas is torn down.
 */
export async function createRivePreview(
  opts: RivePreviewOpts,
): Promise<RivePreviewHandle | null> {
  const rive = (await awaitRiveSingleton()) as ExtendedRive;
  if (!rive) return null;

  const fetchFn = typeof pageWindow.fetch === 'function'
    ? pageWindow.fetch.bind(pageWindow)
    : fetch;

  let bytes: Uint8Array;
  try {
    const res = await fetchFn(opts.rivUrl);
    if (!res.ok) return null;
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }

  const capturedAssets = new Map<string, RiveAsset>();

  const assetLoaderFn = (asset: RiveAsset): boolean => {
    if (asset.name && asset.isImage) {
      capturedAssets.set(asset.name.toLowerCase(), asset);
    }
    return false;
  };

  // The low-level rive.load expects a CustomFileAssetLoader instance
  // (an object with `.loadContents`), not a raw callback. Without this
  // wrap the game's engine load wrapper's FallbackFileAssetLoader chain
  // throws on `fn.loadContents(...)` and every .riv with external image
  // assets silently fails to load.
  const customAssetLoader = new rive.CustomFileAssetLoader({ loadContents: assetLoaderFn });

  let file: RiveFile;
  try {
    file = (await rive.load(bytes, customAssetLoader)) as unknown as RiveFile;
  } catch {
    return null;
  }
  if (!file) return null;

  let artboard: RiveArtboard;
  try {
    artboard = opts.artboardName
      ? (file.artboardByName(opts.artboardName) as RiveArtboard | null) ?? file.defaultArtboard()
      : file.defaultArtboard();
  } catch {
    try {
      artboard = file.artboardByIndex(0) as RiveArtboard;
    } catch {
      return null;
    }
  }
  if (!artboard) return null;

  let stateMachine: RiveStateMachine | null = null;
  try {
    const smDef = artboard.stateMachineByIndex(0);
    if (smDef) {
      stateMachine = new (rive as unknown as {
        StateMachineInstance: new (sm: unknown, ab: unknown) => RiveStateMachine;
      }).StateMachineInstance(smDef, artboard) as RiveStateMachine;
    }
  } catch {
    // Preview still renders without a state machine; inputs become no-ops.
  }

  let renderer: RiveRenderer | null;
  try {
    renderer = rive.makeRenderer(opts.canvas) as unknown as RiveRenderer;
  } catch {
    return null;
  }
  if (!renderer) return null;

  let disposed = false;
  let animFrameId = 0;
  let lastTimeMs = 0;

  const fit = rive.Fit?.contain ?? rive.Fit?.Contain ?? 1;
  const alignment = rive.Alignment?.center ?? rive.Alignment?.Center ?? { x: 0.5, y: 0.5 };

  function renderFrame(timeMs: number): void {
    if (disposed || !renderer || !artboard) return;
    const elapsed = lastTimeMs === 0 ? 0 : Math.min((timeMs - lastTimeMs) / 1000, 0.1);
    lastTimeMs = timeMs;
    if (stateMachine) {
      try { stateMachine.advance(elapsed); } catch { /* */ }
    }
    try { artboard.advance(elapsed); } catch { /* */ }
    try {
      renderer.clear();
      renderer.save();
      renderer.align(
        fit,
        alignment,
        { minX: 0, minY: 0, maxX: opts.canvas.width, maxY: opts.canvas.height },
        artboard.bounds ?? { minX: 0, minY: 0, maxX: artboard.width, maxY: artboard.height },
      );
      artboard.draw(renderer);
      renderer.restore();
      renderer.flush();
    } catch { /* */ }
    if (opts.onAfterFrame) {
      try { opts.onAfterFrame(); } catch { /* */ }
    }
    try { rive.resolveAnimationFrame?.(); } catch { /* */ }
    animFrameId = requestAnimationFrame(renderFrame);
  }
  animFrameId = requestAnimationFrame(renderFrame);

  function findInput(name: string): RiveSMIInput | null {
    if (!stateMachine) return null;
    const count = stateMachine.inputCount();
    for (let i = 0; i < count; i++) {
      const inp = stateMachine.input(i);
      if (inp && inp.name === name) return inp;
    }
    return null;
  }

  async function setImageAsset(assetName: string, imageUrl: string): Promise<void> {
    const asset = capturedAssets.get(assetName.toLowerCase());
    if (!asset?.setRenderImage) return;
    try {
      const res = await fetchFn(imageUrl);
      if (!res.ok) return;
      const imgBytes = new Uint8Array(await res.arrayBuffer());
      await new Promise<void>((resolve) => {
        rive.decodeImage(imgBytes, (riveImage) => {
          if (riveImage && asset.setRenderImage) {
            asset.setRenderImage(riveImage);
            riveImage.unref();
          }
          resolve();
        });
      });
    } catch { /* swallow — preview asset load is best-effort */ }
  }

  return {
    setNumberInput(name, value) {
      if (disposed) return;
      const input = findInput(name);
      if (!input) return;
      try { input.asNumber().value = value; } catch { /* */ }
    },
    setBoolInput(name, value) {
      if (disposed) return;
      const input = findInput(name);
      if (!input) return;
      try { input.asBool().value = value; } catch { /* */ }
    },
    fireTrigger(name) {
      if (disposed) return;
      const input = findInput(name);
      if (!input) return;
      try { input.asTrigger().fire(); } catch { /* */ }
    },
    setImageAsset,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      try { stateMachine?.delete?.(); } catch { /* */ }
      try { artboard?.delete?.(); } catch { /* */ }
      try { renderer?.delete?.(); } catch { /* */ }
      try { (file as { delete?(): void })?.delete?.(); } catch { /* */ }
      capturedAssets.clear();
    },
  };
}
