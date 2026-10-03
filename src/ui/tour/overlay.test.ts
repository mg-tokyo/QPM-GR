// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { destroyOverlay, updateOverlayStep } from './overlay';
import type { TourStep } from './types';

afterEach(async () => {
  await destroyOverlay();
  vi.unstubAllGlobals();
});

describe('tour overlay', () => {
  it('hides Next on advanceWhen steps and restores it on plain steps', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const target = document.body.appendChild(document.createElement('div'));
    const base = { target, stepIndex: 0, totalSteps: 2, isLastStep: false, onNext: () => {}, onSkip: () => {} };
    const waiting: TourStep = { id: 'w', title: 'W', body: 'w', advanceWhen: () => () => {} };
    const plain: TourStep = { id: 'p', title: 'P', body: 'p' };
    const next = (): HTMLElement => document.querySelector<HTMLElement>('.qpm-tour-next')!;

    updateOverlayStep({ ...base, step: waiting });
    expect(next().style.display).toBe('none');
    updateOverlayStep({ ...base, step: plain });
    expect(next().style.display).toBe('');
  });
});
