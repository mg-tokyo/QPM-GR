import { describe, expect, it } from 'vitest';
import { describeConfirmationSourceGaps } from './sourceGaps';
import type { OwnershipBaseline } from './types';

function makeBaseline(overrides: Partial<OwnershipBaseline> = {}): OwnershipBaseline {
  return {
    count: 0,
    includeInventory: true,
    includeSeedSilo: true,
    includeDecorShed: true,
    includeToolShack: true,
    inventoryKeyItemQuantities: new Map<string, number>(),
    ...overrides,
  };
}

describe('describeConfirmationSourceGaps (T6)', () => {
  it('returns empty string when inventory is bound and envelope is available', () => {
    expect(describeConfirmationSourceGaps(makeBaseline(), true)).toBe('');
  });

  it('names inventory-unbound gap alone', () => {
    expect(describeConfirmationSourceGaps(makeBaseline({ includeInventory: false }), true))
      .toBe(' (inventory unbound)');
  });

  it('names legacy-transport gap alone', () => {
    expect(describeConfirmationSourceGaps(makeBaseline(), false))
      .toBe(' (legacy transport)');
  });

  it('names both gaps in order when neither signal is available', () => {
    expect(describeConfirmationSourceGaps(makeBaseline({ includeInventory: false }), false))
      .toBe(' (inventory unbound, legacy transport)');
  });

  it('storage baseline flags (seedSilo/decorShed/toolShack) do not appear in the gap suffix', () => {
    // Signal-A gap wording is only about the two SIGNAL sources: inventory-atom binding
    // and the envelope transport. Storage baselines are Signal-D-adjacent and do not
    // participate in the "no confirmation source" branch wording.
    expect(describeConfirmationSourceGaps(makeBaseline({
      includeSeedSilo: false, includeDecorShed: false, includeToolShack: false,
    }), true)).toBe('');
  });
});
