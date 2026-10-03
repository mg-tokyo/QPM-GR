import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import { AREA_MARK_Z } from '../math/depth';
import { createLayerHandler } from './layers';

function layerWorld() {
  const world = new FakeNode();
  const detached: FakeNode[] = [];
  // Methods take a typed `this` (layers.ts calls L.detach(...)): a self-reference here would be TS 7022.
  const layer = Object.assign(new FakeNode(), {
    renderLayerChildren: [] as FakeNode[],
    detach(this: { renderLayerChildren: FakeNode[] }, ...n: FakeNode[]) {
      for (const x of n) { detached.push(x); this.renderLayerChildren.splice(this.renderLayerChildren.indexOf(x), 1); Object.assign(x, { parentRenderLayer: null }); }
    },
    attach(this: { renderLayerChildren: FakeNode[] }, ...n: FakeNode[]) { this.renderLayerChildren.push(...n); },
  });
  world.addChild(layer);
  const onLayer = (n: FakeNode): FakeNode => { layer.renderLayerChildren.push(n); Object.assign(n, { parentRenderLayer: layer }); return n; };
  return { world, layer, detached, onLayer };
}

function ctxFor(world: FakeNode) {
  const puts: Array<[string, unknown, unknown]> = [];
  const drops: Array<[string, unknown]> = [];
  const ov = { put: (k: string, n: unknown, v: unknown) => { puts.push([k, n, v]); }, drop: (k: string, n: unknown) => { drops.push([k, n]); }, gameValue: () => 0 };
  const ctx = { ov, reCull: true, roll: -1, exactKeys: false, caps: { scene: { world: world.node } } } as unknown as FrameCtx;
  return { ctx, puts, drops };
}

describe('createLayerHandler: tile-radius area marks', () => {
  it('keeps area grids on the layer at the area slot and detaches the rest', () => {
    const { world, layer, detached, onLayer } = layerWorld();
    const tile = world.addChild(new FakeNode(5120, 3840));
    const area = tile.addChild(new FakeNode()).addChild(new FakeNode());
    const grid = [area.addChild(new FakeNode(-256, 0).withTexture(256, 256, 0.5)), area.addChild(new FakeNode(256, 0).withTexture(256, 256, 0.5))];
    grid.forEach(onLayer);
    const dirt = onLayer(tile.addChild(new FakeNode()).addChild(new FakeNode().withTexture(144, 127, 0.5)));
    const { ctx, puts } = ctxFor(world);
    const h = createLayerHandler();
    h.adopt(ctx);
    expect(detached).toEqual([dirt]);
    expect(layer.renderLayerChildren).toEqual(grid);
    expect(puts).toContainEqual(['zIndex', layer.node, AREA_MARK_Z]);
    expect(h.isAreaMark(grid[0]!.node)).toBe(true);
    // The lifter's stand-row scan skips layer content, kept marks included.
    expect(h.isLayerNode(grid[1]!.node)).toBe(true);
    h.drop();
    expect(layer.renderLayerChildren.length).toBe(3);
  });

  it('releases the layer slot when nothing is kept', () => {
    const { world, layer, onLayer } = layerWorld();
    onLayer(world.addChild(new FakeNode(10, 10)).addChild(new FakeNode().withTexture(16, 16, 0.5)));
    const { ctx, drops } = ctxFor(world);
    createLayerHandler().adopt(ctx);
    expect(drops).toContainEqual(['zIndex', layer.node]);
  });
});
