// src/ui/cardImportWindow/importInputs.ts
//
// Portrait-source picker for the Custom Card import window. A single drop zone
// auto-detects four input modes:
//   1. File drop / click  — FileReader → data URL
//   2. Paste image data   — clipboard items, FileReader → data URL
//   3. Paste URL          — fetched via crossOrigin Image, canvas re-encode
//   4. Paste data URL     — direct, validated
//
// MIME whitelist: image/png, image/jpeg, image/gif. Size budgets mirror the
// storage layer (500 KB soft warn, 2 MB hard refuse) but are enforced at the
// import boundary so users see them before they save.

import { log } from '../../utils/logger';
import {
  PRESET_SIZE_SOFT_WARN_BYTES,
  PRESET_SIZE_HARD_LIMIT_BYTES,
} from '../../data/customCardPresets';

export type PortraitImportMode = 'export-url' | 'file' | 'data-url';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif'] as const;

export interface PortraitImportResult {
  source: PortraitImportMode;
  /** Canonical data URL — present for user-imported portraits, absent when a
   *  preset is loaded with only an external URL. */
  portraitDataUrl?: string;
  /** External image URL — set when imported via URL mode, or carried through from a built-in. */
  portraitUrl?: string;
  /** External video URL — built-ins only in Phase 2a; carried through when loaded into the editor. */
  videoUrl?: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  softWarn: boolean;
}

export interface ImportInputsHandle {
  root: HTMLElement;
  getResult: () => PortraitImportResult | null;
  setResult: (result: PortraitImportResult | null) => void;
  onChange: (cb: (result: PortraitImportResult | null, error: string | null) => void) => () => void;
  destroy: () => void;
}

export function createImportInputs(): ImportInputsHandle {
  let current: PortraitImportResult | null = null;
  const subscribers = new Set<(result: PortraitImportResult | null, error: string | null) => void>();
  const cleanups: Array<() => void> = [];

  function emit(error: string | null): void {
    subscribers.forEach((cb) => {
      try { cb(current, error); } catch { /* subscriber failure shouldn't break others */ }
    });
  }

  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  // Drop zone — single surface, auto-detects file/URL/data-url
  const dropZone = document.createElement('label');
  dropZone.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:6px;padding:24px;cursor:pointer;text-align:center;' +
    'background:rgba(0,0,0,0.3);border:1px dashed rgba(143,130,255,0.25);' +
    'border-radius:8px;color:rgba(224,224,224,0.4);font-size:11px;';
  const icon = document.createElement('div');
  icon.style.cssText = 'font-size:24px;opacity:0.45;';
  icon.textContent = '\u{1F5BC}';
  const title = document.createElement('div');
  title.textContent = 'Drop · paste · click';
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:10px;opacity:0.7;';
  sub.textContent = 'PNG / JPEG / GIF — auto-detects URL / data URL too';
  dropZone.append(icon, title, sub);

  // Hidden file input — triggered by click on the drop zone label
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = ALLOWED_MIME_TYPES.join(',');
  fileInput.style.display = 'none';
  dropZone.appendChild(fileInput);

  root.appendChild(dropZone);

  // Loaded-state thumbnail card (hidden until something loads)
  const loaded = document.createElement('div');
  loaded.style.cssText =
    'display:none;background:rgba(255,255,255,0.02);border:1px solid rgba(143,130,255,0.12);' +
    'border-radius:8px;padding:10px;gap:10px;align-items:center;';
  const thumb = document.createElement('img');
  thumb.style.cssText =
    'width:60px;height:80px;object-fit:contain;flex-shrink:0;' +
    'background:rgba(0,0,0,0.35);border-radius:8px;';
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = '×';
  clearBtn.title = 'Clear';
  clearBtn.style.cssText =
    'background:transparent;border:0;color:rgba(224,224,224,0.4);' +
    'font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0;';
  loaded.append(thumb, info, clearBtn);
  root.appendChild(loaded);

  function setLoadedState(result: PortraitImportResult | null): void {
    current = result;
    if (!result) {
      dropZone.style.display = '';
      loaded.style.display = 'none';
      return;
    }
    dropZone.style.display = 'none';
    loaded.style.display = 'flex';
    thumb.src = result.portraitDataUrl ?? result.portraitUrl ?? '';
    info.innerHTML = '';
    const dims = result.width && result.height ? ` · ${result.width}×${result.height}` : '';
    const fmt = document.createElement('div');
    fmt.style.cssText = 'color:#e0e0e0;font-size:11px;';
    fmt.textContent = `${result.mimeType.replace('image/', '').toUpperCase()}${dims}`;
    info.appendChild(fmt);
    if (result.bytes > 0) {
      const size = document.createElement('div');
      size.style.cssText = `color:${result.softWarn ? 'var(--qpm-warning)' : 'rgba(224,224,224,0.3)'};font-size:10px;`;
      size.textContent = formatBytes(result.bytes) + (result.softWarn ? ' (large)' : '');
      info.appendChild(size);
    }
    if (result.videoUrl) {
      const vid = document.createElement('div');
      vid.style.cssText = 'color:rgba(143,130,255,0.6);font-size:10px;';
      vid.textContent = '✦ Animated source preserved';
      info.appendChild(vid);
    }
    if (result.portraitUrl) {
      const src = document.createElement('div');
      src.style.cssText = 'color:rgba(224,224,224,0.3);font-size:10px;word-break:break-all;';
      src.textContent = result.portraitUrl;
      info.appendChild(src);
    }
  }

  async function ingestFile(file: File): Promise<void> {
    if (!ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) {
      emit(`Unsupported file type "${file.type || 'unknown'}". Allowed: PNG, JPEG, GIF.`);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const decoded = await loadImageFromDataUrl(dataUrl);
      const v = validate(dataUrl, file.type);
      if (!v.ok) { emit(v.error); return; }
      setLoadedState({
        source: 'file',
        portraitDataUrl: dataUrl,
        mimeType: file.type,
        width: decoded.width,
        height: decoded.height,
        bytes: v.bytes,
        softWarn: v.softWarn,
      });
      emit(null);
    } catch (err) {
      log('[importInputs] file ingest failed', err);
      emit(err instanceof Error ? err.message : 'File read failed.');
    }
  }

  async function ingestDataUrl(value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed.startsWith('data:image/')) {
      emit('Pasted text is not an image data URL.');
      return;
    }
    try {
      const decoded = await loadImageFromDataUrl(trimmed);
      const mimeMatch = trimmed.match(/^data:([^;,]+)/);
      const mimeType = mimeMatch ? mimeMatch[1]! : 'image/png';
      const v = validate(trimmed, mimeType);
      if (!v.ok) { emit(v.error); return; }
      setLoadedState({
        source: 'data-url',
        portraitDataUrl: trimmed,
        mimeType,
        width: decoded.width,
        height: decoded.height,
        bytes: v.bytes,
        softWarn: v.softWarn,
      });
      emit(null);
    } catch (err) {
      log('[importInputs] data URL ingest failed', err);
      emit(err instanceof Error ? err.message : 'Could not decode data URL.');
    }
  }

  async function ingestUrl(url: string): Promise<void> {
    try {
      const decoded = await loadImageFromUrl(url);
      const v = validate(decoded.dataUrl, decoded.mimeType);
      if (!v.ok) { emit(v.error); return; }
      setLoadedState({
        source: 'export-url',
        portraitDataUrl: decoded.dataUrl,
        portraitUrl: url,
        mimeType: decoded.mimeType,
        width: decoded.width,
        height: decoded.height,
        bytes: v.bytes,
        softWarn: v.softWarn,
      });
      emit(null);
    } catch (err) {
      log('[importInputs] URL ingest failed', err);
      emit(err instanceof Error ? err.message : 'Could not fetch image — try downloading and dropping it instead.');
    }
  }

  // Click → file picker
  const onFileChange = (): void => {
    const file = fileInput.files?.[0];
    if (file) void ingestFile(file);
    fileInput.value = '';
  };
  fileInput.addEventListener('change', onFileChange);
  cleanups.push(() => fileInput.removeEventListener('change', onFileChange));

  // Drag → file
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(143,130,255,0.55)';
  };
  const onDragLeave = (): void => { dropZone.style.borderColor = 'rgba(143,130,255,0.25)'; };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(143,130,255,0.25)';
    const file = e.dataTransfer?.files?.[0];
    if (file) { void ingestFile(file); return; }
    // Try text drop (URL or data URL)
    const txt = e.dataTransfer?.getData('text/plain');
    if (txt) void routeText(txt);
  };
  dropZone.addEventListener('dragover', onDragOver);
  dropZone.addEventListener('dragleave', onDragLeave);
  dropZone.addEventListener('drop', onDrop);
  cleanups.push(
    () => dropZone.removeEventListener('dragover', onDragOver),
    () => dropZone.removeEventListener('dragleave', onDragLeave),
    () => dropZone.removeEventListener('drop', onDrop),
  );

  // Paste anywhere within the drop zone (clipboard image or pasted text)
  const onPaste = (e: ClipboardEvent): void => {
    if (!e.clipboardData) return;
    // First check for image data
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void ingestFile(file);
          return;
        }
      }
    }
    // Then text → URL or data URL
    const txt = e.clipboardData.getData('text/plain');
    if (txt) {
      e.preventDefault();
      void routeText(txt);
    }
  };
  dropZone.addEventListener('paste', onPaste);
  // Make the drop zone focusable so paste fires reliably
  dropZone.tabIndex = 0;
  cleanups.push(() => dropZone.removeEventListener('paste', onPaste));

  function routeText(raw: string): Promise<void> {
    const trimmed = raw.trim();
    if (trimmed.startsWith('data:image/')) return ingestDataUrl(trimmed);
    if (/^https?:\/\//i.test(trimmed)) return ingestUrl(trimmed);
    emit('Pasted text is neither an image URL nor a data URL.');
    return Promise.resolve();
  }

  // Clear button → revert to empty state
  const onClear = (): void => { setLoadedState(null); emit(null); };
  clearBtn.addEventListener('click', onClear);
  cleanups.push(() => clearBtn.removeEventListener('click', onClear));

  return {
    root,
    getResult: () => current,
    setResult: (result) => setLoadedState(result),
    onChange: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    destroy: () => {
      for (const fn of cleanups) { try { fn(); } catch { /* best effort */ } }
      cleanups.length = 0;
      subscribers.clear();
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Validation

interface ValidationResult {
  ok: boolean;
  bytes: number;
  softWarn: boolean;
  error: string;
}

function validate(dataUrl: string, mimeType: string): ValidationResult {
  if (!ALLOWED_MIME_TYPES.includes(mimeType as typeof ALLOWED_MIME_TYPES[number])) {
    return {
      ok: false,
      bytes: 0,
      softWarn: false,
      error: `Unsupported image type "${mimeType}". Allowed: PNG, JPEG, GIF.`,
    };
  }
  const bytes = estimateDataUrlBytes(dataUrl);
  if (bytes > PRESET_SIZE_HARD_LIMIT_BYTES) {
    return {
      ok: false,
      bytes,
      softWarn: false,
      error: `Image is ${formatBytes(bytes)} — exceeds the ${formatBytes(PRESET_SIZE_HARD_LIMIT_BYTES)} limit. Resize before importing.`,
    };
  }
  return {
    ok: true,
    bytes,
    softWarn: bytes > PRESET_SIZE_SOFT_WARN_BYTES,
    error: '',
  };
}

/**
 * Estimates decoded bytes of a data URL. base64 expands payload by ~4/3, so we
 * back out the original byte count from the post-comma string length.
 */
function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return dataUrl.length;
  const payload = dataUrl.slice(commaIndex + 1);
  // Trim trailing '=' padding to avoid over-counting.
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ──────────────────────────────────────────────────────────────────────────
// Image loading

interface DecodedImage {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Load an external URL into a data URL via a CORS-enabled Image + canvas.
 * Returns the image's natural dimensions and the canvas-encoded data URL.
 * For GIFs this captures the first frame only (animation is a 2b concern).
 */
function loadImageFromUrl(url: string): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        // Re-encode as PNG so the data URL is well-formed regardless of source.
        const dataUrl = canvas.toDataURL('image/png');
        resolve({
          dataUrl,
          mimeType: 'image/png',
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } catch {
        // Canvas may be tainted if the host doesn't send CORS headers.
        reject(new Error('Could not read the image — the server may not allow cross-origin access. Download and drop it instead.'));
      }
    };
    img.onerror = () => reject(new Error('Image load failed. Check the URL, or download and drop the file.'));
    img.src = url;
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Image could not be decoded.'));
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Unexpected FileReader result.'));
    };
    reader.onerror = () => reject(new Error('Failed to read the file.'));
    reader.readAsDataURL(file);
  });
}
