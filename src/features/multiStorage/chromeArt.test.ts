import { describe, expect, it } from 'vitest';

import { drawHeader, headerArtHeight, type HeaderContext, type HeaderJoin } from './chromeArt';
import { HEADER_HEIGHT_PX } from './layout';

const COLORS = { light: 'L', wood: 'W', edge: 'E', inner: 'I' };

/** Records each drawing call with the fill colour current at the time. */
function recorder(): { ctx: HeaderContext; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { fillStyle: '' };
  const log = (name: string) => (...args: unknown[]): void => { calls.push(`${name}(${JSON.stringify(args)})@${String(state.fillStyle)}`); };
  const ctx = new Proxy(state, {
    get: (target, key: string) => (key in target ? target[key] : log(key)),
    set: (target, key: string, value: unknown) => { target[key] = value; return true; },
  }) as unknown as HeaderContext;
  return { ctx, calls };
}

function draw(join?: HeaderJoin | null): string[] {
  const { ctx, calls } = recorder();
  drawHeader(ctx, 200, 'Seed Shop', COLORS, 8, 'F', join);
  return calls;
}

describe('panel header art', () => {
  const h = HEADER_HEIGHT_PX;

  it('without a join: the body rounds only its top corners and nothing is drawn below the header', () => {
    const calls = draw(null);
    expect(calls.slice(0, 3)).toEqual(['beginPath([])@W', `roundRect([0,0,200,${h + 12},8])@W`, 'fill([])@W']);
    expect(calls.some(c => c.startsWith('clip') || c.startsWith('save'))).toBe(false);
    expect(calls.some(c => c.startsWith(`fillRect([0,${h},`))).toBe(false);
    expect(headerArtHeight(null)).toBe(h);
  });

  it('with a join: a foot in the panel colour below, top corners at the join radius, highlight clipped to the body', () => {
    const calls = draw({ radius: 15, color: 'rgb(8, 107, 49)' });
    expect(calls[0]).toBe(`fillRect([0,${h},200,15])@rgb(8, 107, 49)`);
    expect(calls.slice(1, 6)).toEqual([
      'beginPath([])@W', `roundRect([0,0,200,${h},[15,15,0,0]])@W`, 'fill([])@W', 'save([])@W', 'clip([])@W',
    ]);
    const highlight = calls.findIndex(c => c.endsWith('@L'));
    const edge = calls.findIndex(c => c.startsWith(`fillRect([0,${h - 1},200,1])`));
    const restore = calls.findIndex(c => c.startsWith('restore'));
    expect(highlight).toBeGreaterThan(5);
    expect(edge).toBeGreaterThan(highlight);
    expect(restore).toBeGreaterThan(edge);
    expect(calls.at(-1)).toMatch(/^fillText\(\["Seed Shop",26,/);
    expect(headerArtHeight({ radius: 15, color: 'x' })).toBe(h + 15);
  });
});
