import { coreDebugApi, activityLogApi } from './coreDebug';
import { spriteDebugApi } from './spriteDebug';
import { petInspectorApi } from './petInspectors';
import { domInspectorApi } from './domInspectors';
import { inventoryDebugApi } from './inventoryDebug';

// Console-facing debug surface shared as `QPM` / `QPM_DEBUG_API` when debug
// globals are enabled. Late-bound entries (stats, catalogs, jotai/atoms
// namespaces, garden helpers) are attached in lateExposure.ts during init.
export const QPM_DEBUG_API = {
  ...coreDebugApi,
  ...spriteDebugApi,
  ...petInspectorApi,
  ...domInspectorApi,
  ...inventoryDebugApi,
};

export const QPM_ACTIVITY_LOG_API = activityLogApi;
