import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  cb: null as ((v: number | null) => void) | null,
  unsubscribed: 0,
  discord: false,
  build: 'b1',
  mem: new Map<string, unknown>(),
  button: null as Record<string, unknown> | null,
  reloads: 0,
  toasts: [] as Array<{ message: string; open: boolean; action?: { onClick: () => void } }>,
}));

vi.mock('../../core/gameState', () => ({
  subscribe: (_key: string, cb: (v: number | null) => void) => {
    h.cb = cb;
    return () => { h.unsubscribed += 1; h.cb = null; };
  },
}));
vi.mock('../../core/pageContext', () => ({ pageWindow: { location: { reload: () => { h.reloads += 1; } } } }));
vi.mock('../../core/pixiCapture', () => ({ getPixiRefs: () => ({ stage: {} }) }));
vi.mock('../../core/pixiScene', () => ({ findByLabel: (_root: unknown, label: string) => (label === 'SessionNotice:action' ? h.button : null) }));
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ info: () => {}, debug: () => {} }) }));
vi.mock('../../i18n', () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${String(vars.seconds)}` : key) }));
vi.mock('../../sprite-v2/detector', () => ({ detectGameVersion: () => h.build }));
vi.mock('../../utils/environment', () => ({ get isDiscordSurface() { return h.discord; } }));
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown) => (h.mem.has(key) ? h.mem.get(key) : fallback),
    set: (key: string, value: unknown) => { h.mem.set(key, value); },
  },
}));
vi.mock('../../ui/components', () => ({
  showToast: (message: string, opts: { action?: { onClick: () => void } }) => {
    for (const prev of h.toasts) prev.open = false;
    const toast: { message: string; open: boolean; action?: { onClick: () => void } } = { message, open: true };
    if (opts.action) toast.action = opts.action;
    h.toasts.push(toast);
    return {
      setMessage: (m: string) => { toast.message = m; },
      close: () => { toast.open = false; },
      isOpen: () => toast.open,
    };
  },
}));

import {
  decideRefresh,
  GAME_UPDATE_REFRESH_ENABLED_KEY,
  GAME_UPDATE_REFRESH_GUARD_KEY,
  startGameUpdateRefresh,
  stopGameUpdateRefresh,
} from './gameUpdateRefresh';

const fire = (v: number | null): void => { h.cb?.(v); };
const lastToast = (): (typeof h.toasts)[number] | undefined => h.toasts[h.toasts.length - 1];
let taps = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000_000);
  h.cb = null; h.unsubscribed = 0; h.discord = false; h.build = 'b1';
  h.mem.clear(); h.reloads = 0; h.toasts.length = 0;
  taps = 0;
  h.button = { onTap: () => { taps += 1; } };
  startGameUpdateRefresh();
});

afterEach(() => {
  stopGameUpdateRefresh();
  vi.useRealTimers();
});

describe('decideRefresh', () => {
  const base = { enabled: true, discord: false, guard: null, build: 'b1', now: 1_000 };
  it('orders off, discord, guard, countdown', () => {
    expect(decideRefresh({ ...base, enabled: false, discord: true })).toBe('off');
    expect(decideRefresh({ ...base, discord: true })).toBe('discord');
    expect(decideRefresh({ ...base, guard: { build: 'b1', at: 500 } })).toBe('guarded');
    expect(decideRefresh(base)).toBe('countdown');
  });
  it('guard only holds for the same build inside 10 min', () => {
    expect(decideRefresh({ ...base, guard: { build: 'b0', at: 500 } })).toBe('countdown');
    expect(decideRefresh({ ...base, now: 600_500, guard: { build: 'b1', at: 500 } })).toBe('countdown');
    expect(decideRefresh({ ...base, now: 599_000, guard: { build: 'b1', at: 500 } })).toBe('guarded');
    expect(decideRefresh({ ...base, guard: { build: 'b1', at: 5_000 } })).toBe('countdown');
  });
});

describe('gameUpdateRefresh', () => {
  it('ignores other close codes and null', () => {
    fire(null); fire(4250);
    vi.advanceTimersByTime(10_000);
    expect(h.toasts).toHaveLength(0);
    expect(taps + h.reloads).toBe(0);
  });

  it('counts down 5 s, writes the guard, then taps the game button', () => {
    fire(4710);
    expect(lastToast()?.message).toBe('feature.autoReconnect.countdown:5');
    vi.advanceTimersByTime(1000);
    expect(lastToast()?.message).toBe('feature.autoReconnect.countdown:4');
    vi.advanceTimersByTime(3999);
    expect(taps).toBe(0);
    vi.advanceTimersByTime(1);
    expect(taps).toBe(1);
    expect(h.reloads).toBe(0);
    expect(h.mem.get(GAME_UPDATE_REFRESH_GUARD_KEY)).toEqual({ build: 'b1', at: 1_000_000_000 + 5000 });
    expect(lastToast()?.open).toBe(false);
  });

  it('reloads the page when the button is missing', () => {
    h.button = null;
    fire(4710);
    vi.advanceTimersByTime(5000);
    expect(h.reloads).toBe(1);
  });

  it('Cancel stops it: no tap, no reload, no guard', () => {
    fire(4710);
    vi.advanceTimersByTime(2000);
    lastToast()?.action?.onClick();
    vi.advanceTimersByTime(10_000);
    expect(taps + h.reloads).toBe(0);
    expect(h.mem.has(GAME_UPDATE_REFRESH_GUARD_KEY)).toBe(false);
  });

  it('acts once per page even if the code repeats', () => {
    fire(4710);
    lastToast()?.action?.onClick();
    fire(null); fire(4710);
    vi.advanceTimersByTime(10_000);
    expect(h.toasts).toHaveLength(1);
    expect(taps).toBe(0);
  });

  it('aborts when the reason clears mid-countdown', () => {
    fire(4710);
    vi.advanceTimersByTime(2000);
    fire(null);
    vi.advanceTimersByTime(10_000);
    expect(taps + h.reloads).toBe(0);
    expect(lastToast()?.open).toBe(false);
  });

  it('re-shows the countdown when another toast replaced it', () => {
    fire(4710);
    const first = lastToast();
    if (first) first.open = false;
    vi.advanceTimersByTime(1000);
    expect(h.toasts).toHaveLength(2);
    expect(lastToast()?.message).toBe('feature.autoReconnect.countdown:4');
  });

  it('guard: same build refreshed under 10 min ago does nothing', () => {
    h.mem.set(GAME_UPDATE_REFRESH_GUARD_KEY, { build: 'b1', at: 1_000_000_000 - 60_000 });
    fire(4710);
    vi.advanceTimersByTime(10_000);
    expect(h.toasts).toHaveLength(0);
    expect(taps + h.reloads).toBe(0);
  });

  it('setting off does nothing', () => {
    h.mem.set(GAME_UPDATE_REFRESH_ENABLED_KEY, false);
    fire(4710);
    vi.advanceTimersByTime(10_000);
    expect(h.toasts).toHaveLength(0);
    expect(taps + h.reloads).toBe(0);
  });

  it('Discord: no toast, no tap, no reload', () => {
    h.discord = true;
    fire(4710);
    vi.advanceTimersByTime(10_000);
    expect(h.toasts).toHaveLength(0);
    expect(taps + h.reloads).toBe(0);
  });

  it('stop is idempotent and clears a running countdown', () => {
    fire(4710);
    stopGameUpdateRefresh();
    stopGameUpdateRefresh();
    vi.advanceTimersByTime(10_000);
    expect(h.unsubscribed).toBe(1);
    expect(taps + h.reloads).toBe(0);
    startGameUpdateRefresh();
    expect(h.cb).not.toBeNull();
  });
});
