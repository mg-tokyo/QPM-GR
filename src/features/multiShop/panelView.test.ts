import { describe, expect, it, vi } from 'vitest';

vi.mock('../../catalogs/logic/gamePanelsCatalog', () => ({ getShopPanelIds: () => null }));
vi.mock('../../core/gameState', () => ({ readSync: () => null, peekModalRequests: () => ({ ok: false, reason: 'no-store' }) }));

import type { PixiNode } from '../multiStorage/gameHooks';
import type { ModalHostLike } from './quietBuild';
import {
  bindCellLayout, bindRealView, checkPanelView, clearScrim, gateKeys, interceptCreate, onHostDestroy, panelBox, unbindRealView,
  type ShopPanelView,
} from './panelView';

interface FakeNode { label: string; zIndex: number; destroyed: boolean; children: FakeNode[]; parent: FakeNode | null; addChild(...nodes: FakeNode[]): void; removeFromParent(): void }

function node(label: string): FakeNode {
  const self: FakeNode = {
    label, zIndex: 0, destroyed: false, children: [], parent: null,
    addChild(...nodes) {
      for (const child of nodes) {
        child.removeFromParent();
        child.parent = self;
        self.children.push(child);
      }
    },
    removeFromParent() {
      if (self.parent) self.parent.children = self.parent.children.filter(c => c !== self);
      self.parent = null;
    },
  };
  return self;
}
const pixi = (n: FakeNode): PixiNode => n as unknown as PixiNode;

class FakeShopView {
  ui = {};
  renderer: unknown = { real: true };
  riveBatchRenderer = {};
  shopConfig = { modalName: 'seedShop' };
  config: Record<string, unknown> = { modalName: 'seedShop', scrimAlpha: 0.6 };
  container = node('ShopModal:seedShop');
  cardView = { container: node('card') };
  isOpen = false;
  layouts: Array<[number, number]> = [];
  keys: string[] = [];
  invalidated = 0;
  handleKeyDown = (event: KeyboardEvent): void => { this.keys.push(event.key); };
  onLayout(w: number, h: number): void { this.layouts.push([w, h]); }
  open(): void { this.isOpen = true; }
  close(): void { this.isOpen = false; }
  draw(): void {}
  destroy(): void {}
  invalidateLayout(): void { this.invalidated += 1; }
}
const asPanel = (view: FakeShopView): ShopPanelView => view as unknown as ShopPanelView;
const key = (name: string): KeyboardEvent => ({ key: name }) as KeyboardEvent;

describe('checkPanelView', () => {
  it('passes a full shop view and names what a panel lacks', () => {
    expect(checkPanelView(new FakeShopView())).toEqual([]);
    const bare = Object.assign(new FakeShopView(), { container: null, config: 0, isOpen: undefined });
    expect(checkPanelView(bare)).toEqual(['view.container', 'view.config', 'view.isOpen']);
    expect(checkPanelView(null)).toEqual(['view']);
  });
});

describe('panel overrides', () => {
  it('lays out with the cell size, following the cell as it changes', () => {
    const view = new FakeShopView();
    const cell = { x: 10, y: 0, w: 300, h: 500 };
    bindCellLayout(asPanel(view), cell);
    view.onLayout(1278, 632);
    cell.w = 420;
    view.onLayout(1278, 632);
    expect(view.layouts).toEqual([[300, 500], [420, 500]]);
  });

  it('passes keys only while the panel may take them', () => {
    const view = new FakeShopView();
    let front = false;
    gateKeys(asPanel(view), () => front);
    view.handleKeyDown(key('ArrowRight'));
    front = true;
    view.handleKeyDown(key('ArrowLeft'));
    expect(view.keys).toEqual(['ArrowLeft']);
  });

  it('clears a copy scrim on a copy of the modal config', () => {
    const view = new FakeShopView();
    const config = view.config;
    clearScrim(asPanel(view));
    expect(view.config).toEqual({ modalName: 'seedShop', scrimAlpha: 0 });
    expect(config.scrimAlpha).toBe(0.6);
  });

  it('reads where the open shop sits; null while closed or not laid out', () => {
    const view = Object.assign(new FakeShopView(), {
      modalScreenX: 12, modalScreenY: 40, modalScreenW: 280, frame: { contentContainer: { hitArea: { height: 500 } } },
    });
    expect(panelBox(asPanel(view))).toBeNull();
    view.isOpen = true;
    expect(panelBox(asPanel(view))).toEqual({ left: 12, top: 40, width: 280, height: 500 });
    view.modalScreenW = 0;
    expect(panelBox(asPanel(view))).toBeNull();
  });
});

describe('the real shop view', () => {
  it('moves into the host, is sized and gated, and is restored by assignment', () => {
    const ui = node('UI');
    const host = node('host');
    const view = new FakeShopView();
    ui.addChild(view.container, view.cardView.container, host);
    const before = { renderer: view.renderer, handleKeyDown: view.handleKeyDown, onLayout: view.onLayout };
    const cellRenderer = { cell: true };
    const front = false;

    const binding = bindRealView(asPanel(view), pixi(host), cellRenderer, { x: 0, y: 0, w: 320, h: 600 }, () => front);
    expect(host.children).toEqual([view.container, view.cardView.container]);
    expect(view.renderer).toBe(cellRenderer);
    view.onLayout(1278, 632);
    view.handleKeyDown(key('ArrowRight'));
    expect(view.layouts).toEqual([[320, 600]]);
    expect(view.keys).toEqual([]);

    unbindRealView(binding, pixi(ui));
    expect(view.renderer).toBe(before.renderer);
    expect(view.handleKeyDown).toBe(before.handleKeyDown);
    expect(view.onLayout).toBe(before.onLayout);
    expect(view.onLayout).toBe(FakeShopView.prototype.onLayout);
    expect(host.children).toEqual([]);
    expect(ui.children).toEqual([host, view.container, view.cardView.container]);
    expect(view.invalidated).toBe(1);
  });

  it('leaves a view the renderer already destroyed out of the UI', () => {
    const ui = node('UI');
    const host = node('host');
    const view = new FakeShopView();
    const binding = bindRealView(asPanel(view), pixi(host), {}, { x: 0, y: 0, w: 1, h: 1 }, () => true);
    view.container.destroyed = true;
    view.cardView.container.destroyed = true;
    unbindRealView(binding, pixi(ui));
    expect(ui.children).toEqual([]);
    expect(view.handleKeyDown).toBe(binding.handleKeyDown);
  });
});

describe('interceptCreate', () => {
  function makeModals(active: () => string | null): { modals: ModalHostLike; created: string[] } {
    const created: string[] = [];
    const modals: ModalHostLike = {
      built: new Map(),
      draw: () => {},
      read: () => {
        const name = active();
        return name === null ? null : Object.assign({ create: () => { created.push(name); return { name }; } }, { key: name, name });
      },
    };
    return { modals, created };
  }

  it('hands the view built for the named shop to the callback before it is returned, keeping the request fields', () => {
    let active: string | null = 'seedShop';
    const { modals, created } = makeModals(() => active);
    const read = modals.read;
    const seen: unknown[] = [];
    const restore = interceptCreate(modals, 'seedShop', view => seen.push(view));

    const request = modals.read?.() as unknown as { key: string; name: string; create(): unknown };
    expect(request).toMatchObject({ key: 'seedShop', name: 'seedShop' });
    expect(seen).toEqual([]);
    const view = request.create();
    expect(seen).toEqual([view]);
    expect(created).toEqual(['seedShop']);

    active = 'eggShop';
    (modals.read?.() as { create(): unknown }).create();
    active = null;
    expect(modals.read?.()).toBeNull();
    expect(seen).toHaveLength(1);

    restore();
    expect(modals.read).toBe(read);
  });

  it('leaves a later wrapper in place and does nothing without read', () => {
    const { modals } = makeModals(() => null);
    const restore = interceptCreate(modals, 'seedShop', () => {});
    const later = (): null => null;
    modals.read = later;
    restore();
    expect(modals.read).toBe(later);

    const bare: ModalHostLike = { built: new Map(), draw: () => {} };
    interceptCreate(bare, 'seedShop', () => {})();
    expect('read' in bare).toBe(false);
  });
});

describe('onHostDestroy', () => {
  function makeHost(calls: string[]): ModalHostLike {
    const modals: ModalHostLike = {
      built: new Map(),
      draw: () => {},
      destroy(this: unknown) { calls.push(this === modals ? 'game:host' : 'game:other'); },
    };
    return modals;
  }

  it('runs the callback before the game destroy, which still runs on the host', () => {
    const calls: string[] = [];
    const modals = makeHost(calls);
    const original = modals.destroy;
    const restore = onHostDestroy(modals, () => { calls.push('session'); restore(); });
    expect(modals.destroy).not.toBe(original);

    modals.destroy?.();
    expect(calls).toEqual(['session', 'game:host']);
    expect(modals.destroy).toBe(original);
  });

  it('leaves a later wrapper in place and does nothing without destroy', () => {
    const modals = makeHost([]);
    const restore = onHostDestroy(modals, () => {});
    const later = (): void => {};
    modals.destroy = later;
    restore();
    expect(modals.destroy).toBe(later);

    const bare: ModalHostLike = { built: new Map(), draw: () => {} };
    onHostDestroy(bare, () => {})();
    expect('destroy' in bare).toBe(false);
  });
});
