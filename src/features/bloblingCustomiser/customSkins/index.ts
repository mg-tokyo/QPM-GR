import { notify } from '../../../core/notifications';
import { setImageOverride, findAvatarInstanceByPlayerId } from '../../../rive-engine';
import { readAtomValueSync } from '../../../core/atomRegistry';
import { shareGlobal } from '../../../core/pageContext';
import {
  type CustomSkin,
  type CustomSkinsState,
  findActiveSkin,
} from './types';
import { getInMemoryState, mutate } from './store';
import { initCustomSkinsInterceptor } from './interceptor';
import { SLOT_CONFIG, type SlotType } from '../types';
import { getCosmeticCdnUrl } from '../cosmeticApi';
import { notifyPreviewCustomChange, captureNextPreviewFrame } from '../avatarPreview';

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 512 * 1024;             // 512KB per skin (matches textureSwapper)
const COMPRESS_LONGEST_PX = 256;                 // compress overruns to 256px longest edge
const TOTAL_LIBRARY_CAP_BYTES = 4 * 1024 * 1024; // 4MB total, leaves headroom under 5-10MB localStorage caps

// ── ID generation ──────────────────────────────────────────────────────────

function generateSkinId(): string {
  return `skin_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Upload pipeline helpers ────────────────────────────────────────────────

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string ?? '');
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Fetch the vanilla cosmetic PNG via XMLHttpRequest. Critical: this bypasses
 * our own fetch interceptor (which only wraps `pageWindow.fetch`), so we
 * always get the pristine bytes regardless of whether a custom is currently
 * active for that cosmetic.
 */
async function fetchVanillaCosmeticDataUrl(cosmeticFilename: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', getCosmeticCdnUrl(cosmeticFilename), true);
      xhr.responseType = 'blob';
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(xhr.response);
        } else {
          resolve(null);
        }
      };
      xhr.onerror = () => resolve(null);
      xhr.ontimeout = () => resolve(null);
      xhr.timeout = 15000;
      xhr.send();
    } catch {
      resolve(null);
    }
  });
}

async function loadDataUrlAsImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Mask a user-uploaded file against the original cosmetic's alpha channel,
 * producing a new File whose pixels are zero anywhere the original cosmetic
 * was transparent. Returns null if the original cannot be fetched (CORS,
 * 404, network); caller should fall back to the unmasked file.
 *
 * Output dimensions match the ORIGINAL cosmetic (not the user upload) — so
 * a 640×640 cosmetic always produces a 640×640 result regardless of what the
 * user uploaded. This keeps cosmetic↔custom dimensions consistent.
 */
async function maskFileToCosmeticAlpha(
  file: File,
  cosmeticFilename: string,
): Promise<File | null> {
  const vanillaDataUrl = await fetchVanillaCosmeticDataUrl(cosmeticFilename);
  if (!vanillaDataUrl) return null;

  const customDataUrl = await readFileAsDataUrl(file);
  const [origImg, customImg] = await Promise.all([
    loadDataUrlAsImage(vanillaDataUrl),
    loadDataUrlAsImage(customDataUrl),
  ]);
  if (!origImg || !customImg) return null;

  const w = origImg.naturalWidth || 640;
  const h = origImg.naturalHeight || 640;

  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    // Draw the user's image scaled to the cosmetic's dimensions
    ctx.drawImage(customImg, 0, 0, w, h);
    // Keep pixels only where the ORIGINAL has non-zero alpha
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(origImg, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) return null;
    return new File([blob], file.name, { type: 'image/png' });
  } catch {
    return null;
  }
}

async function loadFileAsImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/**
 * Compress an oversize image to webp@0.9 at COMPRESS_LONGEST_PX longest edge.
 * Same algorithm as `textureSwapper/index.ts:266-285`. Returns the compressed
 * dataUrl + the final dimensions. Falls back to PNG if webp encode fails.
 */
async function compressImage(file: File): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const img = await loadFileAsImage(file);
  if (!img) return null;
  const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
  const scale = Math.min(1, COMPRESS_LONGEST_PX / longest);
  const targetW = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const targetH = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.clearRect(0, 0, targetW, targetH);
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.imageSmoothingQuality = 'high';
  ctx2d.drawImage(img, 0, 0, targetW, targetH);
  const webp = canvas.toDataURL('image/webp', 0.9);
  const dataUrl = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  return { dataUrl, width: targetW, height: targetH };
}

async function sniffDataUrlDims(dataUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function projectedStateSize(state: CustomSkinsState): number {
  try {
    return JSON.stringify(state).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

let interceptorCleanup: (() => void) | null = null;

export function initCustomSkins(): () => void {
  if (interceptorCleanup) return () => {};
  interceptorCleanup = initCustomSkinsInterceptor();

  // Expose a console debug surface for calibration tooling. Read-only-ish
  // (no setup costs), so it's always available regardless of debug flags.
  try {
    shareGlobal('__QPM_CUSTOM_SKINS__', {
      setActive: setActiveCustomSkin,
      clear: clearActiveCustomSkin,
      replace: replaceActiveCustomSkin,
      add: addCustomSkin,
      remove: removeCustomSkin,
      list: listCustomSkins,
      getActive: getActiveCustomSkin,
      state: getCustomSkinsState,
      equipped: () => {
        try {
          const player = readAtomValueSync('player');
          const avatar = (player as { cosmetic?: { avatar?: readonly string[] } } | undefined)
            ?.cosmetic?.avatar;
          if (!avatar) return null;
          return { Bottom: avatar[0] ?? null, Mid: avatar[1] ?? null, Top: avatar[2] ?? null, Expression: avatar[3] ?? null };
        } catch { return null; }
      },
      // Capture the next rendered frame of the customiser preview canvas as
      // ImageData. Resolves after the next render tick. Used by calibration.
      captureNextPreviewFrame,
      // Trim-to-shape toggle (Level 2 mask gating).
      getTrimToShape,
      setTrimToShape,
      // Download the vanilla cosmetic PNG as a template (Level 1).
      downloadTemplate: downloadCosmeticTemplate,
    });
  } catch { /* shareGlobal optional — non-fatal */ }

  return () => {
    if (interceptorCleanup) {
      interceptorCleanup();
      interceptorCleanup = null;
    }
  };
}

/**
 * Add a new skin to a cosmetic's library. Validates image, compresses if
 * oversize, persists, and broadcasts. Does NOT set it active — caller is
 * responsible for that step (see setActiveCustomSkin / replaceActiveCustomSkin).
 */
export async function addCustomSkin(
  cosmeticFilename: string,
  file: File,
  name?: string,
): Promise<CustomSkin | null> {
  if (!file.type.startsWith('image/')) {
    notify({ feature: 'bloblingCustomSkins', level: 'error', message: 'Drop an image file' });
    return null;
  }

  let dataUrl: string;
  let width = 0;
  let height = 0;

  if (file.size > MAX_UPLOAD_BYTES) {
    const compressed = await compressImage(file);
    if (!compressed) {
      notify({ feature: 'bloblingCustomSkins', level: 'error', message: 'Custom skin upload failed (image decode)' });
      return null;
    }
    dataUrl = compressed.dataUrl;
    width = compressed.width;
    height = compressed.height;
  } else {
    dataUrl = await readFileAsDataUrl(file);
    const dims = await sniffDataUrlDims(dataUrl);
    if (!dims) {
      notify({ feature: 'bloblingCustomSkins', level: 'error', message: 'Custom skin upload failed (image decode)' });
      return null;
    }
    width = dims.width;
    height = dims.height;
  }

  const skin: CustomSkin = {
    id: generateSkinId(),
    name: name ?? (file.name.replace(/\.[a-zA-Z0-9]+$/, '') || 'Custom'),
    dataUrl,
    width,
    height,
    createdAt: Date.now(),
  };

  // Total-quota guard. Spec §5 row "Total qpm.bloblingCustomSkins.v1 blob exceeds GM quota".
  const currentState = getInMemoryState();
  const projected: CustomSkinsState = {
    ...currentState,
    library: {
      ...currentState.library,
      [cosmeticFilename]: [...(currentState.library[cosmeticFilename] ?? []), skin],
    },
  };
  if (projectedStateSize(projected) > TOTAL_LIBRARY_CAP_BYTES) {
    notify({ feature: 'bloblingCustomSkins', level: 'error', message: 'Custom skin library is full — remove some customs first' });
    return null;
  }

  const ok = mutate(prior => ({
    ...prior,
    library: {
      ...prior.library,
      [cosmeticFilename]: [...(prior.library[cosmeticFilename] ?? []), skin],
    },
  }));
  if (!ok) {
    notify({ feature: 'bloblingCustomSkins', level: 'error', message: 'Custom skin failed to save (storage full?)' });
    return null;
  }
  return skin;
}

export function removeCustomSkin(cosmeticFilename: string, skinId: string): void {
  mutate(prior => {
    const list = prior.library[cosmeticFilename] ?? [];
    const nextList = list.filter(s => s.id !== skinId);
    const nextLibrary = { ...prior.library };
    if (nextList.length === 0) delete nextLibrary[cosmeticFilename];
    else nextLibrary[cosmeticFilename] = nextList;
    // If the removed entry was active, null the active pointer.
    const nextActive = { ...prior.active };
    if (prior.active[cosmeticFilename] === skinId) {
      nextActive[cosmeticFilename] = null;
    }
    return { ...prior, library: nextLibrary, active: nextActive };
  });
}

export function listCustomSkins(cosmeticFilename: string): CustomSkin[] {
  return [...(getInMemoryState().library[cosmeticFilename] ?? [])];
}

// ── Hybrid push paths (spec §2.5) ─────────────────────────────────────────

interface InWorldEntry { cleanup: () => void; }
const inWorldCleanups = new Map<string, InWorldEntry>();

function getLocalPlayerId(): string | null {
  try {
    const player = readAtomValueSync('player');
    if (!player) return null;
    const rec = player as Record<string, unknown>;
    for (const field of ['id', 'playerId', 'userId']) {
      const v = rec[field];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
  } catch { /* atom unreadable — caller skips push */ }
  return null;
}

function slotFromFilename(filename: string): SlotType | null {
  // Same convention as the (now-deprecated) textureSwapper/rive.ts SLOT_PREFIX_RE.
  const m = filename.match(/^(Bottom|Mid|Top|Expression)_/);
  return m ? (m[1] as SlotType) : null;
}

function pushInWorld(cosmeticFilename: string, dataUrl: string | null): void {
  const slot = slotFromFilename(cosmeticFilename);
  if (!slot) return;
  const cfg = SLOT_CONFIG.find(c => c.type === slot);
  if (!cfg) return;

  // Drop any prior in-world override on this cosmetic so we don't leak.
  const prior = inWorldCleanups.get(cosmeticFilename);
  if (prior) {
    try { prior.cleanup(); } catch { /* */ }
    inWorldCleanups.delete(cosmeticFilename);
  }

  const playerId = getLocalPlayerId();
  if (!playerId) return;
  const inst = findAvatarInstanceByPlayerId(playerId);
  if (!inst) return;

  const url = dataUrl ?? getCosmeticCdnUrl(cosmeticFilename);
  const cleanup = setImageOverride({
    target: { type: 'instance', id: inst.id },
    property: cfg.riveProperty,
    image: url,
  });
  if (dataUrl) {
    inWorldCleanups.set(cosmeticFilename, { cleanup });
  }
}

function pushPreview(cosmeticFilename: string, dataUrl: string | null): void {
  const slot = slotFromFilename(cosmeticFilename);
  if (!slot) return;
  notifyPreviewCustomChange(slot, dataUrl);
}

// ──────────────────────────────────────────────────────────────────────────

export function setActiveCustomSkin(cosmeticFilename: string, skinId: string | null): void {
  mutate(prior => ({
    ...prior,
    active: { ...prior.active, [cosmeticFilename]: skinId },
  }));
  // After state flip, push to both surfaces. Both push paths gracefully
  // no-op when their surface isn't currently rendering.
  const skin = findActiveSkin(getInMemoryState(), cosmeticFilename);
  const dataUrl = skin?.dataUrl ?? null;
  pushInWorld(cosmeticFilename, dataUrl);
  pushPreview(cosmeticFilename, dataUrl);
}

export function getActiveCustomSkin(cosmeticFilename: string): CustomSkin | null {
  return findActiveSkin(getInMemoryState(), cosmeticFilename);
}

export function getCustomSkinsState(): CustomSkinsState {
  return getInMemoryState();
}

/**
 * Atomically replace whatever skin is active for a cosmetic with a freshly
 * uploaded one. Spec §2.3 — prevents unbounded library growth from the v1
 * "upload replaces active" UX. Order: add new → flip active to new → delete
 * the previously-active entry (if any). The new skin is reachable at every
 * step; failure mid-flow leaves the library in a usable state.
 */
export async function replaceActiveCustomSkin(
  cosmeticFilename: string,
  file: File,
  name?: string,
): Promise<CustomSkin | null> {
  const priorActiveId = getInMemoryState().active[cosmeticFilename] ?? null;

  // Trim-to-shape: if the toggle is on, mask the upload to the cosmetic's
  // alpha BEFORE addCustomSkin runs its compression. If masking fails
  // (vanilla fetch errors, CORS), fall back silently to the unmasked file.
  let processedFile = file;
  if (getInMemoryState().trimToShape) {
    const masked = await maskFileToCosmeticAlpha(file, cosmeticFilename);
    if (masked) processedFile = masked;
  }

  const added = await addCustomSkin(cosmeticFilename, processedFile, name);
  if (!added) return null;
  setActiveCustomSkin(cosmeticFilename, added.id);
  if (priorActiveId && priorActiveId !== added.id) {
    removeCustomSkin(cosmeticFilename, priorActiveId);
  }
  return added;
}

/**
 * V1 "remove active" UI helper. Nulls `active[filename]` AND deletes the
 * previously-active library entry. Net effect: cosmetic returns to vanilla,
 * no orphaned blob remains. Distinct from `removeCustomSkin(filename, id)`
 * which only deletes a specific library entry by id (intended for a future
 * library-management UI).
 */
export function clearActiveCustomSkin(cosmeticFilename: string): void {
  const activeId = getInMemoryState().active[cosmeticFilename] ?? null;
  setActiveCustomSkin(cosmeticFilename, null);
  if (activeId) removeCustomSkin(cosmeticFilename, activeId);
}

// ── Trim-to-shape toggle (gating Level 2 mask) ────────────────────────────

export function getTrimToShape(): boolean {
  return getInMemoryState().trimToShape;
}

export function setTrimToShape(value: boolean): void {
  mutate(prior => ({ ...prior, trimToShape: value }));
}

// ── Template download (Level 1) ───────────────────────────────────────────

/**
 * Trigger a browser download of the vanilla cosmetic PNG. Used by the
 * "↓ template" affordance — users grab the original art as a starting
 * point for their custom design. XHR bypasses our own fetch interceptor
 * so we always get pristine bytes, not whatever custom is currently active.
 */
export async function downloadCosmeticTemplate(cosmeticFilename: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', getCosmeticCdnUrl(cosmeticFilename), true);
      xhr.responseType = 'blob';
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response instanceof Blob) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(xhr.response);
          a.download = cosmeticFilename;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          resolve(true);
        } else {
          resolve(false);
        }
      };
      xhr.onerror = () => resolve(false);
      xhr.send();
    } catch {
      resolve(false);
    }
  });
}

// ── Re-exports for downstream consumers ───────────────────────────────────

export type { CustomSkin, CustomSkinsState } from './types';
export { emptyState } from './types';
export { onStateChange } from './store';
