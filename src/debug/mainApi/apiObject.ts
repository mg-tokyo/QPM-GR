import { coreDebugApi, activityLogApi } from './coreDebug';
import { spriteDebugApi } from './spriteDebug';
import { petInspectorApi } from './petInspectors';
import { domInspectorApi } from './domInspectors';
import { inventoryDebugApi } from './inventoryDebug';
import { multiStorageDebugApi } from './multiStorageDebug';
import { multiShopDebugApi } from './multiShopDebug';
import { storageMoveDebugApi } from './storageMoveDebug';
import { pushRulesDebugApi } from './pushRulesDebug';

// Console-facing debug surface shared as `QPM` / `QPM_DEBUG_API` when debug
// globals are enabled. Late-bound entries (stats, catalogs, jotai/atoms
// namespaces, garden helpers) are attached in lateExposure.ts during init.
export const QPM_DEBUG_API = {
  ...coreDebugApi,
  ...spriteDebugApi,
  ...petInspectorApi,
  ...domInspectorApi,
  ...inventoryDebugApi,
  ...multiStorageDebugApi,
  ...multiShopDebugApi,
  ...storageMoveDebugApi,
  ...pushRulesDebugApi,
};

export const QPM_ACTIVITY_LOG_API = activityLogApi;
