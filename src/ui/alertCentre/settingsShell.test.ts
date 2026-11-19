// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertRowDef } from '../../features/alertHub';

vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../features/alertHub', () => ({
  areAlertSoundsOn: () => true,
  getAlertRowSettings: () => ({ enabled: false, soundId: 'none' }),
  setAlertRowEnabled: () => {},
  setAlertRowSound: () => {},
  setAlertSoundsOn: () => {},
  resolveRowLabel: (d: AlertRowDef) => d.labelKey,
  resolveRowIcon: (d: AlertRowDef | null) => d?.icon?.() ?? null,
  resolveRowSummary: (d: AlertRowDef | null) => d?.summary?.() ?? null,
  resolveRowAccent: (d: AlertRowDef | null) => (typeof d?.accent === 'function' ? d.accent() : d?.accent ?? null),
}));
let spritesReadyCb: (() => void) | null = null;
const stopSprites = vi.fn();
vi.mock('../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getAnySpriteDataUrl: () => '',
  onSpritesReady: (cb: () => void) => { spritesReadyCb = cb; return stopSprites; },
}));
vi.mock('../shop/restockAlerts/soundConfig', () => ({ BUILTIN_SOUNDS: [], getCustomSounds: () => ({}) }));
vi.mock('../shop/restockAlerts/soundEngine', () => ({ previewSound: vi.fn() }));

const { createColorDot, mountAlertSettings } = await import('./settingsShell');
const { HYDRATION_EVENT } = await import('../../sprite-v2/service/constants');

function look(over: Partial<AlertRowDef> = {}): AlertRowDef {
  return { id: 'pets.hunger', group: 'pets', labelKey: 'row', defaultSound: 'alert', ...over };
}

function mount(l: AlertRowDef | null) {
  const root = document.createElement('div');
  root.style.cssText = 'padding:3px;';
  document.body.append(root);
  return { root, shell: mountAlertSettings(root, 'Pet alarms', l) };
}

const head = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('[data-qpm-alert-settings-head]')!;

afterEach(() => {
  document.body.replaceChildren();
  spritesReadyCb = null;
  stopSprites.mockClear();
});

describe('mountAlertSettings', () => {
  it('header carries the title, summary, sprite and accent', () => {
    const { root } = mount(look({ icon: () => 'data:pet', summary: () => 'Below 25%', accent: 'var(--qpm-hunger-low)' }));
    expect(root.classList.contains('qpm-alert-settings')).toBe(true);
    expect(root.style.padding).toBe('');
    const h = head(root);
    expect(h.querySelector('.qpm-alert-centre-card__name')?.textContent).toBe('Pet alarms');
    expect(h.querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('Below 25%');
    expect(h.querySelector('img')?.getAttribute('src')).toBe('data:pet');
    expect(h.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-hunger-low)');
    expect(root.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-hunger-low)');
  });

  it('no look: letter icon, hidden summary, default accent', () => {
    const { root } = mount(null);
    const h = head(root);
    expect(h.querySelector('.qpm-alert-card__icon-fallback')?.textContent).toBe('P');
    expect(h.querySelector<HTMLElement>('.qpm-alert-centre-card__summary')?.style.display).toBe('none');
    expect(h.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-accent)');
  });

  it('refresh re-reads the summary and swaps the icon only when it changed', () => {
    let pct = 25;
    let icon = 'data:a';
    const { root, shell } = mount(look({ icon: () => icon, summary: () => `Below ${pct}%` }));
    const firstImg = head(root).querySelector('img');
    pct = 40;
    shell.refresh();
    expect(head(root).querySelector('.qpm-alert-centre-card__summary')?.textContent).toBe('Below 40%');
    expect(head(root).querySelector('img')).toBe(firstImg);
    icon = 'data:b';
    shell.refresh();
    expect(head(root).querySelector('img')?.getAttribute('src')).toBe('data:b');
  });

  it('a section with a look is coloured and carries a small icon; without one it is plain', () => {
    const { root, shell } = mount(look());
    const troughBody = shell.addSection('Feeding trough', look({ icon: () => 'data:trough', accent: 'var(--qpm-warning)' }));
    const plainBody = shell.addSection('Level up');
    const trough = troughBody.parentElement!;
    const plain = plainBody.parentElement!;
    expect(trough.classList.contains('qpm-alert-centre-card--on')).toBe(true);
    expect(trough.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-warning)');
    expect(trough.querySelector('.qpm-alert-card__icon--sm img')?.getAttribute('src')).toBe('data:trough');
    expect(trough.querySelector('.qpm-alert-centre-card__name')?.textContent).toBe('Feeding trough');
    expect(plain.classList.contains('qpm-alert-centre-card--on')).toBe(false);
    expect(plain.querySelector('.qpm-alert-card__icon')).toBeNull();
    expect([...root.children].indexOf(plain)).toBe(2);
  });

  it('late sprites repaint through onSpritesReady and the hydration event; destroy detaches both', () => {
    let icon: string | null = null;
    const { root, shell } = mount(look({ icon: () => icon }));
    expect(head(root).querySelector('img')).toBeNull();
    icon = 'data:late';
    spritesReadyCb?.();
    expect(head(root).querySelector('img')?.getAttribute('src')).toBe('data:late');
    icon = 'data:hydrated';
    window.dispatchEvent(new Event(HYDRATION_EVENT));
    expect(head(root).querySelector('img')?.getAttribute('src')).toBe('data:hydrated');
    shell.destroy();
    expect(stopSprites).toHaveBeenCalledTimes(1);
    icon = 'data:after';
    window.dispatchEvent(new Event(HYDRATION_EVENT));
    expect(head(root).querySelector('img')?.getAttribute('src')).toBe('data:hydrated');
  });

  it('createColorDot paints the given colour', () => {
    expect(createColorDot('var(--qpm-gold)').style.background).toBe('var(--qpm-gold)');
  });
});
