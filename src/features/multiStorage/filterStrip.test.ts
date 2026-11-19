import { describe, expect, it, vi } from 'vitest';
import type { PixiBounds, PixiNode } from './gameHooks';

let strips: PixiNode[] = [];
vi.mock('../../core/pixiScene', () => ({
  walkScene: (_root: unknown, visit: (node: PixiNode) => boolean | void) => {
    for (const node of strips) if (visit(node) === true) return;
  },
}));

const { createStripFitter, fitFilterStrip, stripKey } = await import('./filterStrip');

function node(label: string, bounds: PixiBounds, children: PixiNode[] = []): PixiNode & { getBounds: ReturnType<typeof vi.fn> } {
  const n = {
    label, x: 0, y: 0, zIndex: 0, visible: true, renderable: true, destroyed: false, sortableChildren: false, children,
    scale: { x: 1, y: 1, set(value: number) { this.x = value; this.y = value; } },
    pivot: { x: 0, y: 0 },
    addChild: () => undefined, removeFromParent: () => undefined, destroy: () => undefined,
    getBounds: vi.fn(() => bounds),
    getGlobalPosition: () => ({ x: 0, y: 0 }),
  };
  return n;
}

/** A strip 200 px wide whose controls end at `contentRight`, with a 26 px reset button. */
type FakeNode = ReturnType<typeof node>;
function makeStrip(contentRight: number): { strip: FakeNode; backdrop: FakeNode; reset: FakeNode } {
  const backdrop = node('Backdrop', { x: 0, y: 0, width: 200, height: 60 });
  const sort = node('Sort', { x: 6, y: 0, width: contentRight - 6, height: 40 });
  const reset = node('Reset', { x: 168, y: 0, width: 26, height: 26 });
  const strip = node('FilterContainer', { x: 0, y: 0, width: 200, height: 60 }, [backdrop, sort, reset]);
  return { strip, backdrop, reset };
}

const host = node('Host', { x: 0, y: 0, width: 0, height: 0 });

describe('fitFilterStrip', () => {
  it('leaves a strip that fits at scale 1 with its reset button shown', () => {
    const { strip, reset } = makeStrip(120);
    fitFilterStrip(strip);
    expect(strip.scale.x).toBe(1);
    expect(reset.renderable).toBe(true);
  });

  it('shrinks a crowded strip and hides the reset button', () => {
    const { strip, reset } = makeStrip(300);
    fitFilterStrip(strip);
    expect(strip.scale.x).toBeCloseTo(200 / 310, 3);
    expect(reset.renderable).toBe(false);
  });
});

describe('stripKey', () => {
  it('changes with sheet width, child count and child visibility, not with the fit', () => {
    const { strip, reset } = makeStrip(300);
    const before = stripKey(strip, 400);
    fitFilterStrip(strip);
    expect(stripKey(strip, 400)).toBe(before);
    expect(stripKey(strip, 380)).not.toBe(before);
    reset.visible = false;
    expect(stripKey(strip, 400)).not.toBe(before);
    reset.visible = true;
    strip.children.push(node('Tooltip', { x: 0, y: 0, width: 0, height: 0 }));
    expect(stripKey(strip, 400)).not.toBe(before);
  });
});

describe('createStripFitter', () => {
  it('measures for a few frames after a change, then not at all while the strip sits still', () => {
    const { strip, backdrop } = makeStrip(300);
    strips = [strip];
    let width = 400;
    const fit = createStripFitter(host, () => width);
    for (let i = 0; i < 10; i += 1) fit();
    expect(backdrop.getBounds).toHaveBeenCalledTimes(3);
    width = 300;
    for (let i = 0; i < 10; i += 1) fit();
    expect(backdrop.getBounds).toHaveBeenCalledTimes(6);
  });

  it('finds the strip again once the game rebuilt it', () => {
    const first = makeStrip(300).strip;
    strips = [first];
    const fit = createStripFitter(host, () => 400);
    fit();
    first.destroyed = true;
    const second = makeStrip(300).strip;
    strips = [second];
    fit();
    expect(second.scale.x).toBeLessThan(1);
  });

  it('does nothing until the strip is built', () => {
    strips = [];
    const fit = createStripFitter(host, () => 400);
    expect(() => fit()).not.toThrow();
  });
});
