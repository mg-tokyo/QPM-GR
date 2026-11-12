import { describe, expect, it } from 'vitest';
import { CRYSTAL_MODIFIER_MARKER, parseCrystalModifiers } from './crystalModifierParsing';

// Build 1989 excerpt (debug Chrome, 2026-11-11): inventoryAtoms-Dvm8BekO.js.
const MOD_1989 = 'function lt(e,t){return ct(e).filter(({crystal:e})=>e.crystalType===t&&e.remainingActiveSeconds>0).length}'
  + 'var ut={hungerRateMultiplier:1,xpRateMultiplier:1,strengthBonus:0};'
  + 'function dt(e){let t=new Set;for(let{crystal:n}of ct(e))n.remainingActiveSeconds>0&&t.add(n.crystalType);'
  + 'return{hungerRateMultiplier:t.has(`Hunger`)?.9:1,xpRateMultiplier:t.has(`XP`)?1.1:1,strengthBonus:t.has(`Strength`)?10:0}}'
  + 'globalThis.jotaiAtomCache=globalThis.jotaiAtomCache||{cache:new Map};';

describe('crystalModifierParsing', () => {
  it('reads the 1989 modifier table', () => {
    expect(parseCrystalModifiers(MOD_1989)).toEqual({
      hungerRateMultiplier: { crystalType: 'Hunger', active: 0.9, inactive: 1 },
      xpRateMultiplier: { crystalType: 'XP', active: 1.1, inactive: 1 },
      strengthBonus: { crystalType: 'Strength', active: 10, inactive: 0 },
    });
  });

  it('marker is non-global', () => {
    expect(CRYSTAL_MODIFIER_MARKER.global).toBe(false);
    expect(CRYSTAL_MODIFIER_MARKER.test(MOD_1989)).toBe(true);
  });

  it('follows a changed number, renamed minified names and an extra crystal type', () => {
    const text = MOD_1989
      .replace('?10:0', '?12.5:0')
      .replace('let t=new Set', 'let $a=new Set').split('t.has(').join('$a.has(').replace('t.add(', '$a.add(')
      .replace('strengthBonus:$a.has(`Strength`)?12.5:0}', 'strengthBonus:$a.has(`Strength`)?12.5:0,luckBonus:$a.has(`Luck`)?5:0}');
    expect(parseCrystalModifiers(text)).toMatchObject({
      strengthBonus: { crystalType: 'Strength', active: 12.5, inactive: 0 },
      luckBonus: { crystalType: 'Luck', active: 5, inactive: 0 },
    });
  });

  it('returns null for a missing marker, a foreign set name or a duplicate modifier', () => {
    expect(parseCrystalModifiers('var ut={hungerRateMultiplier:1,xpRateMultiplier:1,strengthBonus:0};')).toBeNull();
    expect(parseCrystalModifiers(MOD_1989.replace('t.has(`XP`)', 'x.has(`XP`)'))).toBeNull();
    expect(parseCrystalModifiers(MOD_1989.replace('xpRateMultiplier:t.has', 'hungerRateMultiplier:t.has'))).toBeNull();
  });

  it('stays fast on long numeric literals', () => {
    const noise = 'var q={' + Array.from({ length: 4000 }, (_, i) => `k${i}:${i}.${i}`).join(',') + '};let t=new Set;for(';
    const start = performance.now();
    expect(parseCrystalModifiers(noise.repeat(5))).toBeNull();
    expect(performance.now() - start).toBeLessThan(200);
  });
});
