// src/ui/panel/tileStatusTypes.ts
// Shared types for tile status providers.

export type GetStatusEl = (tileId: string) => HTMLElement | null;
export type AddLiveCleanup = (version: number, cleanup: () => void) => void;

/** Per-tile status provider — receives the pre-resolved status element. */
export type PerTileStatusProvider = (
  el: HTMLElement,
  addLiveCleanup: AddLiveCleanup,
  version: number,
) => void;

/** Multi-tile status provider — receives the getStatusEl lookup function. */
export type MultiTileStatusProvider = (
  getStatusEl: GetStatusEl,
  addLiveCleanup: AddLiveCleanup,
  version: number,
) => void;
