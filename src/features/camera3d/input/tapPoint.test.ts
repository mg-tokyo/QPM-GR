import { describe, expect, it } from 'vitest';
import { chooseTapPoint, type TapHit } from './tapPoint';

const at = (x: number, y: number): { x: number; y: number } => ({ x, y });
// A plant on tile (10, 20): its foot is on the tile's sort line, the tapped pixel is high on its art (two rows north).
const plant: TapHit = { building: false, sprite: at(2600, 4700), foot: at(2620, 5300) };
const inRect = (x0: number, y0: number, x1: number, y1: number) => (p: { x: number; y: number }): boolean =>
  p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1;

describe('chooseTapPoint', () => {
  it('a building taps the pixel under the cursor (its claim tests the sprite there)', () => {
    const b: TapHit = { building: true, sprite: at(100, 200), foot: at(150, 900) };
    expect(chooseTapPoint(b, at(0, 0), () => true)).toEqual(at(100, 200));
    expect(chooseTapPoint(b, null, null)).toEqual(at(100, 200));
  });

  it('elsewhere, an unclaimed foot point taps the foot (tap-to-move walks to the plant tile)', () => {
    expect(chooseTapPoint(plant, at(3, 3), () => false)).toEqual(plant.foot);
  });

  it('without the claim resolver (game drift) it keeps the foot point', () => {
    expect(chooseTapPoint(plant, at(10, 20), null)).toEqual(plant.foot);
  });

  it('on your own tile, a claimed pixel taps that pixel: the focused plant picks the crop you tapped', () => {
    const claimed = inRect(2500, 4600, 2700, 4800);
    expect(chooseTapPoint(plant, at(10, 20), claimed)).toEqual(plant.sprite);
  });

  it('on your own tile, an unclaimed pixel still taps the foot, so the avatar does not walk two rows north', () => {
    expect(chooseTapPoint(plant, at(10, 20), () => false)).toEqual(plant.foot);
  });

  it('on your own tile, an unclaimed pixel over a claimed foot taps the foot: the plant body still picks the plant', () => {
    const body = inRect(2500, 5200, 2700, 5400);
    expect(chooseTapPoint(plant, at(10, 20), body)).toEqual(plant.foot);
  });

  it('a claimed pixel off your tile is someone else\'s claim (a building art over the plant in 2D): tap the foot', () => {
    expect(chooseTapPoint(plant, at(3, 3), inRect(2500, 4600, 2700, 4800))).toEqual(plant.foot);
  });

  it('a foot covered by a claim moves to the first uncovered point of the same tile', () => {
    // A shop roof covers the south half of tile (10, 20) in 2D.
    const roof = inRect(0, 5248, 9999, 9999);
    const p = chooseTapPoint(plant, at(3, 3), roof);
    expect(roof(p)).toBe(false);
    expect([Math.floor(p.x / 256), Math.floor(p.y / 256)]).toEqual([10, 20]);
  });

  it('a tile covered everywhere falls back to the foot', () => {
    expect(chooseTapPoint(plant, at(3, 3), () => true)).toEqual(plant.foot);
  });
});
