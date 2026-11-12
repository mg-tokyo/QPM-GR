// Read-only notifications about traffic the command sequencer already sees.
// Listeners run after the send or result handling finished and can neither
// throw into it nor change it. With no listener an emit is one size check.

import { isRecord } from '../utils/typeGuards';

export interface CommandResultEvent {
  requestId: string;
  ok: boolean;
  code?: string;
  at: number;
}

export interface EnvelopeSequencedEvent {
  requestId: string;
  commandSequence: number;
}

export interface InboundHeartbeatEvent {
  seq: number;
  at: number;
}

/** `raw` is the parsed result message as received; treat it as read-only. */
export type CommandResultListener = (event: CommandResultEvent, raw: unknown) => void;
export type EnvelopeSequencedListener = (event: EnvelopeSequencedEvent) => void;
export type InboundHeartbeatListener = (event: InboundHeartbeatEvent) => void;

const HEARTBEAT_PREFIX = 'ping:';

const resultListeners = new Set<CommandResultListener>();
const sequencedListeners = new Set<EnvelopeSequencedListener>();
const heartbeatListeners = new Set<InboundHeartbeatListener>();

function subscribe<T>(set: Set<T>, listener: T): () => void {
  set.add(listener);
  return () => { set.delete(listener); };
}

/** Every QuinoaCommandResult on the bound socket, including results for the game's own commands. */
export function onCommandResult(listener: CommandResultListener): () => void {
  return subscribe(resultListeners, listener);
}

/** An envelope left through the sequencer with this number. Never fires for flat messages. */
export function onEnvelopeSequenced(listener: EnvelopeSequencedListener): () => void {
  return subscribe(sequencedListeners, listener);
}

/** Each inbound `ping:<seq>[:<rtt>]` text frame. Says nothing about whether a pong was sent. */
export function onInboundHeartbeat(listener: InboundHeartbeatListener): () => void {
  return subscribe(heartbeatListeners, listener);
}

export function emitCommandResult(raw: unknown): void {
  if (resultListeners.size === 0) return;
  if (!isRecord(raw) || typeof raw.requestId !== 'string' || typeof raw.ok !== 'boolean') return;
  const event: CommandResultEvent = { requestId: raw.requestId, ok: raw.ok, at: Date.now() };
  if (typeof raw.code === 'string') event.code = raw.code;
  for (const listener of [...resultListeners]) {
    try { listener(event, raw); } catch { /* a listener never reaches the socket handler */ }
  }
}

export function emitEnvelopeSequenced(payload: unknown, commandSequence: number): void {
  if (sequencedListeners.size === 0) return;
  if (!isRecord(payload) || typeof payload.requestId !== 'string') return;
  const event: EnvelopeSequencedEvent = { requestId: payload.requestId, commandSequence };
  for (const listener of [...sequencedListeners]) {
    try { listener(event); } catch { /* a listener never reaches the send path */ }
  }
}

export function emitInboundHeartbeat(data: unknown): void {
  if (heartbeatListeners.size === 0) return;
  if (typeof data !== 'string' || !data.startsWith(HEARTBEAT_PREFIX)) return;
  const end = data.indexOf(':', HEARTBEAT_PREFIX.length);
  const digits = data.slice(HEARTBEAT_PREFIX.length, end === -1 ? undefined : end);
  const seq = digits.length > 0 ? Number(digits) : NaN;
  if (!Number.isInteger(seq) || seq < 0) return;
  const event: InboundHeartbeatEvent = { seq, at: Date.now() };
  for (const listener of [...heartbeatListeners]) {
    try { listener(event); } catch { /* a listener never reaches the socket handler */ }
  }
}

export function getWireEventListenerCounts(): { result: number; sequenced: number; heartbeat: number } {
  return { result: resultListeners.size, sequenced: sequencedListeners.size, heartbeat: heartbeatListeners.size };
}
