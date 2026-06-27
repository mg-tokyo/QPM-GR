// src/utils/logger.ts — Legacy logger shim.
//
// This module used to own the codebase's console.log wrappers. It now routes
// through the named-logger pipeline in `src/diagnostics/logger.ts`, which
// owns all raw console writes per the diagnostics-design rule.
//
// Existing call sites (`log(...)`, `importantLog(...)`, `createLogger('Foo')`)
// keep working unchanged. Subsystem migrations replace these with named
// loggers + error codes (see diagnostics-design.md §6.3).
//
// Behavioural contract preserved 1:1 from the previous implementation:
//   - logger.enabled === true   → log on every call
//   - logger.enabled === false  → log only when verbose-logs is on
//   - prefix-prefixed output via `[prefix] arg1 arg2 ...`

import {
  isVerboseLogsEnabled,
  setVerboseLogsEnabled,
  writeShimConsole,
} from '../diagnostics/logger';

export { isVerboseLogsEnabled, setVerboseLogsEnabled };

export interface Logger {
  (...args: unknown[]): void;
  enabled: boolean;
}

export function createLogger(prefix: string, enabledByDefault = false): Logger {
  const shim = ((...args: unknown[]): void => {
    if (!shim.enabled && !isVerboseLogsEnabled()) return;
    writeShimConsole(prefix, args);
  }) as Logger;

  shim.enabled = enabledByDefault;
  return shim;
}

export const log = createLogger('QuinoaPetMgr', false);
export const importantLog = createLogger('QuinoaPetMgr', true);
