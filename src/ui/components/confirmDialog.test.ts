// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { showConfirmDialog } from './confirmDialog';

const buttons = (): HTMLButtonElement[] => Array.from(document.body.querySelectorAll('button'));
const byText = (text: string): HTMLButtonElement => buttons().find((b) => b.textContent === text)!;
const click = (b: HTMLElement, detail: number): void => {
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
};
const settled = async <T>(p: Promise<T>): Promise<T | 'pending'> => Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), 0))]);

describe('showConfirmDialog', () => {
  afterEach(() => { document.body.replaceChildren(); });

  it('default: focuses confirm, and a keyboard-activated click (detail 0) confirms as before', async () => {
    const p = showConfirmDialog({ title: 't', message: 'm', confirmLabel: 'Yes', cancelLabel: 'No' });
    expect(document.activeElement).toBe(byText('Yes'));
    click(byText('Yes'), 0);
    expect(await p).toBe(true);
  });

  it('pointerOnly: focuses Cancel and ignores a keyboard-activated confirm click', async () => {
    const p = showConfirmDialog({ title: 't', message: 'm', confirmLabel: 'Yes', cancelLabel: 'No', pointerOnly: true });
    expect(document.activeElement).toBe(byText('No'));
    click(byText('Yes'), 0);
    expect(await settled(p)).toBe('pending');
    click(byText('Yes'), 1);
    expect(await p).toBe(true);
  });

  it('pointerOnly: Cancel (focused, so Enter lands there) resolves false', async () => {
    const p = showConfirmDialog({ title: 't', message: 'm', confirmLabel: 'Yes', cancelLabel: 'No', pointerOnly: true });
    click(byText('No'), 0);
    expect(await p).toBe(false);
  });
});
