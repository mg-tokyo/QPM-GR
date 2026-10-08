// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../features/camera3d', async () => ({
  ...(await import('../../features/camera3d/settings')),
  getCamera3dView: () => ({ paused: false }),
  onCamera3dViewChange: () => () => undefined,
  retryCamera3d: () => undefined,
}));
vi.mock('../components', async () => ({
  ...(await import('../components/button')),
  ...(await import('../components/toggle')),
  ...(await import('../components/pillTabs')),
  ...(await import('../components/sliderRow')),
}));
vi.mock('../core/modalWindow', () => ({
  closeWindow: () => undefined, destroyWindow: () => undefined, isWindowOpen: () => false, openWindow: () => undefined,
  windowLog: { warn: () => undefined },
}));

import { getCamera3dSettings, onCamera3dSettingsChange, setCamera3dSetting } from '../../features/camera3d/settings';
import { createCamera3dSection } from './camera3dSection';

const PRESET_PILLS = [
  'feature.camera3d.graphics.low', 'feature.camera3d.graphics.medium', 'feature.camera3d.graphics.high',
  'feature.camera3d.graphics.ultra', 'feature.camera3d.graphics.custom',
];
const GRAPHICS = PRESET_PILLS[0]!;

/** Pill rows in DOM order: buttons grouped by their row element (the card's other buttons are switches, Reset and Retry). */
function pillRows(root: HTMLElement): HTMLButtonElement[][] {
  const rows = new Map<Element, HTMLButtonElement[]>();
  for (const b of root.querySelectorAll('button')) {
    const text = b.textContent ?? '';
    if (!b.parentElement || b.getAttribute('role') === 'switch') continue;
    if (text === 'feature.camera3d.reset' || text === 'feature.camera3d.retry') continue;
    const list = rows.get(b.parentElement) ?? [];
    list.push(b);
    rows.set(b.parentElement, list);
  }
  return [...rows.values()];
}

const lit = (row: HTMLButtonElement[]): string | null => row.find((b) => b.style.fontWeight === '600')?.textContent ?? null;
const litAll = (root: HTMLElement): (string | null)[] => pillRows(root).map(lit);
const rowOf = (root: HTMLElement, first: string): HTMLButtonElement[] => {
  const row = pillRows(root).find((r) => r[0]?.textContent === first);
  if (!row) throw new Error(`no pill row starting ${first}`);
  return row;
};
const click = (row: HTMLButtonElement[], label: string): void => {
  const b = row.find((x) => x.textContent === label);
  if (!b) throw new Error(`no pill ${label}`);
  b.click();
};
const texts = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('div')].filter((d) => d.children.length === 0).map((d) => d.textContent ?? '');

describe('camera3d card: graphics presets and rows', () => {
  beforeEach(() => mem.clear());

  it('renders Graphics, its pills, the lit caption and the four rows in order, High lit by default', () => {
    const { root } = createCamera3dSection();
    expect(pillRows(root).map((r) => r.map((b) => b.textContent))).toEqual([
      PRESET_PILLS,
      ['feature.camera3d.detail.closest', 'feature.camera3d.detail.near', 'feature.camera3d.detail.medium', 'feature.camera3d.detail.far'],
      ['common.off', 'common.on'],
      ['feature.camera3d.ground.low', 'feature.camera3d.ground.high'],
      ['feature.camera3d.weather3d.simple', 'feature.camera3d.weather3d.full'],
    ]);
    expect(litAll(root)).toEqual([
      'feature.camera3d.graphics.high', 'feature.camera3d.detail.medium', 'common.on', 'feature.camera3d.ground.high',
      'feature.camera3d.weather3d.full',
    ]);
    const order = texts(root);
    const seq = [
      'feature.camera3d.graphics', 'feature.camera3d.graphicsCaption.high', 'feature.camera3d.detail', 'feature.camera3d.detailCaption',
      'feature.camera3d.farAnim', 'feature.camera3d.ground', 'feature.camera3d.weather3d', 'feature.camera3d.help',
    ].map((s) => order.indexOf(s));
    expect(seq.every((i) => i >= 0)).toBe(true);
    expect([...seq].sort((x, y) => x - y)).toEqual(seq);
  });

  it('a preset pick sets the four rows with one change event and relights everything', () => {
    const { root } = createCamera3dSection();
    let events = 0;
    const off = onCamera3dSettingsChange(() => { events++; });
    click(rowOf(root, GRAPHICS), 'feature.camera3d.graphics.low');
    off();
    expect(events).toBe(1);
    const s = getCamera3dSettings();
    expect([s.detail, s.farAnim, s.ground, s.weather3d]).toEqual(['closest', 'off', 'low', 'simple']);
    expect(litAll(root)).toEqual([
      'feature.camera3d.graphics.low', 'feature.camera3d.detail.closest', 'common.off', 'feature.camera3d.ground.low',
      'feature.camera3d.weather3d.simple',
    ]);
    expect(texts(root)).toContain('feature.camera3d.graphicsCaption.low');
    expect(texts(root)).not.toContain('feature.camera3d.graphicsCaption.high');
  });

  it('a row change lights Custom, or the preset it lands on', () => {
    const { root } = createCamera3dSection();
    click(rowOf(root, 'feature.camera3d.ground.low'), 'feature.camera3d.ground.low');
    expect(getCamera3dSettings().ground).toBe('low');
    expect(lit(rowOf(root, GRAPHICS))).toBe('feature.camera3d.graphics.custom');
    expect(texts(root)).toContain('feature.camera3d.graphicsCaption.custom');
    click(rowOf(root, 'feature.camera3d.ground.low'), 'feature.camera3d.ground.high');
    click(rowOf(root, 'feature.camera3d.detail.closest'), 'feature.camera3d.detail.far');
    expect(lit(rowOf(root, GRAPHICS))).toBe('feature.camera3d.graphics.ultra');
    click(rowOf(root, 'common.off'), 'common.off');
    expect(getCamera3dSettings().farAnim).toBe('off');
  });

  it('clicking Custom writes nothing and emits nothing', () => {
    const { root } = createCamera3dSection();
    let events = 0;
    const off = onCamera3dSettingsChange(() => { events++; });
    click(rowOf(root, GRAPHICS), 'feature.camera3d.graphics.custom');
    off();
    expect(events).toBe(0);
    expect(mem.size).toBe(0);
  });

  it('a stored legacy detail lights the preset it matches (near → Medium)', () => {
    mem.set('qpm.camera3d.detail.v1', 'near');
    const { root } = createCamera3dSection();
    expect(lit(rowOf(root, GRAPHICS))).toBe('feature.camera3d.graphics.medium');
  });

  it('every pill row is disabled while Enabled is off, and comes back with it', () => {
    const { root } = createCamera3dSection();
    setCamera3dSetting('enabled', false);
    const rows = pillRows(root);
    expect(rows).toHaveLength(5);
    for (const row of rows) for (const b of row) expect(b.disabled).toBe(true);
    setCamera3dSetting('enabled', true);
    for (const row of pillRows(root)) for (const b of row) expect(b.disabled).toBe(false);
  });

  it('a second open copy follows a change made in the first, and stops after destroy', () => {
    const a = createCamera3dSection();
    const b = createCamera3dSection();
    click(rowOf(a.root, GRAPHICS), 'feature.camera3d.graphics.ultra');
    expect(lit(rowOf(b.root, GRAPHICS))).toBe('feature.camera3d.graphics.ultra');
    expect(lit(rowOf(b.root, 'feature.camera3d.detail.closest'))).toBe('feature.camera3d.detail.far');
    b.destroy();
    click(rowOf(a.root, GRAPHICS), 'feature.camera3d.graphics.low');
    expect(lit(rowOf(b.root, GRAPHICS))).toBe('feature.camera3d.graphics.ultra');
    a.destroy();
  });
});
