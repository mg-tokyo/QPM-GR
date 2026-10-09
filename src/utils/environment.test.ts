// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { isGameFrameHost } from './environment';

function frame(src: string | null): HTMLIFrameElement {
  const el = document.createElement('iframe');
  if (src !== null) el.setAttribute('src', src);
  return el;
}

describe('isGameFrameHost', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as { readyState?: unknown }).readyState;
  });

  it('a parsed body holding only a same-origin iframe is a frame host (the Discord shell)', () => {
    document.body.replaceChildren(frame('/?instance_id=i-1&frame_id=f&platform=desktop&mc_shell_frame=1'));
    expect(isGameFrameHost()).toBe(true);
  });

  it('an absolute same-origin src with a hash still counts', () => {
    document.body.replaceChildren(frame(`${location.origin}/r/zzz#x`));
    expect(isGameFrameHost()).toBe(true);
  });

  it('a cross-origin, about:blank or src-less iframe is not a host (no QPM runs in it)', () => {
    document.body.replaceChildren(frame('https://discord.com/activities'));
    expect(isGameFrameHost()).toBe(false);
    document.body.replaceChildren(frame('about:blank'));
    expect(isGameFrameHost()).toBe(false);
    document.body.replaceChildren(frame(null));
    expect(isGameFrameHost()).toBe(false);
  });

  it('a game page body is not a host, even with an iframe in it', () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.replaceChildren(root, frame('/embed'));
    expect(isGameFrameHost()).toBe(false);
    document.body.replaceChildren(root);
    expect(isGameFrameHost()).toBe(false);
  });

  it('an empty body is not a host', () => {
    expect(isGameFrameHost()).toBe(false);
  });

  it('undecided while the document is still parsing', () => {
    document.body.replaceChildren(frame('/?mc_shell_frame=1'));
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    expect(isGameFrameHost()).toBe(false);
  });
});
