// src/websocket/envelope.ts
// QuinoaCommand envelope helpers shared by the send facade, the sequencer,
// and every observer/guard that keys on an outgoing message's `type`.
//
// Wire shape (live v1040, `ST()` in main-*.js):
//   { scopePath, type:'QuinoaCommand', requestId, commandSequence, command:{ type, ...payload } }
// Server reply: { type:'QuinoaCommandResult', requestId, commandType, ok, code? }

import { isRecord } from '../utils/typeGuards';

export const QUINOA_COMMAND_TYPE = 'QuinoaCommand';
export const QUINOA_COMMAND_RESULT_TYPE = 'QuinoaCommandResult';

/**
 * Quinoa-scope types the live client (v1040) still sends OUTSIDE the
 * envelope. Wrapping any of these returns `not_ackable` and burns a sequence
 * number. Everything not listed here defaults to the envelope, which fails
 * safe as the game migrates its last stragglers.
 */
export const LEGACY_ROOM_ACTION_TYPES: ReadonlySet<string> = new Set([
  // flat sendMessage
  'DropObject',
  'PickupObject',
  // non-ackable / movement / noisy path
  'PlayerPosition',
  'Teleport',
  'RequestPetGreet',
  'Ping',
  'CheckWeatherStatus',
  'CheckFriendBonus',
  'SetSelectedItem',
  'QuinoaTutorialSkipped',
  'ThrowSnowball',
]);

export function isLegacyRoomActionType(type: string): boolean {
  return LEGACY_ROOM_ACTION_TYPES.has(type);
}

export type QuinoaCommandResultCode =
  | 'invalid_message'
  | 'invalid_sequence'
  | 'no_slot'
  | 'rate_limited'
  | 'not_ackable'
  | 'handler_error'
  // QPM-minted (CS-4): a frame executed past this envelope's commandSequence
  // without a real result — the server dropped the send. Definite rejection.
  | 'dropped_stale';

export interface QuinoaCommandEnvelope {
  scopePath: string[];
  type: typeof QUINOA_COMMAND_TYPE;
  requestId: string;
  commandSequence: number;
  command: { type: string } & Record<string, unknown>;
}

export interface QuinoaCommandResultMessage {
  type: typeof QUINOA_COMMAND_RESULT_TYPE;
  requestId: string;
  commandType?: string;
  ok: boolean;
  code?: QuinoaCommandResultCode | string;
  /** Set by the sequencer when a `not_ackable` command was re-sent flat. */
  resentAsLegacy?: boolean;
}

/** Rejections where the server definitely did NOT execute the command. */
const DEFINITE_REJECTIONS: ReadonlySet<string> = new Set([
  'invalid_message',
  'invalid_sequence',
  'no_slot',
  'rate_limited',
  'not_ackable',
  'dropped_stale',
]);

export function isDefiniteRejection(result: QuinoaCommandResultMessage): boolean {
  return !result.ok && typeof result.code === 'string' && DEFINITE_REJECTIONS.has(result.code);
}

/** `handler_error` = the handler threw mid-execution; the mutation may have applied. Never retry. */
export function isUnknownOutcome(result: QuinoaCommandResultMessage): boolean {
  return !result.ok && result.code === 'handler_error';
}

export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Non-secure contexts lack randomUUID; uniqueness per session is all the
  // server needs for result correlation.
  return `qpm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Build an envelope. `commandSequence` is a placeholder — the sequencer's
 * chokepoint wrapper assigns the real wire number immediately before the
 * native send (see commandSequencer.ts).
 */
export function buildEnvelope(
  scopePath: string[],
  type: string,
  payload: Record<string, unknown>,
  requestId: string,
): QuinoaCommandEnvelope {
  return {
    scopePath,
    type: QUINOA_COMMAND_TYPE,
    requestId,
    commandSequence: 0,
    command: { ...payload, type },
  };
}

export function isQuinoaCommandEnvelope(msg: unknown): msg is QuinoaCommandEnvelope {
  return isRecord(msg)
    && msg.type === QUINOA_COMMAND_TYPE
    && typeof msg.requestId === 'string'
    && isRecord(msg.command);
}

export function isQuinoaCommandResult(msg: unknown): msg is QuinoaCommandResultMessage {
  return isRecord(msg)
    && msg.type === QUINOA_COMMAND_RESULT_TYPE
    && typeof msg.requestId === 'string'
    && typeof msg.ok === 'boolean';
}

/**
 * Resolve the effective (inner) action type + payload of an outgoing message.
 * Observers and guards match on gameplay types (HarvestCrop, SellPet, …); on
 * v1040 those arrive wrapped, so matching the outer `type` silently misses
 * every gameplay action. Non-envelope messages pass through unchanged.
 */
export function unwrapQuinoaCommand(
  actionType: string,
  payload: Record<string, unknown>,
): { actionType: string; payload: Record<string, unknown> } {
  if (actionType !== QUINOA_COMMAND_TYPE) return { actionType, payload };
  const cmd = payload.command;
  if (!isRecord(cmd)) return { actionType, payload };
  const innerType = cmd.type;
  if (typeof innerType !== 'string' || innerType.length === 0) return { actionType, payload };
  return { actionType: innerType, payload: cmd };
}

/** Outer-or-inner type of an outgoing message, or null if it has none. */
export function effectiveMessageType(msg: unknown): string | null {
  if (!isRecord(msg)) return null;
  const outer = msg.type;
  if (typeof outer !== 'string') return null;
  return unwrapQuinoaCommand(outer, msg).actionType;
}
