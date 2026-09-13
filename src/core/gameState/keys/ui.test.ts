import { describe, expect, it } from 'vitest';
import { UI_KEYS } from './ui';
import type { AtomSourceSpec, SourceSpec } from '../types';

const atomRungs = (key: keyof typeof UI_KEYS): AtomSourceSpec<unknown>[] =>
  (UI_KEYS[key].sources as readonly SourceSpec<unknown>[]).filter((s): s is AtomSourceSpec<unknown> => s.kind === 'atom');

describe('UI key ladders across game builds', () => {
  it('selectedSlotId / currentGrowSlotId bind the 1152 resolved-crop atom first, legacy labels second', () => {
    for (const key of ['selectedSlotId', 'currentGrowSlotId'] as const) {
      const [first, second] = atomRungs(key);
      expect(first!.label.test('selectedCropSlotIdAtom')).toBe(true);
      expect(second).toBeDefined();
    }
    expect(atomRungs('selectedSlotId')[1]!.label.test('mySelectedSlotIdAtom')).toBe(true);
    expect(atomRungs('currentGrowSlotId')[1]!.label.test('myCurrentGrowSlotIdAtom')).toBe(true);
    expect(atomRungs('selectedSlotId')[0]!.label.test('storedCropSelectionAtom')).toBe(false);
  });
  it('projects non-numbers to null', () => {
    const rung = atomRungs('selectedSlotId')[0]!;
    expect(rung.project!(3)).toBe(3);
    expect(rung.project!(null)).toBeNull();
    expect(rung.project!({ slotId: 3 })).toBeNull();
  });
  it('quinoaEngine matches both engine labels, prefers the non-dev one, and validates both shapes', () => {
    const [rung] = atomRungs('quinoaEngine');
    expect(rung!.label.test('quinoaEngineAtom')).toBe(true);
    expect(rung!.label.test('quinoaDevEngineAtom')).toBe(true);
    expect(rung!.label.test('quinoaRendererGenerationAtom')).toBe(false);
    expect(rung!.prefer!('quinoaEngineAtom')).toBe(true);
    expect(rung!.structure!({ getSystem() {} })).toBe(true);
    expect(rung!.structure!({ boot: { seatScope: null, worldScope: {} } })).toBe(true);
    expect(rung!.structure!({ app: {} })).toBe(false);
  });
});
