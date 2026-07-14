import {
  awaitRiveSingleton,
  setImageOverride,
  setInputOverride,
  findAvatarInstanceByPlayerId,
} from '../../rive-engine';
import { listSeenRivUrls } from '../../rive-engine/fetchInterceptor';
import type { LowLevelRive } from '../../rive-engine';
import { readAtomValueSync } from '../../core/atomRegistry';
import { pageWindow } from '../../core/pageContext';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { getCosmeticCdnUrl } from './cosmeticApi';
import { SLOT_CONFIG, type SlotType, type CosmeticColor } from './types';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:bloblingCustomiser';
const FEATURE_NAME = 'bloblingCustomiser';
const previewLog = createNamedLogger(FEATURE_SUBSYSTEM);

function warnBlobling(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  previewLog.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

// Rive state machine expression index — order must match the artboard's
// expression input (sourced from avatarRiveConstants.ts in game source).
const EXPRESSION_FILENAMES: readonly string[] = [
  'Expression_Default.png', 'Expression_Alarmed.png', 'Expression_Annoyed.png',
  'Expression_Bashful.png', 'Expression_Calm3.png', 'Expression_Crying.png',
  'Expression_Cute.png', 'Expression_Derpy.png', 'Expression_Happy.png',
  'Expression_Mad.png', 'Expression_Pouty.png', 'Expression_Shocked.png',
  'Expression_Thinking.png', 'Expression_Tired.png', 'Expression_Loopy.png',
  'Expression_SoHappy.png', 'Expression_Vampire.png', 'Expression_Stressed.png',
];

// ── Custom-skins bridge ──────────────────────────────────────────────────
// customSkins/index.ts is the producer (calls notifyPreviewCustomChange to
// push a slot's bytes into the preview). avatarPreview is the consumer —
// it registers its own pusher implementation when createPreviewAvatar runs,
// using setRenderImage on the capturedAssets map. Decoupled so customSkins
// has no compile-time dependency on the preview's internal capturedAssets.

type PreviewPusher = (slot: SlotType, dataUrl: string | null) => void;
let previewPusher: PreviewPusher | null = null;

/** Register or clear the preview's slot pusher. Called from createPreviewAvatar. */
export function setPreviewPusher(fn: PreviewPusher | null): void {
  previewPusher = fn;
}

/** Producer-side: customSkins calls this when an active skin changes. */
export function notifyPreviewCustomChange(slot: SlotType, dataUrl: string | null): void {
  previewPusher?.(slot, dataUrl);
}

// ── Frame-capture bridge ─────────────────────────────────────────────────
// The Rive renderer uses WebGL with preserveDrawingBuffer:false, so
// drawImage(canvas) from outside the render loop returns a blank frame.
// We expose a hook that resolves with ImageData on the next render frame.
// Used by calibration tooling to read which canvas regions map where.

let nextFrameCapture: ((data: ImageData | null) => void) | null = null;

export function captureNextPreviewFrame(): Promise<ImageData | null> {
  if (nextFrameCapture) {
    // Coalesce — only one capture pending at a time. Reject the prior.
    nextFrameCapture(null);
  }
  return new Promise<ImageData | null>((resolve) => {
    nextFrameCapture = resolve;
  });
}

export interface PreviewHandle {
  applySlot(slot: SlotType, filename: string | null): void;
  applyColor(color: CosmeticColor): void;
  fireEmote(trigger: string): void;
  /**
   * Optional injected getter so the custom-skins bridge can revert to the
   * currently-equipped cosmetic when a custom is cleared. Resolved lazily
   * at push time so a mid-session carousel change is honoured.
   */
  __getCurrentSlot?: (slot: SlotType) => string | null;
  dispose(): void;
}

function getLocalPlayerId(): string | null {
  try {
    const player = readAtomValueSync('player');
    if (!player) return null;
    const rec = player as Record<string, unknown>;
    for (const field of ['id', 'playerId', 'userId']) {
      const v = rec[field];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
  } catch { /* */ }
  return null;
}

// Game v710 changed inst.raw.riveFileSrc from a full URL to a bare cache key
// (e.g. "quinoa-rive/avatar"). Fetching that resolves to the SPA fallback HTML,
// which rive.load silently rejects — canvas stays blank. Only accept values
// that look like a real .riv URL/path.
function isRivUrl(value: unknown): value is string {
  return typeof value === 'string' && value.endsWith('.riv');
}

function discoverAvatarRivUrl(): string | null {
  const playerId = getLocalPlayerId();
  let instFound = false;
  if (playerId) {
    const inst = findAvatarInstanceByPlayerId(playerId);
    if (inst) {
      instFound = true;
      const raw = inst.raw as Record<string, unknown>;
      if (isRivUrl(raw.riveFileSrc)) return raw.riveFileSrc;
      for (const key of Object.getOwnPropertyNames(raw)) {
        try {
          const val = raw[key];
          if (isRivUrl(val)) return val;
        } catch { /* skip */ }
      }
    }
  }

  const urls = listSeenRivUrls();
  const avatarUrl = urls.find(u => /avatar/i.test(u) && u.endsWith('.riv'));
  if (avatarUrl) return avatarUrl;

  warnBlobling('QPM-BLOBLING-001', {
    hasPlayerId: playerId !== null,
    instFound,
    seenCount: urls.length,
  });
  return null;
}

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

export async function createPreviewAvatar(canvas: HTMLCanvasElement): Promise<PreviewHandle | null> {
  const rive = await awaitRiveSingleton() as LowLevelRive & {
    Fit?: Record<string, unknown>;
    Alignment?: Record<string, unknown>;
    resolveAnimationFrame?(): void;
    CustomFileAssetLoader: new (opts: {
      loadContents: (asset: RiveAsset, bytes: Uint8Array) => boolean;
    }) => unknown;
  };
  if (!rive) {
    warnBlobling('QPM-BLOBLING-003', { what: 'rive:runtime_missing' });
    return null;
  }

  const rivUrl = discoverAvatarRivUrl();
  if (!rivUrl) return null;

  const fetchFn = typeof pageWindow.fetch === 'function'
    ? pageWindow.fetch.bind(pageWindow)
    : fetch;

  let bytes: Uint8Array;
  try {
    const res = await fetchFn(rivUrl);
    if (!res.ok) {
      warnBlobling('QPM-BLOBLING-002', { what: 'fetch:response', status: res.status });
      return null;
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    warnBlobling('QPM-BLOBLING-002', { what: 'fetch:exception' }, e);
    return null;
  }

  const capturedAssets = new Map<string, RiveAsset>();

  const assetLoaderFn = (asset: RiveAsset, _bytes: Uint8Array): boolean => {
    if (asset.name && asset.isImage) {
      capturedAssets.set(asset.name.toLowerCase(), asset);
    }
    return false;
  };

  // The low-level rive.load expects a CustomFileAssetLoader instance
  // (an object with `.loadContents`), not a raw callback. Without this
  // wrap, the QPM load-wrapper added the raw fn to its FallbackFileAssetLoader
  // chain and the native Fallback.loadContents threw on `fn.loadContents(...)`,
  // silently killing every load of a .riv with external image assets —
  // including avatarelements.riv (the file this preview uses).
  const customAssetLoader = new rive.CustomFileAssetLoader({ loadContents: assetLoaderFn });

  let file: RiveFile;
  try {
    file = await rive.load(bytes, customAssetLoader) as unknown as RiveFile;
  } catch (e) {
    warnBlobling('QPM-BLOBLING-003', { what: 'rive:load_exception' }, e);
    return null;
  }

  if (!file) {
    warnBlobling('QPM-BLOBLING-003', { what: 'rive:load_null' });
    return null;
  }

  let artboard: RiveArtboard;
  try {
    artboard = file.defaultArtboard();
  } catch (defaultErr) {
    try {
      artboard = file.artboardByIndex(0) as RiveArtboard;
    } catch (e) {
      warnBlobling('QPM-BLOBLING-003', { what: 'artboard:by_index', defaultErr: String(defaultErr) }, e);
      return null;
    }
  }

  if (!artboard) {
    warnBlobling('QPM-BLOBLING-003', { what: 'artboard:missing' });
    return null;
  }

  let stateMachine: RiveStateMachine | null = null;
  try {
    const smDef = artboard.stateMachineByIndex(0);
    if (smDef) {
      stateMachine = new (rive as unknown as {
        StateMachineInstance: new (sm: unknown, ab: unknown) => RiveStateMachine;
      }).StateMachineInstance(smDef, artboard) as RiveStateMachine;
    }
  } catch (e) {
    warnBlobling('QPM-BLOBLING-003', { what: 'statemachine:create' }, e);
  }

  let renderer: RiveRenderer | null = null;
  try {
    renderer = rive.makeRenderer(canvas) as unknown as RiveRenderer;
  } catch (e) {
    warnBlobling('QPM-BLOBLING-003', { what: 'renderer:make' }, e);
    return null;
  }

  if (!renderer) {
    warnBlobling('QPM-BLOBLING-003', { what: 'renderer:null' });
    return null;
  }

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
        { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height },
        artboard.bounds ?? { minX: 0, minY: 0, maxX: artboard.width, maxY: artboard.height },
      );
      artboard.draw(renderer);
      renderer.restore();
      renderer.flush();
    } catch { /* */ }

    // Frame-capture hook — must run AFTER flush and BEFORE the next RAF
    // returns control to the compositor (which would clear the WebGL
    // framebuffer). drawImage from a WebGL canvas to a 2D canvas works
    // synchronously here because the buffer is still alive in this tick.
    if (nextFrameCapture) {
      const cb = nextFrameCapture;
      nextFrameCapture = null;
      try {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width;
        tmp.height = canvas.height;
        const tmpCtx = tmp.getContext('2d')!;
        tmpCtx.drawImage(canvas, 0, 0);
        cb(tmpCtx.getImageData(0, 0, canvas.width, canvas.height));
      } catch {
        cb(null);
      }
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

  async function setImageOnAsset(assetName: string, imageUrl: string): Promise<void> {
    const asset = capturedAssets.get(assetName.toLowerCase());
    if (!asset?.setRenderImage) {
      warnBlobling('QPM-BLOBLING-004', { what: 'asset:missing', assetName });
      return;
    }

    try {
      const res = await fetchFn(imageUrl);
      if (!res.ok) {
        warnBlobling('QPM-BLOBLING-004', { what: 'image:fetch_response', assetName, status: res.status });
        return;
      }
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
    } catch (e) {
      warnBlobling('QPM-BLOBLING-004', { what: 'image:fetch_exception', assetName }, e);
    }
  }

  const handle: PreviewHandle = {
    applySlot(slot: SlotType, filename: string | null): void {
      if (disposed || !filename) return;
      const cfg = SLOT_CONFIG.find(c => c.type === slot);
      if (!cfg) return;

      if (cfg.type === 'Expression') {
        const input = findInput('expression');
        if (input) {
          try {
            const idx = EXPRESSION_FILENAMES.indexOf(filename);
            input.asNumber().value = idx >= 0 ? idx : 0;
          } catch { /* */ }
        }
        return;
      }

      const imageUrl = getCosmeticCdnUrl(filename);
      void setImageOnAsset(cfg.riveProperty, imageUrl);
    },

    applyColor(color: CosmeticColor): void {
      if (disposed) return;
      const input = findInput('color');
      if (!input) return;
      const colorIndex = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'White', 'Black'].indexOf(color);
      if (colorIndex >= 0) {
        try { input.asNumber().value = colorIndex; } catch { /* */ }
      }
    },

    fireEmote(trigger: string): void {
      if (disposed) return;
      const input = findInput('emoteType');
      if (!input) return;
      const val = parseInt(trigger, 10);
      if (isNaN(val)) return;
      try { input.asNumber().value = val; } catch { /* */ }
      setTimeout(() => {
        if (!disposed) {
          try { input.asNumber().value = -1; } catch { /* */ }
        }
      }, 2500);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      setPreviewPusher(null);
      if (animFrameId) cancelAnimationFrame(animFrameId);
      try { stateMachine?.delete?.(); } catch { /* */ }
      try { artboard?.delete?.(); } catch { /* */ }
      try { renderer?.delete?.(); } catch { /* */ }
      try { (file as { delete?(): void })?.delete?.(); } catch { /* */ }
      capturedAssets.clear();
      previewLog.debug('Preview avatar disposed');
    },
  };

  // Hook customSkins into this preview's setRenderImage path. When a custom
  // skin becomes active for a cosmetic, customSkins calls
  // notifyPreviewCustomChange(slot, dataUrl) and the closure below applies
  // it via the existing setImageOnAsset path. dataUrl=null reverts to the
  // currently-equipped cosmetic via the injected __getCurrentSlot getter.
  const cfgByType = new Map(SLOT_CONFIG.map(c => [c.type, c]));
  setPreviewPusher((slot, dataUrl) => {
    if (disposed) return;
    const cfg = cfgByType.get(slot);
    if (!cfg) return;
    if (dataUrl) {
      void setImageOnAsset(cfg.riveProperty, dataUrl);
    } else {
      const getter = handle.__getCurrentSlot;
      const equipped = getter?.(slot) ?? null;
      if (equipped) void setImageOnAsset(cfg.riveProperty, getCosmeticCdnUrl(equipped));
    }
  });

  return handle;
}

function getEquippedFilename(avatarIndex: number): string | null {
  try {
    const player = readAtomValueSync('player');
    const cosmetic = (player as { cosmetic?: { avatar?: readonly string[] } } | undefined)?.cosmetic;
    const f = cosmetic?.avatar?.[avatarIndex];
    return typeof f === 'string' && f.length > 0 ? f : null;
  } catch {
    return null;
  }
}

export function startInWorldPreview(
  slots: Record<SlotType, string | null>,
  color: CosmeticColor,
  onTick: (remainingSeconds: number) => void,
  onEnd: () => void,
): () => void {
  const playerId = getLocalPlayerId();
  if (!playerId) {
    onEnd();
    return () => {};
  }

  const inst = findAvatarInstanceByPlayerId(playerId);
  if (!inst) {
    previewLog.debug('In-world preview: no avatar instance');
    onEnd();
    return () => {};
  }

  const overrideCleanups: Array<() => void> = [];

  for (const cfg of SLOT_CONFIG) {
    const filename = slots[cfg.type];
    if (!filename) continue;

    if (cfg.type === 'Expression') {
      const exprIndex = EXPRESSION_FILENAMES.indexOf(filename);
      if (exprIndex < 0) continue;
      // The input override snapshots the pre-override value on apply and
      // writes it back on cleanup — no caller-side restore needed.
      const cleanup = setInputOverride({
        target: { type: 'instance', id: inst.id },
        input: 'expression',
        value: exprIndex,
        pin: true,
      });
      overrideCleanups.push(cleanup);
      continue;
    }

    const url = getCosmeticCdnUrl(filename);
    const avatarIndex = cfg.avatarIndex;
    const cleanup = setImageOverride({
      target: { type: 'instance', id: inst.id },
      property: cfg.riveProperty,
      image: url,
      // Resolved lazily at cleanup so a mid-preview equip is honoured.
      restoreOnCleanup: () => {
        const equipped = getEquippedFilename(avatarIndex);
        return equipped ? getCosmeticCdnUrl(equipped) : null;
      },
    });
    overrideCleanups.push(cleanup);
  }

  const PREVIEW_DURATION_SEC = 60;
  const endTime = Date.now() + PREVIEW_DURATION_SEC * 1000;
  let cancelled = false;

  onTick(PREVIEW_DURATION_SEC);

  // visibleInterval (rather than raw setInterval) per architecture rule. We
  // derive remaining from wall clock so a missed tick (background tab) still
  // reverts on schedule once the tab returns.
  const stopInterval = visibleInterval('blobling-preview-countdown', () => {
    if (cancelled) return;
    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    onTick(remaining);
    if (remaining <= 0) revert();
  }, 1000);

  function revert(): void {
    if (cancelled) return;
    cancelled = true;
    stopInterval();
    for (const fn of overrideCleanups) { try { fn(); } catch { /* */ } }
    overrideCleanups.length = 0;
    onEnd();
  }

  return revert;
}
