import { describe, expect, it } from 'vitest';
import { formatRestockLine, type RestockPayload } from './copyPayload';

const IDLE: RestockPayload = { pendings: 0, active: 0, sources: ['A', 'B'], purchasesField: 'shopPurchases', cycles: [] };

describe('Restock copy line (P4 a)', () => {
  it('stays silent on a healthy row with no cards or pendings', () => {
    expect(formatRestockLine(IDLE, false)).toBeNull();
  });

  it('renders on a healthy row while a card is active, with the cycle summary', () => {
    expect(formatRestockLine({ ...IDLE, active: 1, cycles: ['egg:current'] }, false))
      .toBe('Restock: pendings=0, active=1, sources=[A,B], purchasesField=shopPurchases, cycles=[egg:current]');
  });

  it('renders while a purchase is pending', () => {
    expect(formatRestockLine({ ...IDLE, pendings: 2 }, false)).toContain('pendings=2');
  });

  it('keeps the degraded-row trigger', () => {
    expect(formatRestockLine({ ...IDLE, sources: [], purchasesField: null }, true))
      .toBe('Restock: pendings=0, active=0, sources=[], purchasesField=absent, cycles=[]');
  });
});
