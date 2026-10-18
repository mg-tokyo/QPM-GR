// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({ t: (k: string) => k }));
vi.mock('../../../ui/components', () => ({
  createButton: (label: string, o: { onClick?: () => void }) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { o.onClick?.(); });
    return b;
  },
}));

import { copyPhoto, photoFileName, previewPhoto, savePhoto } from './output';

const blob = new Blob(['png'], { type: 'image/png' });
const urls: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  urls.length = 0;
  revoked.length = 0;
  let n = 0;
  URL.createObjectURL = () => { const u = `blob:test/${++n}`; urls.push(u); return u; };
  URL.revokeObjectURL = (u: string) => { revoked.push(u); };
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('photo output', () => {
  it('names the file by local date and time (PS3)', () => {
    expect(photoFileName(new Date(2026, 9, 10, 9, 5, 7))).toBe('magic-garden-2026-10-10-090507.png');
    expect(photoFileName(new Date(2026, 0, 2, 23, 59, 0))).toBe('magic-garden-2026-01-02-235900.png');
  });

  it('save clicks a download link with that name and lets the object URL go once the download has read it', () => {
    vi.useFakeTimers();
    const clicks: Array<{ href: string; download: string }> = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });
    savePhoto(blob, 'magic-garden-2026-10-10-090507.png');
    expect(clicks).toEqual([{ href: 'blob:test/1', download: 'magic-garden-2026-10-10-090507.png' }]);
    expect(document.querySelector('a')).toBeNull();
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(revoked).toEqual(['blob:test/1']);
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('copy writes one image/png item, and reports false when the clipboard is missing or refuses', async () => {
    const written: unknown[] = [];
    class Item { constructor(public items: Record<string, Blob>) {} }
    vi.stubGlobal('ClipboardItem', Item);
    vi.stubGlobal('navigator', { clipboard: { write: async (items: unknown[]) => { written.push(...items); } } });
    await expect(copyPhoto(blob)).resolves.toBe(true);
    expect(written).toHaveLength(1);
    expect((written[0] as Item).items).toEqual({ 'image/png': blob });

    vi.stubGlobal('navigator', { clipboard: { write: async () => { throw new DOMException('denied', 'NotAllowedError'); } } });
    await expect(copyPhoto(blob)).resolves.toBe(false);
    vi.stubGlobal('navigator', {});
    await expect(copyPhoto(blob)).resolves.toBe(false);
    vi.stubGlobal('ClipboardItem', undefined);
    vi.stubGlobal('navigator', { clipboard: { write: async () => {} } });
    await expect(copyPhoto(blob)).resolves.toBe(false);
  });

  it('the preview shows the shot with the right-click hint; close is idempotent and lets the URL go', () => {
    let closed = 0;
    const close = previewPhoto(blob, () => { closed++; });
    const el = document.querySelector('.qpm-spec-preview');
    expect(el?.classList.contains('qpm-spec-photo-ui')).toBe(true);
    expect(el?.querySelector('img')?.getAttribute('src')).toBe('blob:test/1');
    expect(el?.textContent).toContain('feature.spectator.photo.preview.title');
    expect(el?.textContent).toContain('feature.spectator.photo.preview.hint');
    el?.querySelector('button')?.click();
    expect(closed).toBe(1);
    expect(document.querySelector('.qpm-spec-preview')).toBeNull();
    expect(revoked).toEqual(['blob:test/1']);
    close();
    expect(closed).toBe(1);
    expect(revoked).toEqual(['blob:test/1']);
  });
});
