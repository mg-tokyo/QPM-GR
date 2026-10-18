import type { ErrorCodeDefinition } from '../types';

const V = '3.2.29';

export const SERVICE_CODES: readonly ErrorCodeDefinition[] = [
  // Service: Restock data fetcher (§4.4 borderline → promoted Phase 5.4).
  // External Supabase fetch with real failure modes (network, schema drift,
  // CORS). Consumers (tile statuses, dashboard, shop window) see stale data on
  // failure but no upstream signal told them WHY without this row.
  {
    code: 'QPM-RESTOCK-001',
    subsystem: 'restockData',
    category: 'service',
    severity: 'warn',
    title: 'Restock fetch failed',
    description: 'fetchRestockData() could not get a usable response from Supabase. Stale cache is served when present; otherwise consumers see an empty list.',
    devNotes: 'src/utils/restock/dataService.ts fetchRestockData — context.where identifies the attempted endpoint (extended | base | outer), context.gm whether GM_xmlhttpRequest was available, context.errors carries the per-transport reason snippets.',
    sinceVersion: V,
  },
  {
    code: 'QPM-RESTOCK-002',
    subsystem: 'restockData',
    category: 'service',
    severity: 'warn',
    title: 'Restock response unparseable',
    description: 'JSON parse failed or the response was not the expected array shape. Cache fallback applied (if present).',
    devNotes: 'src/utils/restock/dataService.ts fetchRestockData — context.what is parse | shape.',
    sinceVersion: V,
  },
  {
    code: 'QPM-RESTOCK-003',
    subsystem: 'restockData',
    category: 'service',
    severity: 'warn',
    title: 'Restock API config invalid',
    description: 'RESTOCK_URL malformed or anon key missing. Network fetch disabled for the session — only cached data is served.',
    devNotes: 'src/utils/restock/dataService.ts getRestockRequestConfig — most likely a build-time misconfiguration. The hub stays degraded for the session because config is static; restart required to recover.',
    sinceVersion: V,
  },
];
