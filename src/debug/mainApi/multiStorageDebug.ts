import {
  closeStorages, describeStoragePanels, describeStorageValues, disposeStorages, getSavedLayout, inspectStorages, isStoragesOpen, openStorages,
  probeStorageCapabilities, readOwnedStorageIds, resetStorageLayout, saveLayoutCells, setSimulatedMissing, startMultiStorage,
  stopMultiStorage, toggleStorages,
} from '../../features/multiStorage';

/** QPM_DEBUG_API.multiStorage: live checks for the multi-storage panels. */
export const multiStorageDebugApi = {
  multiStorage: {
    /** No argument: the saved pick; null: every owned storage; else these building ids (PetHutch, …). */
    open: (ids?: readonly string[] | null) => openStorages(ids),
    close: closeStorages,
    toggle: toggleStorages,
    dispose: disposeStorages,
    isOpen: isStoragesOpen,
    owned: readOwnedStorageIds,
    state: inspectStorages,
    /** Open panels: cells, front order, and the client-pixel centres of each header and grip. */
    panels: describeStoragePanels,
    /** Each open panel's storage-value label: text (null: none for that storage), shown, place in its host. */
    values: describeStorageValues,
    resetLayout: resetStorageLayout,
    /** Live checks save this before a reset-key test and hand it back to `restoreLayout` afterwards. */
    savedLayout: getSavedLayout,
    restoreLayout: saveLayoutCells,
    /** The init/shutdown entry points: `stop` closes open panels and the keys do nothing until `start`. */
    start: startMultiStorage,
    stop: stopMultiStorage,
    check: () => {
      const probe = probeStorageCapabilities();
      return probe.ok ? { ok: true, panelIds: probe.panelIds } : probe;
    },
    /** Test double for a changed game: the next opens report these handles missing; null clears it. */
    simulateMissing: (names: readonly string[] | null) => { setSimulatedMissing(names); },
  },
};
