import type { ErrorCodeDefinition } from '../types';

const V = '3.2.29';

export const STORE_CODES: readonly ErrorCodeDefinition[] = [
  // STORE-* codes are shared by every src/store/* module. The `subsystem` field
  // here is a placeholder ('store'); the bus subsystem is overridden per-call by
  // _storeDiagnostics.ts so each store gets its own row attributed via
  // `context.store` (e.g. context.store === 'hutch').
  {
    code: 'QPM-STORE-001',
    subsystem: 'store',
    category: 'store',
    severity: 'warn',
    title: 'Store init failed',
    description: 'A reactive store could not start. context.store identifies which store.',
    devNotes: 'src/store/* — see context.store + cause. Call sites escalate: emit via diag.error (bus → failed) when the failure leaves the store non-functional; diag.warn when a fallback keeps it partially working.',
    sinceVersion: V,
  },
  {
    code: 'QPM-STORE-002',
    subsystem: 'store',
    category: 'store',
    severity: 'warn',
    title: 'Store atom unavailable',
    description: 'A reactive store could not resolve its Jotai atom (label not found in cache).',
    devNotes: 'src/store/* — getAtomByLabel returned null; capture race or game-side rename. context.store identifies which store; context.atom names the missing label.',
    sinceVersion: V,
  },
  {
    code: 'QPM-STORE-003',
    subsystem: 'store',
    category: 'store',
    severity: 'warn',
    title: 'Store listener threw',
    description: 'A subscriber/listener inside a reactive store threw during a state update.',
    devNotes: 'src/store/* — listener bug; the store stays subscribed and the next update will re-emit. context.store identifies which store.',
    sinceVersion: V,
  },
  {
    code: 'QPM-STORE-004',
    subsystem: 'store',
    category: 'store',
    severity: 'warn',
    title: 'Store persistence failed',
    description: 'A reactive store could not persist its slice to the storage wrapper. In-memory state is unaffected; the write will retry on the next debounced save.',
    devNotes: 'src/store/* — storage.set threw (quota, hostile GM_setValue, or serializer failure). context.store identifies which store; context.what names the slice (e.g. procs, config).',
    sinceVersion: V,
  },
  {
    code: 'QPM-STORE-005',
    subsystem: 'store',
    category: 'store',
    severity: 'warn',
    title: 'Store internal invariant violated',
    description: 'A derived store found its own state inconsistent (e.g. Bad Luck Protection outcome counters on one egg disagree on how many pulls they saw). The store rebuilt the affected item from its pull log.',
    devNotes: 'src/store/pityTracker/invariants.ts — context.kind/itemId name the item, context.pulls maps outcome → totalPulls. afterRebuild:true means the rebuild did not resolve it (log window too short or a counting bug that also affects replay).',
    sinceVersion: V,
  },
];
