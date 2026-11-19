import { read, readSync, write } from '../../core/gameState';
import type { ActiveModalState } from '../../types/gameAtoms';

// The game bumps openId on every open (beta modalAtom.ts:346-377); a panel re-opened with the same id re-mounts.
export function nextModalState(prev: ActiveModalState | null, modal: string): ActiveModalState {
  return { modal, openId: (prev?.openId ?? 0) + 1 };
}

// The game's setter closes the bag after the panel opens (beta modalAtom.ts:353-356); a raw state write does not.
async function closeBag(): Promise<void> {
  if (readSync('inventoryModalIsActive') !== true) return;
  try {
    await write('inventoryModalIsActive', false);
  } catch {
    // The panel still opens, with the bag behind it as before INP-1.4a.
  }
}

/** Throws when neither the modal state atom nor the legacy activeModalAtom accepts the write. */
export async function openGameModal(modal: string): Promise<void> {
  const prev = await read('activeModalState');
  if (prev) await write('activeModalState', nextModalState(prev, modal));
  else await write('activeModal', modal);
  await closeBag();
}

async function openModalId(): Promise<{ state: ActiveModalState | null; modal: string | null }> {
  const state = await read('activeModalState');
  return { state, modal: state ? state.modal : readSync('activeModal') };
}

// The modal-state half of the game's closeActiveModal (beta modalAtom.ts:422-430).
async function closeModal(state: ActiveModalState | null): Promise<void> {
  if (state) await write('activeModalState', { modal: null, openId: state.openId + 1 });
  else await write('activeModal', null);
}

/** Opens `modal`, or closes it when it is the panel already open (INP-1.4b, user 2026-11-17). */
export async function toggleGameModal(modal: string): Promise<void> {
  const { state, modal: open } = await openModalId();
  if (open === modal) await closeModal(state);
  else await openGameModal(modal);
}

/** The game's E key (beta modalAtom.ts:455-476): close a bag in front, else close the panel and open the bag. */
export async function toggleBag(): Promise<void> {
  const { state, modal } = await openModalId();
  if (readSync('inventoryModalIsActive') === true && modal === null) {
    await write('inventoryModalIsActive', false);
    return;
  }
  if (modal !== null) await closeModal(state);
  await write('inventoryModalIsActive', true);
}
