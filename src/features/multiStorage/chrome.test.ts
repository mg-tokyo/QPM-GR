import { describe, expect, it } from 'vitest';

import { createPanelChrome, type ChromePanel, type PanelKind } from './chrome';
import type { GameRenderer, PixiNode } from './gameHooks';
import { STORAGE_FIT, type SavedLayout } from './layout';

function panel(id: string, index: number): ChromePanel {
  const host = { label: id, zIndex: 5, x: 0, y: 0, destroyed: false, children: [] } as unknown as PixiNode;
  return { id, index, host, cell: { x: 100 * index, y: 0, w: 300, h: 600 } };
}

function kind(saved: SavedLayout = {}): PanelKind<ChromePanel> {
  return {
    fit: STORAGE_FIT,
    labels: { header: 'H', grip: 'G' },
    metrics: () => null,
    requestReflow: () => undefined,
    rootZ: () => 0,
    title: p => p.id,
    colors: () => null,
    layout: { get: () => saved, save: () => undefined },
  };
}

// No `toLocal` on the UI: the chrome runs undecorated (no sprites), which is all `add` needs.
function chrome(panels: ChromePanel[], orders: Array<readonly string[]>, panelKind: PanelKind<ChromePanel> = kind()) {
  return createPanelChrome({
    ui: { children: [] } as unknown as PixiNode,
    real: { width: 1200, height: 600 } as unknown as GameRenderer,
    screen: { w: 1200, h: 600 },
    panels,
    kind: panelKind,
    isLive: () => true,
    onOrder: order => { orders.push([...order]); },
  });
}

describe('createPanelChrome width snap (a kind with snapWidth)', () => {
  const settled = (snapWidth?: PanelKind<ChromePanel>['snapWidth']) => {
    const reflows: string[] = [];
    const base = kind();
    const k: PanelKind<ChromePanel> = {
      ...base,
      metrics: () => ({ left: 20, width: 260, top: 60, y: 60, height: 400 }),
      requestReflow: p => { reflows.push(p.id); },
      ...(snapWidth ? { snapWidth } : {}),
    };
    const a = panel('a', 2);
    const c = chrome([a], [], k);
    for (let i = 0; i < 10; i += 1) c.sync();
    return { a, reflows };
  };

  it('widens a settled panel to the snapped width about its centre, once', () => {
    const { a, reflows } = settled((_p, w) => Math.max(w, 400));
    expect(a.cell).toMatchObject({ x: 150, w: 400 });
    expect(reflows).toEqual(['a']);
  });

  it('leaves the cell alone without snapWidth', () => {
    const { a, reflows } = settled();
    expect(a.cell).toMatchObject({ x: 200, w: 300 });
    expect(reflows).toEqual([]);
  });

  it('reflows one panel per frame when several settle together (a shop reflow rebuilds its tiles)', () => {
    const perFrame: string[][] = [];
    let frame: string[] = [];
    const k: PanelKind<ChromePanel> = {
      ...kind(),
      metrics: () => ({ left: 20, width: 260, top: 60, y: 60, height: 400 }),
      requestReflow: p => { frame.push(p.id); },
      snapWidth: (_p, w) => Math.max(w, 400),
    };
    const panels = [panel('a', 1), panel('b', 2), panel('c', 3)];
    const c = chrome(panels, [], k);
    for (let i = 0; i < 12; i += 1) {
      frame = [];
      c.sync();
      if (frame.length > 0) perFrame.push(frame);
    }
    expect(perFrame).toEqual([['a'], ['b'], ['c']]);
    expect(panels.map(p => p.cell.w)).toEqual([400, 400, 400]);
  });
});

describe('createPanelChrome add (a panel opened after the others)', () => {
  it('puts it at the back of the order without taking the front', () => {
    const orders: Array<readonly string[]> = [];
    const a = panel('a', 0);
    const b = panel('b', 1);
    const c = chrome([a, b], orders);
    const late = panel('late', 2);
    c.add(late);
    expect(c.order()).toEqual(['late', 'a', 'b']);
    expect(orders[orders.length - 1]).toEqual(['late', 'a', 'b']);
    expect(late.host.zIndex).toBeLessThan(b.host.zIndex);
  });
  it('can be raised and removed like the others', () => {
    const c = chrome([panel('a', 0)], []);
    c.add(panel('late', 1));
    expect(c.raise('late')).toBe(true);
    expect(c.order()).toEqual(['a', 'late']);
    c.remove('late');
    expect(c.order()).toEqual(['a']);
  });
  it('ignores a panel it already has and anything after dispose', () => {
    const a = panel('a', 0);
    const c = chrome([a], []);
    c.add(a);
    expect(c.order()).toEqual(['a']);
    c.dispose();
    c.add(panel('late', 1));
    expect(c.order()).toEqual(['a']);
  });
});
