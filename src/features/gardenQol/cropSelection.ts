// Replica of the game's advanceCropSelection (client data/tile/cropSelection.ts, live 1989), which its
// own harvest calls just before sending HarvestCrop and undoes when the send is rejected or unsent.
// Multi-harvest plants keep a harvested slot in occupiedSlotIds while it regrows, so nothing else moves it.
import { readSync, writeSync } from '../../core/gameState';

const noop = (): void => {};

// The game's cyclic step: next in display order, wrapping to the first.
export function nextCropSlotId(order: readonly number[], current: number): number | undefined {
  return order[order.indexOf(current) + 1] ?? order[0];
}

/** Moves the game's crop selection off `harvestedSlotId`; returns the rollback. */
export function advanceCropSelection(harvestedSlotId: number): () => void {
  const projection = readSync('cropBrowsingProjection');
  if (!projection) return noop;
  const { visit, order, selection, control } = projection;
  if (!visit || !order || !selection || selection.slotId !== harvestedSlotId) return noop;
  const slotId = nextCropSlotId(order.occupiedSlotIds, selection.slotId);
  if (slotId === undefined) return noop;

  const advanced = { ...selection, slotId };
  if (!writeSync('cropBrowsingControl', { ...control, visit: { ...visit, selection: advanced } })) return noop;

  return () => {
    const now = readSync('cropBrowsingProjection');
    if (!now || now.selection !== advanced) return;
    // The game rolls back through selectedCropAtom, whose setter refuses a slot that is no longer occupied.
    if (now.order?.sourceKey !== selection.sourceKey || !now.order.occupiedSlotIds.includes(selection.slotId)) return;
    writeSync('cropBrowsingControl', { ...now.control, visit: now.visit ? { ...now.visit, selection: { ...selection } } : null });
  };
}
