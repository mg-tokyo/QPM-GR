import { describe, expect, it } from 'vitest';
import { NEUTRAL_COLORS } from '../multiStorage/chromeArt';
import { defaultCells, movedCell } from '../multiStorage/layout';
import type { ShopPanelView } from './panelView';
import { SHOP_FIT, shopBarColors, shopHeaderJoin, shopMetrics, shopTitle } from './shopChrome';

function view(over: Record<string, unknown>): ShopPanelView {
  return { isOpen: true, modalScreenX: 40, modalScreenY: 60, modalScreenW: 300, frame: { contentContainer: { hitArea: { height: 500 } } }, ...over } as unknown as ShopPanelView;
}

describe('multi-shop bar title', () => {
  it('splits the modal name into capitalised words', () => {
    expect(shopTitle('seedShop')).toBe('Seed Shop');
    expect(shopTitle('dawnShop')).toBe('Dawn Shop');
    expect(shopTitle('shop')).toBe('Shop');
  });
});

describe('multi-shop bar colours', () => {
  it('shades the shop header colour, darker for the body than the highlight', () => {
    const colors = shopBarColors(0x86b0f1);
    expect(colors.wood).toBe(`rgb(${Math.round(0x86 * 0.78)}, ${Math.round(0xb0 * 0.78)}, ${Math.round(0xf1 * 0.78)})`);
    expect(colors.light).toBe(`rgb(${Math.round(0x86 * 1.15)}, ${Math.round(0xb0 * 1.15)}, 255)`);
  });

  it('falls back to the neutral bar when the config has no usable colour', () => {
    expect(shopBarColors(undefined)).toBe(NEUTRAL_COLORS);
    expect(shopBarColors('#fff')).toBe(NEUTRAL_COLORS);
    expect(shopBarColors(Number.NaN)).toBe(NEUTRAL_COLORS);
  });
});

describe('multi-shop bar join', () => {
  const framed = (options: unknown, headerColor: unknown = 0x0d6b31): ShopPanelView =>
    view({ frame: { contentContainer: { hitArea: { height: 500 } }, options }, shopConfig: { headerColor } });

  it("takes the frame's corner radius and its header band colour", () => {
    expect(shopHeaderJoin(framed({ cornerRadius: 15, headerBand: { color: 0xd5980d } }))).toEqual({ radius: 15, color: 'rgb(213, 152, 13)' });
  });

  it("falls back to the config's header colour when the frame has no band colour", () => {
    expect(shopHeaderJoin(framed({ cornerRadius: 15 }))).toEqual({ radius: 15, color: 'rgb(13, 107, 49)' });
  });

  it('is null when the radius or the colour cannot be read', () => {
    expect(shopHeaderJoin(framed(null))).toBeNull();
    expect(shopHeaderJoin(framed({ cornerRadius: 0, headerBand: { color: 1 } }))).toBeNull();
    expect(shopHeaderJoin(framed({ cornerRadius: '15', headerBand: { color: 1 } }))).toBeNull();
    expect(shopHeaderJoin(framed({ cornerRadius: 15 }, null))).toBeNull();
  });
});

describe('multi-shop panel metrics', () => {
  it('places the bar on the visible shop: its left, top and height inside the cell', () => {
    expect(shopMetrics(view({}))).toEqual({ left: 40, width: 300, top: 60, y: 60, height: 500 });
  });

  it('is null until the shop is open and laid out', () => {
    expect(shopMetrics(view({ isOpen: false }))).toBeNull();
    expect(shopMetrics(view({ modalScreenW: 0 }))).toBeNull();
    expect(shopMetrics(view({ frame: null }))).toBeNull();
  });
});

describe('multi-shop fit', () => {
  it('lays four shops side by side, and shortens one pushed towards the bottom', () => {
    const screen = { w: 1278, h: 700 };
    const cells = defaultCells(4, 90, screen, SHOP_FIT);
    expect(cells.map(c => c.x)).toEqual([90, 387, 684, 981]);
    expect(movedCell(cells[0] ?? { x: 0, y: 0, w: 0, h: 0 }, 0, 200, screen, SHOP_FIT).h).toBe(500);
  });
});
