// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runs, binds } = vi.hoisted(() => ({ runs: [] as string[], binds: {} as Record<string, string> }));

vi.mock('./runnable', () => ({
  buildRunnableActions: () => ['window:stats', 'bag', 'panel:seedSilo'].map(id => ({
    id, section: 'gamePanels', run: async () => { runs.push(id); },
  })),
}));
vi.mock('./actionBinds', () => ({ getActionBinds: () => ({ ...binds }) }));

const { startKeybindDispatcher, stopKeybindDispatcher } = await import('./dispatcher');
const { beginKeybindRecording } = await import('../../../ui/pets/petsWindow/helpers');

const press = (init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe('keybind dispatcher (new actions only)', () => {
  beforeEach(() => {
    runs.length = 0;
    for (const k of Object.keys(binds)) delete binds[k];
    binds['panel:seedSilo'] = 'alt+g';
    startKeybindDispatcher();
  });
  afterEach(() => stopKeybindDispatcher());

  it('fires the bound action and claims the key', () => {
    const e = press({ key: 'g', code: 'KeyG', altKey: true });
    expect(runs).toEqual(['panel:seedSilo']);
    expect(e.defaultPrevented).toBe(true);
  });
  it('fires a QPM window action from the same list', () => {
    binds['window:stats'] = 'alt+k';
    press({ key: 'k', code: 'KeyK', altKey: true });
    expect(runs).toEqual(['window:stats']);
  });
  it('ignores an unbound combo', () => {
    const e = press({ key: 'h', code: 'KeyH', altKey: true });
    expect(runs).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });
  it('ignores key repeat', () => {
    press({ key: 'g', code: 'KeyG', altKey: true, repeat: true });
    expect(runs).toEqual([]);
  });
  it('ignores typing in a text box', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press({ key: 'g', code: 'KeyG', altKey: true }, input);
    input.remove();
    expect(runs).toEqual([]);
  });
  it('ignores keys while a recorder waits', () => {
    const end = beginKeybindRecording();
    press({ key: 'g', code: 'KeyG', altKey: true });
    end();
    expect(runs).toEqual([]);
  });
  it('is idempotent and stops cleanly', () => {
    startKeybindDispatcher();
    press({ key: 'g', code: 'KeyG', altKey: true });
    expect(runs).toEqual(['panel:seedSilo']);
    stopKeybindDispatcher();
    press({ key: 'g', code: 'KeyG', altKey: true });
    expect(runs).toEqual(['panel:seedSilo']);
  });
});
