// Legacy logger shim — routes into the named-logger pipeline in `src/diagnostics/logger.ts`
// (see diagnostics-design.md §6.3). Contract: enabled=true logs always; enabled=false logs
// only when verbose-logs is on; output is prefix-tagged `[prefix] arg1 arg2 ...`.

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
