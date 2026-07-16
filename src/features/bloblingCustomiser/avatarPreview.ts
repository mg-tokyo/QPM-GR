import {
  setImageOverride,
  setInputOverride,
  findAvatarInstanceByPlayerId,
} from '../../rive-engine';
import { listSeenRivUrls } from '../../rive-engine/fetchInterceptor';
import { readAtomValueSync } from '../../core/atomRegistry';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { getCosmeticCdnUrl } from './cosmeticApi';
import { SLOT_CONFIG, type SlotType, type CosmeticColor } from './types';
import { createRivePreview, type RivePreviewHandle } from './previewCore';

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
// it registers its own pusher implementation when createPreviewAvatar runs.

type PreviewPusher = (slot: SlotType, dataUrl: string | null) => void;
let previewPusher: PreviewPusher | null = null;

export function setPreviewPusher(fn: PreviewPusher | null): void {
  previewPusher = fn;
}

export function notifyPreviewCustomChange(slot: SlotType, dataUrl: string | null): void {
  previewPusher?.(slot, dataUrl);
}

// ── Frame-capture bridge ─────────────────────────────────────────────────
// The Rive renderer uses WebGL with preserveDrawingBuffer:false, so
// drawImage(canvas) from outside the render loop returns a blank frame.
// createPreviewAvatar registers an onAfterFrame hook via previewCore that
// resolves the pending capture inside the render loop.

let nextFrameCapture: ((data: ImageData | null) => void) | null = null;

export function captureNextPreviewFrame(): Promise<ImageData | null> {
  if (nextFrameCapture) {
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
  const avatarUrl = urls.find((u) => /avatar/i.test(u) && u.endsWith('.riv'));
  if (avatarUrl) return avatarUrl;

  warnBlobling('QPM-BLOBLING-001', {
    hasPlayerId: playerId !== null,
    instFound,
    seenCount: urls.length,
  });
  return null;
}

export async function createPreviewAvatar(canvas: HTMLCanvasElement): Promise<PreviewHandle | null> {
  const rivUrl = discoverAvatarRivUrl();
  if (!rivUrl) return null;

  const onAfterFrame = (): void => {
    if (!nextFrameCapture) return;
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
  };

  let corePreview: RivePreviewHandle | null;
  try {
    corePreview = await createRivePreview({ canvas, rivUrl, onAfterFrame });
  } catch (e) {
    warnBlobling('QPM-BLOBLING-003', { what: 'rive:load_exception' }, e);
    return null;
  }
  if (!corePreview) {
    warnBlobling('QPM-BLOBLING-003', { what: 'rive:preview_null' });
    return null;
  }

  let disposed = false;
  const cfgByType = new Map(SLOT_CONFIG.map((c) => [c.type, c]));

  const handle: PreviewHandle = {
    applySlot(slot: SlotType, filename: string | null): void {
      if (disposed || !filename) return;
      const cfg = cfgByType.get(slot);
      if (!cfg) return;

      if (cfg.type === 'Expression') {
        const idx = EXPRESSION_FILENAMES.indexOf(filename);
        corePreview!.setNumberInput('expression', idx >= 0 ? idx : 0);
        return;
      }

      const imageUrl = getCosmeticCdnUrl(filename);
      void corePreview!.setImageAsset(cfg.riveProperty, imageUrl);
    },

    applyColor(color: CosmeticColor): void {
      if (disposed) return;
      const colorIndex = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'White', 'Black'].indexOf(color);
      if (colorIndex >= 0) {
        corePreview!.setNumberInput('color', colorIndex);
      }
    },

    fireEmote(trigger: string): void {
      if (disposed) return;
      const val = parseInt(trigger, 10);
      if (isNaN(val)) return;
      corePreview!.setNumberInput('emoteType', val);
      setTimeout(() => {
        if (!disposed) corePreview!.setNumberInput('emoteType', -1);
      }, 2500);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      setPreviewPusher(null);
      corePreview!.dispose();
      previewLog.debug('Preview avatar disposed');
    },
  };

  // Hook customSkins into this preview's setRenderImage path. When a custom
  // skin becomes active for a cosmetic, customSkins calls
  // notifyPreviewCustomChange(slot, dataUrl) and the closure below applies
  // it via the core's setImageAsset. dataUrl=null reverts to the
  // currently-equipped cosmetic via the injected __getCurrentSlot getter.
  setPreviewPusher((slot, dataUrl) => {
    if (disposed) return;
    const cfg = cfgByType.get(slot);
    if (!cfg) return;
    if (dataUrl) {
      void corePreview!.setImageAsset(cfg.riveProperty, dataUrl);
    } else {
      const getter = handle.__getCurrentSlot;
      const equipped = getter?.(slot) ?? null;
      if (equipped) void corePreview!.setImageAsset(cfg.riveProperty, getCosmeticCdnUrl(equipped));
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
      restoreOnCleanup: () => {
        const equipped = getEquippedFilename(avatarIndex);
        return equipped ? getCosmeticCdnUrl(equipped) : null;
      },
    });
    overrideCleanups.push(cleanup);
  }

  // Color: the game avatar exposes color as an image slot (unlike the offline
  // preview which uses a number input). Skipped in in-world preview for now.
  void color;

  const PREVIEW_DURATION_SEC = 60;
  const endTime = Date.now() + PREVIEW_DURATION_SEC * 1000;
  let cancelled = false;

  onTick(PREVIEW_DURATION_SEC);

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
    for (const fn of overrideCleanups) {
      try { fn(); } catch { /* */ }
    }
    overrideCleanups.length = 0;
    onEnd();
  }

  return revert;
}
