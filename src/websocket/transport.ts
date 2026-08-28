// src/websocket/transport.ts
// Which transport (legacy flat vs QuinoaCommand envelope) a given action type
// should use. Signals, strongest first:
//   1. what the GAME was observed sending for that type (this session, via the
//      sequencer's chokepoint wrapper), or a server verdict (`not_ackable`);
//   2. the same, persisted from earlier sessions (qpm.ws.transport.v1);
//   3. LEGACY_ROOM_ACTION_TYPES as the cold-start prior — unknown types default
//      to envelope because that is the only direction the server can correct.

import { createNamedLogger } from '../diagnostics/logger';
import { storage } from '../utils/storage';
import { LEGACY_ROOM_ACTION_TYPES, isLegacyRoomActionType } from './envelope';

const log = createNamedLogger('websocket');

export const TRANSPORT_STORAGE_KEY = 'qpm.ws.transport.v1';

export type Transport = 'legacy' | 'envelope';
export type TransportSource = 'observed' | 'server' | 'persisted' | 'allowlist';

interface Observation {
  transport: Transport;
  source: Exclude<TransportSource, 'allowlist'>;
  count: number;
  lastAt: number;
  /** Times the game switched transport for this type mid-session. */
  flips: number;
}

const observed = new Map<string, Observation>();
const warned = new Set<string>();
let loaded = false;
let qpmSendDepth = 0;

/** Marks sends issued by QPM so the chokepoint doesn't record them as the game's. */
export function withQpmOrigin<T>(fn: () => T): T {
  qpmSendDepth += 1;
  try {
    return fn();
  } finally {
    qpmSendDepth -= 1;
  }
}

export function isQpmOriginSend(): boolean {
  return qpmSendDepth > 0;
}

function allowlistTransport(type: string): Transport {
  return isLegacyRoomActionType(type) ? 'legacy' : 'envelope';
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const saved = storage.get<Record<string, unknown>>(TRANSPORT_STORAGE_KEY, {});
  if (!saved || typeof saved !== 'object') return;
  for (const [type, transport] of Object.entries(saved)) {
    if (transport === 'legacy' || transport === 'envelope') {
      observed.set(type, { transport, source: 'persisted', count: 0, lastAt: 0, flips: 0 });
    }
  }
}

function persist(): void {
  const out: Record<string, Transport> = {};
  for (const [type, obs] of observed) out[type] = obs.transport;
  storage.set(TRANSPORT_STORAGE_KEY, out);
}

function warnIfContradictsAllowlist(type: string, transport: Transport): void {
  const expected = allowlistTransport(type);
  if (transport !== expected && !warned.has(type)) {
    warned.add(type);
    log.warn('QPM-WS-009', { type, observed: transport, allowlist: expected });
  }
}

/** Record how the GAME just sent `type`. */
export function recordGameTransport(type: string, transport: Transport): void {
  ensureLoaded();
  const prev = observed.get(type);
  if (prev) {
    prev.count += 1;
    prev.lastAt = Date.now();
    prev.source = 'observed';
    if (prev.transport !== transport) {
      prev.transport = transport;
      prev.flips += 1;
      persist();
    }
  } else {
    observed.set(type, { transport, source: 'observed', count: 1, lastAt: Date.now(), flips: 0 });
    persist();
  }
  warnIfContradictsAllowlist(type, transport);
}

/** The server said an enveloped `type` is `not_ackable` — it must go flat from now on. */
export function recordServerLegacyVerdict(type: string): void {
  ensureLoaded();
  const prev = observed.get(type);
  if (prev && prev.transport === 'legacy') return;
  observed.set(type, { transport: 'legacy', source: 'server', count: prev?.count ?? 0, lastAt: Date.now(), flips: (prev?.flips ?? 0) + (prev ? 1 : 0) });
  persist();
  warnIfContradictsAllowlist(type, 'legacy');
}

/** Observed / server / persisted knowledge wins; the allowlist is the fallback prior. */
export function resolveTransport(type: string): { transport: Transport; source: TransportSource } {
  ensureLoaded();
  const obs = observed.get(type);
  if (obs) return { transport: obs.transport, source: obs.source };
  return { transport: allowlistTransport(type), source: 'allowlist' };
}

export interface TransportAuditRow {
  type: string;
  allowlist: Transport;
  observed: Transport | null;
  effective: Transport;
  source: TransportSource;
  count: number;
  flips: number;
  mismatch: boolean;
}

/** Every type with an opinion (allowlist ∪ observed), flagging allowlist/observation disagreements. */
export function transportAudit(): { rows: TransportAuditRow[]; mismatches: string[] } {
  ensureLoaded();
  const types = new Set<string>([...LEGACY_ROOM_ACTION_TYPES, ...observed.keys()]);
  const rows: TransportAuditRow[] = [];
  for (const type of [...types].sort()) {
    const obs = observed.get(type) ?? null;
    const allowlist = allowlistTransport(type);
    const { transport, source } = resolveTransport(type);
    rows.push({
      type,
      allowlist,
      observed: obs?.transport ?? null,
      effective: transport,
      source,
      count: obs?.count ?? 0,
      flips: obs?.flips ?? 0,
      mismatch: obs !== null && obs.transport !== allowlist,
    });
  }
  return { rows, mismatches: rows.filter((r) => r.mismatch).map((r) => r.type) };
}

export function resetTransportObservations(): void {
  observed.clear();
  warned.clear();
  loaded = true;
  storage.remove(TRANSPORT_STORAGE_KEY);
}

// ── Send budget ───────────────────────────────────────────────────────────
// Server limit measured 2026-08-28: ~300 commands per fixed ~10 s window for
// the whole socket; once exhausted the USER's own actions are rate_limited
// too. QPM's share is capped well below that so a runaway loop can never
// lock the player out.

const BUDGET_CAPACITY = 30;
const BUDGET_REFILL_PER_SEC = 10;

let tokens = BUDGET_CAPACITY;
let lastRefillAt = 0;
const budgetStats = { granted: 0, refused: 0 };

function refillTokens(now: number): void {
  if (lastRefillAt === 0) { lastRefillAt = now; return; }
  const elapsedSec = (now - lastRefillAt) / 1000;
  if (elapsedSec <= 0) return;
  tokens = Math.min(BUDGET_CAPACITY, tokens + elapsedSec * BUDGET_REFILL_PER_SEC);
  lastRefillAt = now;
}

/** Consume one send token. False = refuse this send (caller returns `throttled`). */
export function takeSendToken(now: number = Date.now()): boolean {
  refillTokens(now);
  if (tokens < 1) {
    budgetStats.refused += 1;
    return false;
  }
  tokens -= 1;
  budgetStats.granted += 1;
  return true;
}

export function getSendBudgetStats(): { capacity: number; refillPerSec: number; tokens: number; granted: number; refused: number } {
  refillTokens(Date.now());
  return { capacity: BUDGET_CAPACITY, refillPerSec: BUDGET_REFILL_PER_SEC, tokens: Math.floor(tokens), ...budgetStats };
}
