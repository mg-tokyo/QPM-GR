import type {
  ActivityLogEntry,
  FilterState,
  ModalHandles,
  OrderFilter,
  SpeciesDropdownOption,
  SpeciesLookupEntry,
  ActionKey,
  TypeFilter,
} from './types';
import { VIRTUAL_DEFAULT_ROW_HEIGHT } from './constants';

/**
 * Shared mutable state for the activity log native enhancer.
 * Grouped into a single object to make cross-module access explicit.
 */
export const S = {
  started: false,
  history: [] as ActivityLogEntry[],
  filters: { action: 'all', type: 'all', order: 'newest', petSpecies: '', plantSpecies: '' } as FilterState,
  showSummaryInDebug: false,
  enhancerEnabled: false,

  modalPollStop: null as (() => void) | null,
  modalSyncTimer: null as number | null,
  modalHandles: null as ModalHandles | null,
  myDataUnsubscribe: null as (() => void) | null,
  lastSnapshot: [] as ActivityLogEntry[],

  replayQueued: false,
  replayInFlight: false,
  suppressIngestUntil: 0,
  writeSupported: null as boolean | null,
  replayMode: 'unknown' as 'unknown' | 'write' | 'read_patch' | 'none',
  replayHydrationTimer: null as number | null,
  replayHydratedCount: 0,
  readPatchMaxEntries: null as number | null,
  readPatchStartIndex: 0,
  readPatchOrder: 'newest' as OrderFilter,

  virtualMode: 'collapsed' as 'collapsed' | 'virtual-expanded',
  virtualWindowStart: 0,
  virtualWindowEnd: 0,
  virtualTotalFiltered: 0,
  virtualTopSpacerPx: 0,
  virtualBottomSpacerPx: 0,
  virtualAvgRowHeight: VIRTUAL_DEFAULT_ROW_HEIGHT,
  virtualLastScrollUpdateAt: 0,
  virtualIgnoreScrollUntil: 0,
  virtualFilteredCacheKey: '',
  virtualFilteredCache: [] as ActivityLogEntry[],
  virtualSpacerTopEl: null as HTMLDivElement | null,
  virtualSpacerBottomEl: null as HTMLDivElement | null,
  virtualListLayoutApplied: false,
  virtualListPrevJustifyContent: '',
  virtualListPrevAlignContent: '',
  virtualListPrevAlignItems: '',
  virtualPendingWindowStart: null as number | null,
  virtualPendingReason: '',
  virtualPendingPreserveScroll: false,
  virtualHydratedCount: 0,
  virtualReplayDurationMs: 0,
  virtualLoadMoreButton: null as HTMLButtonElement | null,
  virtualLoadButtonClassName: '',

  patchedMyDataAtom: null as any | null,
  patchedMyDataReadKey: null as string | null,
  patchedMyDataReadOriginal: null as ((...args: any[]) => unknown) | null,

  petIconCache: new Map<string, string | null>(),
  plantIconCache: new Map<string, string | null>(),
  eggIconCache: new Map<string, string | null>(),
  petLookupEntriesCache: null as SpeciesLookupEntry[] | null,
  plantLookupEntriesCache: null as SpeciesLookupEntry[] | null,
  petSpeciesOptionsCache: null as SpeciesDropdownOption[] | null,
  plantSpeciesOptionsCache: null as SpeciesDropdownOption[] | null,
  orderedHistoryCacheKey: '',
  orderedHistoryNewestCache: null as ActivityLogEntry[] | null,
  orderedHistoryOldestCache: null as ActivityLogEntry[] | null,
  historyRevision: 0,
  historyFilterMetaCacheRevision: -1,
  historyFilterMetaCache: new Map<string, {
    action: ActionKey;
    type: TypeFilter;
    petFilterKey: string | null;
    plantFilterKey: string | null;
  }>(),

  historySpeciesContextCacheKey: '',
  historySpeciesContextCache: null as import('./types').HistorySpeciesContext | null,
};
