import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CropBrowsingControl, CropBrowsingProjection } from '../../types/gameAtoms';

let control: CropBrowsingControl;
let occupied: number[];

// Mirrors the game's projection: the selection object is passed through uncopied while still occupied.
function project(): CropBrowsingProjection {
  const visit = control.visit;
  const selection = visit?.selection && occupied.includes(visit.selection.slotId) ? visit.selection : null;
  return { visit, order: visit ? { sourceKey: visit.sourceKey, occupiedSlotIds: occupied } : null, selection, control };
}

vi.mock('../../core/gameState', () => ({
  readSync: (key: string) => (key === 'cropBrowsingProjection' ? project() : null),
  writeSync: (key: string, value: CropBrowsingControl) => {
    if (key !== 'cropBrowsingControl') return false;
    control = value;
    return true;
  },
}));

const { advanceCropSelection, nextCropSlotId } = await import('./cropSelection');

const select = (slotId: number): void => {
  control = { active: true, visit: { sourceKey: 'k', retainedSlotIds: occupied, selection: { sourceKey: 'k', slotId } } };
};

describe('nextCropSlotId (game cyclic step)', () => {
  it('steps in display order, not numeric order, and wraps', () => {
    expect(nextCropSlotId([1, 2, 0], 1)).toBe(2);
    expect(nextCropSlotId([1, 2, 0], 2)).toBe(0);
    expect(nextCropSlotId([1, 2, 0], 0)).toBe(1);
  });
  it('falls back to the first slot, and to undefined when empty', () => {
    expect(nextCropSlotId([4, 5], 9)).toBe(4);
    expect(nextCropSlotId([], 0)).toBeUndefined();
  });
});

describe('advanceCropSelection', () => {
  beforeEach(() => { occupied = [1, 2, 0]; select(2); });

  it('moves the selection to the next occupied slot', () => {
    advanceCropSelection(2);
    expect(project().selection?.slotId).toBe(0);
    expect(control.active).toBe(true);
  });
  it('does nothing when the harvested slot is not the selected one', () => {
    advanceCropSelection(1);
    expect(project().selection?.slotId).toBe(2);
  });
  it('rolls back to the harvested slot while the advanced selection still stands', () => {
    const rollback = advanceCropSelection(2);
    rollback();
    expect(project().selection?.slotId).toBe(2);
  });
  it('does not roll back once the player has moved the selection', () => {
    const rollback = advanceCropSelection(2);
    select(1);
    rollback();
    expect(project().selection?.slotId).toBe(1);
  });
});
