import { describe, expect, it } from 'vitest';
import { parseBagLimit } from './bagLimitParsing';

// Exact excerpt of live build 2036 `inventoryAtoms-DNE6rlLK.js` (2026-11-16).
const LIVE = '(e){return{itemType:e.itemType,id:U(e)}}function mn(e,t){return Xt(t)<=Math.max(Xt(e),100)}function hn(e,t){return Xt(e)<100?!1:!t||!Zt(e,t)&&!e.items.some(e=>_n(e)&&e.itemType===t.itemType&&U(e)===t.id)}function gn(e,t){';
// Beta pr-4669-gke-2911 `inventoryAtoms-DkbetI5Q.js` (ALR-7 PD2).
const BETA = 'function Tn(e,t){return sn(e)<100?!1:!t||!cn(e,t)&&!e.items.some(e=>an(e)&&e.itemType===t.itemType&&U(e)===t.id)}';

describe('parseBagLimit (ALR-7.3b)', () => {
  it('reads the live and beta limit', () => {
    expect(parseBagLimit(LIVE)).toBe(100);
    expect(parseBagLimit(BETA)).toBe(100);
  });

  it('reads a build without the tool ring arrival test and another number', () => {
    expect(parseBagLimit('function a(e,t){return $b(e)<120?!1:!t||!e.items.some(e=>c(e))}')).toBe(120);
  });

  it('absent anchor or the max() projection alone → null', () => {
    expect(parseBagLimit('var a=1;')).toBeNull();
    expect(parseBagLimit('function mn(e,t){return Xt(t)<=Math.max(Xt(e),100)}')).toBeNull();
  });

  it('zero is not a limit', () => {
    expect(parseBagLimit('{return a(e)<0?!1:!t||!e.items.some(')).toBeNull();
  });
});
