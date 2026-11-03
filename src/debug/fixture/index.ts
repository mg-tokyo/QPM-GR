import { isRoomSessionReady, getRoomConnection } from '../../websocket/api';
import { onRoomConnectionChange } from '../../websocket/roomConnectionEvents';
import { addSendGuard, isSendGuardActive, removeSendGuardByName } from '../../websocket/sendGuard';
import { subscribe } from '../../core/gameState';
import { pageWindow } from '../../core/pageContext';
import { createFixtureSession, type BeginResult, type FixtureStatus } from './session';
import { readFixtureData, takeFixtureSnapshot } from './snapshot';
import type { EndResult, FixtureSnapshot } from './types';

export type FixtureApi = {
  version: 'qpm-fixture-v1';
  begin(input: unknown): BeginResult;
  snapshot(): FixtureSnapshot;
  status(): FixtureStatus;
  end(): EndResult | { ok: false; reason: 'not-open' };
};

// The version string doubles as the build marker: release builds must contain 0 hits of it.
export function createFixtureApi(): FixtureApi {
  const session = createFixtureSession({
    readData: readFixtureData,
    isReady: isRoomSessionReady,
    addGuard: (name, predicate) => addSendGuard(name, predicate),
    removeGuard: removeSendGuardByName,
    guardActive: isSendGuardActive,
    connectionIdentity: () => {
      const room = getRoomConnection();
      return [room, room?.currentWebSocket ?? null];
    },
    onConnectionChange: (cb) => onRoomConnectionChange((_room, reason) => { if (reason !== 'initial') cb(); }),
    subscribeData: (cb) => subscribe('myData', () => cb()),
    unloadTarget: pageWindow,
    now: () => new Date(),
  });
  return { version: 'qpm-fixture-v1', snapshot: takeFixtureSnapshot, ...session };
}
