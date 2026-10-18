// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));
vi.mock('../../../ui/components', async () => ({ createButton: (await import('../../../ui/components/button')).createButton }));

import type { PhotoView, StripActions } from '../photo/mode';
import { mountPhotoStrip } from './photoStrip';

const shot = new Blob(['a'], { type: 'image/png' });
const shot2 = new Blob(['b'], { type: 'image/png' });
let calls: string[];
let revoked: string[];
const actions: StripActions = {
  capture: () => { calls.push('capture'); }, copy: () => { calls.push('copy'); }, save: () => { calls.push('save'); },
  exit: () => { calls.push('exit'); },
};
const strip = (): HTMLElement => document.querySelector<HTMLElement>('.qpm-spec-strip')!;
const btn = (key: string): HTMLButtonElement => [...strip().querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith(key))!;
const view = (p: Partial<PhotoView> = {}): PhotoView => ({ status: 'none', shot: null, ...p });

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  calls = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = () => `blob:t/${++n}`;
  URL.revokeObjectURL = (u: string) => { revoked.push(u); };
});

describe('photo strip (PS3)', () => {
  it('is a photo-mode toolbar that photo mode never hides, with the approved labels and hover text', () => {
    const s = mountPhotoStrip(actions, { photo: () => 'P' });
    s.update(view());
    const el = strip();
    expect(el.classList.contains('qpm-spec-photo-ui')).toBe(true);
    expect(el.classList.contains('qpm-spec-bar')).toBe(true);
    expect(el.getAttribute('role')).toBe('toolbar');
    expect(el.querySelector('.qpm-spec-chip')?.textContent).toBe('feature.spectator.bar.photo');
    expect(btn('feature.spectator.photo.capture').title).toBe('feature.spectator.photo.captureHint {"key":"Enter","alt":"Space"}');
    expect(btn('feature.spectator.photo.copy').title).toBe('feature.spectator.photo.copyHint');
    expect(btn('feature.spectator.photo.save').title).toBe('feature.spectator.photo.saveHint');
    expect(btn('feature.spectator.bar.exit').getAttribute('aria-label')).toBe('feature.spectator.bar.exit {"key":"P"}');
    expect(btn('feature.spectator.bar.exit').title).toBe('feature.spectator.photo.exitHint {"key":"P"}');
    expect(strip().querySelectorAll('button')).toHaveLength(4);
    expect(document.getElementById('qpm-spectator-styles')).not.toBeNull();
    s.destroy();
  });

  it('Copy and Save wait for a shot and pause while capturing; the thumbnail follows the last shot', () => {
    const s = mountPhotoStrip(actions, { photo: () => 'P' });
    s.update(view());
    const thumb = strip().querySelector<HTMLImageElement>('.qpm-spec-strip-thumb')!;
    expect(btn('feature.spectator.photo.copy').disabled).toBe(true);
    expect(btn('feature.spectator.photo.save').disabled).toBe(true);
    expect(thumb.hidden).toBe(true);
    expect(strip().querySelector('.qpm-spec-strip-status')?.textContent).toBe('feature.spectator.photo.status.none');
    s.update(view({ status: 'ready', shot }));
    expect(btn('feature.spectator.photo.copy').disabled).toBe(false);
    expect(thumb.hidden).toBe(false);
    expect(thumb.getAttribute('src')).toBe('blob:t/1');
    expect(thumb.title).toBe('feature.spectator.photo.lastShot');
    s.update(view({ status: 'capturing', shot }));
    expect(btn('feature.spectator.photo.save').disabled).toBe(true);
    expect(thumb.getAttribute('src')).toBe('blob:t/1');
    s.update(view({ status: 'ready', shot: shot2 }));
    expect(thumb.getAttribute('src')).toBe('blob:t/2');
    expect(revoked).toEqual(['blob:t/1']);
    s.destroy();
    s.destroy();
    expect(revoked).toEqual(['blob:t/1', 'blob:t/2']);
    expect(strip()).toBeNull();
    expect(document.getElementById('qpm-spectator-styles')).toBeNull();
  });

  it('each status reads its approved line', () => {
    const s = mountPhotoStrip(actions, { photo: () => 'P' });
    for (const st of ['capturing', 'ready', 'copied', 'saved', 'failed', 'copyBlocked'] as const) {
      s.update(view({ status: st, shot }));
      expect(strip().querySelector('.qpm-spec-strip-status')?.textContent).toBe(`feature.spectator.photo.status.${st}`);
    }
    s.destroy();
  });

  it('the buttons run their actions', () => {
    const s = mountPhotoStrip(actions, { photo: () => 'P' });
    s.update(view({ status: 'ready', shot }));
    for (const k of ['capture', 'copy', 'save']) btn(`feature.spectator.photo.${k}`).click();
    btn('feature.spectator.bar.exit').click();
    expect(calls).toEqual(['capture', 'copy', 'save', 'exit']);
    s.destroy();
  });
});
