import type { ErrorCodeDefinition } from '../types';

// Keep in sync with CURRENT_VERSION in ../codes.ts (local copy avoids a
// circular import). Perf codes ship in 3.3.43 (P2, lag remediation plan).
const V = '3.3.43';

export const PERF_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-PERF-001',
    subsystem: 'perf',
    category: 'core',
    severity: 'warn',
    title: 'Main thread long tasks',
    description: 'The page recorded sustained long tasks (>50 ms) over the last two 15 s windows.',
    userAction: 'Paste this report; the Perf line shows which QPM probe (if any) is over budget.',
    devNotes: 'src/diagnostics/perfMonitor.ts — longtask PerformanceObserver; game work counts too, read the probes.',
    sinceVersion: V,
  },
  {
    code: 'QPM-PERF-002',
    subsystem: 'perf',
    category: 'core',
    severity: 'warn',
    title: 'QPM probe over budget',
    description: 'A QPM per-frame probe (anchor tick, state-tree fan-out, reactive flush) exceeded its p95 budget for two consecutive windows.',
    devNotes: 'src/diagnostics/perfMonitor.ts BUDGET_MS — the probe name is in context.probe.',
    sinceVersion: V,
  },
];
