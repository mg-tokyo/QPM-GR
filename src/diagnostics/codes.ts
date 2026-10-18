// Error code registry (§4.2)
//
// Codes live in ./codes/*.ts, one array per category or subsystem; register
// each array below. A code, once shipped, NEVER changes meaning (§4.3). If the
// failure mode shifts, retire the old code and add a new one.

import type { ErrorCode, ErrorCodeDefinition } from './types';
import { CORE_CODES } from './codes/core';
import { STORE_CODES } from './codes/store';
import { UI_CODES } from './codes/ui';
import { FEATURE_CODES } from './codes/feature';
import { INTEGRATION_CODES } from './codes/integration';
import { SERVICE_CODES } from './codes/service';
import { TD_CUSTOM_DESIGNS_CODES } from './codes/tdCustomDesigns';
import { TD_SAVES_CODES } from './codes/tdSaves';
import { TD_TRACKS_CODES } from './codes/tdTracks';
import { PATCH_STAGE_CODES } from './codes/patchStage';
import { PERF_CODES } from './codes/perf';
import { WEBSOCKET_CODES } from './codes/websocket';
import { GAMESTATE_CODES } from './codes/gameState';
import { SPRITE_CODES } from './codes/sprite';
import { NPC_DIALOGUE_CODES } from './codes/npcDialogue';
import { CAMERA3D_CODES } from './codes/camera3d';
import { SPECTATOR_CODES } from './codes/spectator';

const REGISTRY: Record<ErrorCode, ErrorCodeDefinition> = Object.create(null);

function register(def: ErrorCodeDefinition): void {
  REGISTRY[def.code] = def;
}

export function lookupCode(code: ErrorCode): ErrorCodeDefinition | undefined {
  return REGISTRY[code];
}

export function listCodes(): readonly ErrorCodeDefinition[] {
  return Object.values(REGISTRY);
}

for (const def of CORE_CODES) register(def);
for (const def of STORE_CODES) register(def);
for (const def of UI_CODES) register(def);
for (const def of FEATURE_CODES) register(def);
for (const def of INTEGRATION_CODES) register(def);
for (const def of SERVICE_CODES) register(def);
for (const def of TD_CUSTOM_DESIGNS_CODES) register(def);
for (const def of TD_SAVES_CODES) register(def);
for (const def of TD_TRACKS_CODES) register(def);
for (const def of PATCH_STAGE_CODES) register(def);
for (const def of WEBSOCKET_CODES) register(def);
for (const def of PERF_CODES) register(def);
for (const def of GAMESTATE_CODES) register(def);
for (const def of SPRITE_CODES) register(def);
for (const def of NPC_DIALOGUE_CODES) register(def);
for (const def of CAMERA3D_CODES) register(def);
for (const def of SPECTATOR_CODES) register(def);
