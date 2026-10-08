// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { showToast } from './toast';

const toasts = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.qpm-toast'));

describe('showToast', () => {
  afterEach(() => { vi.useRealTimers(); for (const el of toasts()) el.remove(); });

  it('text only, as before: the message is the whole toast, and a new toast replaces it', () => {
    showToast('first');
    showToast('second');
    expect(toasts().map((el) => el.textContent)).toEqual(['second']);
    expect(toasts()[0]!.querySelector('button')).toBeNull();
  });

  it('an action adds one button; clicking it closes the toast first, then runs the action once', () => {
    const order: string[] = [];
    showToast('3D is slow', {
      action: { label: 'Apply', onClick: () => { order.push(`click:${toasts().length}`); } },
    });
    const el = toasts()[0]!;
    const buttons = el.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Apply');
    expect(el.textContent).toBe('3D is slowApply');
    buttons[0]!.click();
    buttons[0]!.click();
    expect(order).toEqual(['click:0']);
    expect(toasts()).toHaveLength(0);
  });

  it('a toast shown from the action stays (the old toast\'s timers never remove it)', () => {
    vi.useFakeTimers();
    showToast('offer', { duration: 15000, action: { label: 'Apply', onClick: () => { showToast('applied', { duration: 6000 }); } } });
    toasts()[0]!.querySelector('button')!.click();
    vi.advanceTimersByTime(5000);
    expect(toasts().map((el) => el.textContent)).toEqual(['applied']);
    vi.advanceTimersByTime(11000);
    expect(toasts()).toHaveLength(0);
  });
});
