// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../../i18n', () => ({ t: (k: string) => k }));
vi.mock('../../core/gameState', () => ({ subscribe: () => () => undefined }));
vi.mock('../../core/pageContext', () => ({ pageWindow: { location: { reload: () => undefined } } }));
vi.mock('../../core/pixiCapture', () => ({ getPixiRefs: () => null }));
vi.mock('../../core/pixiScene', () => ({ findByLabel: () => null }));
vi.mock('../../sprite-v2/detector', () => ({ detectGameVersion: () => 'b1' }));
vi.mock('../components', async () => ({
  ...(await import('../components/toggle')),
  showToast: () => ({ setMessage: () => undefined, close: () => undefined, isOpen: () => false }),
}));
vi.mock('../core/modalWindow', () => ({
  closeWindow: () => undefined, destroyWindow: () => undefined, isWindowOpen: () => false, openWindow: () => undefined,
  windowLog: { warn: () => undefined },
}));

import { GAME_UPDATE_REFRESH_ENABLED_KEY, setGameUpdateRefreshEnabled } from '../../features/standalone/gameUpdateRefresh';
import { createGameUpdateRefreshSection, getGameUpdateRefreshCard } from './gameUpdateRefreshSection';

let section: { root: HTMLElement; destroy: () => void } | null = null;
const toggle = (): HTMLButtonElement => section!.root.querySelector<HTMLButtonElement>('button')!;
const isOn = (): boolean => toggle().getAttribute('aria-checked') === 'true';

beforeEach(() => {
  mem.clear();
  section = createGameUpdateRefreshSection();
  document.body.replaceChildren(section.root);
});
afterEach(() => { section?.destroy(); section = null; });

describe('auto reconnect card', () => {
  it('is on by default and shows both captions', () => {
    expect(isOn()).toBe(true);
    expect(section!.root.textContent).toContain('feature.autoReconnect.enable');
    expect(section!.root.textContent).toContain('feature.autoReconnect.captionWeb');
    expect(section!.root.textContent).toContain('feature.autoReconnect.captionDiscord');
  });

  it('a click writes the setting and the summary follows it', () => {
    const el = document.createElement('div');
    const off = getGameUpdateRefreshCard().renderSummary(el);
    expect(el.textContent).toBe('common.enabled');
    toggle().click();
    expect(mem.get(GAME_UPDATE_REFRESH_ENABLED_KEY)).toBe(false);
    expect(el.textContent).toBe('common.disabled');
    toggle().click();
    expect(mem.get(GAME_UPDATE_REFRESH_ENABLED_KEY)).toBe(true);
    expect(el.textContent).toBe('common.enabled');
    if (typeof off === 'function') off();
  });

  it('follows a change made elsewhere, and stops after destroy', () => {
    setGameUpdateRefreshEnabled(false);
    expect(isOn()).toBe(false);
    section!.destroy();
    setGameUpdateRefreshEnabled(true);
    expect(isOn()).toBe(false);
  });
});
