import { t } from '../../../i18n';
import { createButton } from '../../../ui/components';
import { isDiscordSurface } from '../../../utils/environment';

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** PS3 (2026-10-10): magic-garden-<YYYY-MM-DD>-<HHmmss>.png, local time. */
export function photoFileName(d: Date): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `magic-garden-${date}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
}

// A download from the Discord activity's frame is unverified (S §2, Task 11); a blocked one fails silently, so Save opens
// the preview there instead of guessing.
export const downloadsAvailable = (): boolean => !isDiscordSurface;

// The download reads the blob after click() returns; revoking at once can cancel it in Firefox (as customSkins/index.ts).
const REVOKE_MS = 1000;

export function savePhoto(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, REVOKE_MS);
}

/** False when the clipboard API is missing or refuses (a frame without clipboard-write, a lost user gesture). */
export async function copyPhoto(blob: Blob): Promise<boolean> {
  try {
    const Item: unknown = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    const write = navigator.clipboard?.write;
    if (typeof Item !== 'function' || typeof write !== 'function') return false;
    await navigator.clipboard.write([new (Item as typeof ClipboardItem)({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** The fallback when the shot can be neither saved nor copied: right-click save. Returns an idempotent close. */
export function previewPhoto(blob: Blob, onClose: () => void): () => void {
  const url = URL.createObjectURL(blob);
  const el = document.createElement('div');
  el.className = 'qpm-spec-preview qpm-spec-photo-ui';
  el.setAttribute('role', 'dialog');
  const title = t('feature.spectator.photo.preview.title');
  el.setAttribute('aria-label', title);
  const head = document.createElement('div');
  head.className = 'qpm-spec-preview-hd';
  const name = document.createElement('span');
  name.textContent = title;
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    el.remove();
    URL.revokeObjectURL(url);
    onClose();
  };
  const x = createButton('×', { variant: 'ghost', size: 'sm', onClick: close });
  const label = t('feature.spectator.card.close', { key: 'Esc' });
  x.title = label;
  x.setAttribute('aria-label', label);
  head.append(name, x);
  const img = document.createElement('img');
  img.className = 'qpm-spec-preview-img';
  img.src = url;
  img.alt = title;
  const hint = document.createElement('div');
  hint.className = 'qpm-spec-preview-hint';
  hint.textContent = t('feature.spectator.photo.preview.hint');
  el.append(head, img, hint);
  document.body.append(el);
  return close;
}
