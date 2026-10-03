// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TourDefinition, TourStep } from './types';

const h = vi.hoisted(() => ({
  defs: new Map<string, unknown>(),
  progress: new Map<string, unknown>(),
  shown: [] as Array<{ stepIndex: number; onNext: () => void; onSkip: () => void }>,
}));

vi.mock('./overlay', () => ({
  createOverlay: () => ({}),
  updateOverlayStep: (p: { stepIndex: number; onNext: () => void; onSkip: () => void }) => { h.shown.push(p); },
  updateSpotlightPosition: () => {},
  destroyOverlay: () => Promise.resolve(),
}));
vi.mock('./persistence', () => ({
  areToursEnabled: () => true,
  readTourProgress: (id: string) => h.progress.get(id) ?? null,
  writeTourProgress: (id: string, p: unknown) => { h.progress.set(id, p); },
}));
vi.mock('./registry', () => ({ lookupTour: (id: string) => h.defs.get(id) }));
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug() {}, info() {}, warn() {} }) }));

let engine: typeof import('./engine');
let host: HTMLElement;

const last = () => h.shown[h.shown.length - 1];
const define = (steps: TourStep[]): void => {
  const def: TourDefinition = { windowId: 't', label: 'T', category: 'garden', version: 1, steps };
  h.defs.set('t', def);
};
const plain = (id: string): TourStep => ({ id, resolve: () => host, title: id, body: id });

beforeEach(async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  h.defs.clear();
  h.progress.clear();
  h.shown.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  vi.resetModules();
  engine = await import('./engine');
});

afterEach(async () => {
  await engine.teardown();
  host.remove();
  vi.unstubAllGlobals();
});

describe('tour engine advanceWhen', () => {
  it('advances once when the condition fires and unsubscribes the watch', async () => {
    let fire: (() => void) | null = null;
    const off = vi.fn();
    define([{ ...plain('a'), advanceWhen: (adv) => { fire = adv; return off; } }, plain('b'), plain('c')]);
    engine.check('t', host);
    await vi.waitFor(() => expect(fire).not.toBeNull());
    fire!();
    fire!();
    await vi.waitFor(() => expect(last()?.stepIndex).toBe(1));
    await new Promise((r) => setTimeout(r, 150));
    expect(last()?.stepIndex).toBe(1);
    expect(off).toHaveBeenCalledTimes(1);
    expect(h.progress.get('t')).toMatchObject({ lastCompletedStep: 0, completed: false });
  });

  it('moves on when the condition already holds at subscribe time', async () => {
    const off = vi.fn();
    define([{ ...plain('a'), advanceWhen: (adv) => { adv(); return off; } }, plain('b')]);
    engine.check('t', host);
    await vi.waitFor(() => expect(last()?.stepIndex).toBe(1));
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('skip removes the watch and a late fire is ignored', async () => {
    let fire: (() => void) | null = null;
    const off = vi.fn();
    define([{ ...plain('a'), advanceWhen: (adv) => { fire = adv; return off; } }, plain('b')]);
    engine.check('t', host);
    await vi.waitFor(() => expect(fire).not.toBeNull());
    last()!.onSkip();
    expect(off).toHaveBeenCalledTimes(1);
    expect(h.progress.get('t')).toMatchObject({ completed: true });
    const count = h.shown.length;
    fire!();
    await new Promise((r) => setTimeout(r, 150));
    expect(h.shown.length).toBe(count);
  });

  it('Next on a plain step still advances', async () => {
    define([plain('a'), plain('b')]);
    engine.check('t', host);
    await vi.waitFor(() => expect(last()?.stepIndex).toBe(0));
    last()!.onNext();
    await vi.waitFor(() => expect(last()?.stepIndex).toBe(1));
    expect(h.progress.get('t')).toMatchObject({ lastCompletedStep: 0, completed: false });
  });
});
