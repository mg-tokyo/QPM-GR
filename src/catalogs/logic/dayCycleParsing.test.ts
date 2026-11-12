import { describe, expect, it } from 'vitest';
import {
  CHANCE_CAP_MARKER, DAY_CYCLE_MARKER, NOCTURNAL_BONUS_MARKER,
  compareStageKeys, parseChanceCap, parseDayCycleStages, parseNocturnalBonus,
} from './dayCycleParsing';

// Build 1989 excerpts (debug Chrome, 2026-11-11): subscribeAtom-M3y3EZnC.js, tools-BFH_ahrq.js, WorldTapRouting-CCaG8iu7.js.
const CYCLE_1989 = 'function ke(e){return De[e].groupId===M.Lunar}var Ae={day:210,sunset:10,midnight:10,sunrise:10},je=Object.values(Ae).reduce((e,t)=>e+t,0),F=je*6e4;function Me(e){let t=e%1;return t<0?t+1:t}';
const BONUS_1989 = 'function Ne(e){return P(e)===`mapBoundsOnly`}var F={day:0,sunset:15,midnight:20,sunrise:10};F.midnight;function I(e){return M[e].isNocturnal===!0}function L(e,t){return I(e)?F[t]:0}';
const CAP_1989 = 'e.hitArea=new w(0,0,l,f)}var ct=.99;function lt(e){return Number.isNaN(e)?0:Math.min(1,Math.max(0,e))}function ut(e){return Math.min(ct,lt(e))}function dt(e){return ut(e/100)*100}';
const COLOUR_TABLE = 'var Wt={day:2250622,sunset:16744272,midnight:1118481,sunrise:16766720};';

describe('dayCycleParsing', () => {
  it('reads the 1989 cycle, bonus and cap', () => {
    expect(parseDayCycleStages(CYCLE_1989)).toEqual([
      { id: 'day', minutes: 210 }, { id: 'sunset', minutes: 10 }, { id: 'midnight', minutes: 10 }, { id: 'sunrise', minutes: 10 },
    ]);
    expect(parseNocturnalBonus(BONUS_1989)).toEqual({ day: 0, sunset: 15, midnight: 20, sunrise: 10 });
    expect(parseChanceCap(CAP_1989)).toBe(0.99);
  });

  it('markers are non-global and hit the same text the parsers read', () => {
    for (const m of [DAY_CYCLE_MARKER, NOCTURNAL_BONUS_MARKER, CHANCE_CAP_MARKER]) expect(m.global).toBe(false);
    expect(DAY_CYCLE_MARKER.test(CYCLE_1989)).toBe(true);
    expect(NOCTURNAL_BONUS_MARKER.test(BONUS_1989)).toBe(true);
    expect(CHANCE_CAP_MARKER.test(CAP_1989)).toBe(true);
  });

  it('lets an extra stage and changed numbers flow through', () => {
    const cycle = CYCLE_1989.replace('sunrise:10}', 'sunrise:12,dusk:5}').replace('day:210', 'day:180');
    expect(parseDayCycleStages(cycle)?.map((s) => [s.id, s.minutes])).toEqual([
      ['day', 180], ['sunset', 10], ['midnight', 10], ['sunrise', 12], ['dusk', 5],
    ]);
    const bonus = BONUS_1989.replace('midnight:20', 'midnight:25').replace('sunrise:10}', 'sunrise:10,dusk:5}');
    expect(parseNocturnalBonus(bonus)).toEqual({ day: 0, sunset: 15, midnight: 25, sunrise: 10, dusk: 5 });
    expect(parseChanceCap(CAP_1989.replace('ct=.99', 'ct=0.95'))).toBe(0.95);
    expect(parseChanceCap(CAP_1989.replace(/\bct\b/g, '$q'))).toBe(0.99);
  });

  it('returns null when a marker is missing', () => {
    expect(parseDayCycleStages(CYCLE_1989.replace('Object.values(Ae)', 'Object.keys(Ae)'))).toBeNull();
    expect(parseDayCycleStages(CYCLE_1989.replace('Object.values(Ae)', 'Object.values(Zz)'))).toBeNull();
    expect(parseNocturnalBonus(BONUS_1989.replace('isNocturnal', 'isDiurnal'))).toBeNull();
    expect(parseChanceCap(CAP_1989.replace('Math.min(ct,', 'Math.min(1,'))).toBeNull();
    expect(parseDayCycleStages('')).toBeNull();
  });

  it('ignores the bare stage shape without its context (the colour table)', () => {
    expect(parseDayCycleStages(COLOUR_TABLE)).toBeNull();
    expect(parseNocturnalBonus(COLOUR_TABLE)).toBeNull();
    expect(parseNocturnalBonus(COLOUR_TABLE + BONUS_1989)).toEqual({ day: 0, sunset: 15, midnight: 20, sunrise: 10 });
  });

  it('rejects an out-of-range cap and an all-zero cycle', () => {
    expect(parseChanceCap(CAP_1989.replace('ct=.99', 'ct=1.5'))).toBeNull();
    expect(parseDayCycleStages(CYCLE_1989.replace('day:210,sunset:10,midnight:10,sunrise:10', 'day:0,sunset:0'))).toBeNull();
  });

  it('reports stage-key differences between the cycle and the bonus table', () => {
    const stages = parseDayCycleStages(CYCLE_1989.replace('sunrise:10}', 'sunrise:10,dusk:5}'));
    expect(stages).not.toBeNull();
    expect(compareStageKeys(stages ?? [], { day: 0, sunset: 15, midnight: 20, sunrise: 10, eclipse: 30 })).toEqual({
      missingInBonus: ['dusk'], extraInBonus: ['eclipse'],
    });
  });

  it('stays linear on long numeric object literals with no stage key (1989 hang regression)', () => {
    const pairs = Array.from({ length: 60 }, (_, i) => `k${i}:${123456 + i}`).join(',');
    const text = `var Q={${pairs}},R={${pairs}};var Z={${pairs}}isNocturnal`;
    const start = Date.now();
    for (const m of [DAY_CYCLE_MARKER, NOCTURNAL_BONUS_MARKER, CHANCE_CAP_MARKER]) expect(m.test(text)).toBe(false);
    expect(Date.now() - start).toBeLessThan(200);
  });
});
