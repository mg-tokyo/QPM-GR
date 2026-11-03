import type { GuardOrigin, GuardPredicate, GuardVerdict } from '../../websocket/sendGuard';
import type { QuinoaUserSlotData } from '../../types/gameAtoms';
import { isRecord } from '../../utils/typeGuards';
import { BACKGROUND_TYPES, judgeSend, type SessionState } from './rules';
import { buildSnapshot, createLiveView, petIdsOf } from './snapshot';
import { allowlistFor } from './allowlist';
import type { BeginInput, EndResult, FixtureAllowlist, FixtureEvent, FixtureSnapshot, Learned, LedgerSlot } from './types';

export type FixtureSessionDeps = {
  readData(): QuinoaUserSlotData | null;
  isReady(): boolean;
  addGuard(name: string, predicate: GuardPredicate): boolean;
  removeGuard(name: string): void;
  guardActive(): boolean;
  connectionIdentity(): readonly unknown[];        // e.g. [room, socket]: a change in either ends the session
  onConnectionChange(cb: () => void): () => void;
  subscribeData(cb: () => void): () => void;
  unloadTarget: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  now(): Date;
};

type BeginRefusal = 'alert' | 'open' | 'not-ready' | 'bad-input';
export type BeginResult =
  | { ok: true; before: FixtureSnapshot; ledgerDropped: LedgerSlot[]; allowlist: FixtureAllowlist }
  | { ok: false; reason: BeginRefusal };
export type FixtureStatus = {
  open: boolean; runId: string | null; spent: number; used: { seeds: number; eggs: number };
  refusals: FixtureEvent[]; endReason: EndResult['endReason'] | null;
};

const GUARD_NAME = 'fixture';
// A HatchEgg the server rejects must not make a later, unrelated pet fixture-owned.
const HATCH_WINDOW_MS = 15_000;

type RunState = SessionState & { ownedSlots: Set<string>; ownedPetIds: Set<string>; ownedItemIds: Set<string> };
type Run = {
  state: RunState;
  learned: Learned;
  events: FixtureEvent[];
  backgroundSeen: Set<string>;
  knownPets: Set<string>;
  pendingHatches: number[];
  endReason: EndResult['endReason'] | null;
  teardown: (() => void)[];
};

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function isBeginInput(v: unknown): v is BeginInput {
  if (!isRecord(v) || typeof v.runId !== 'string' || !v.runId || typeof v.alert !== 'boolean') return false;
  const { config: c, ledger: l, budget: b } = v;
  if (!isRecord(b) || !num(b.spendCap) || b.spendCap < 0) return false;
  if (!isRecord(c) || c.schema !== 1 || typeof c.allowRarity !== 'string' || !isRecord(c.reserveFloors)) return false;
  if (typeof c.buyEggsAtOrBelowFloor !== 'boolean' || !num(c.coinFloor) || !isRecord(c.useCaps)) return false;
  if (!num(c.useCaps.seeds) || !num(c.useCaps.eggs)) return false;
  if (!isRecord(l) || l.schema !== 1 || !Array.isArray(l.slots) || !strArray(l.petIds) || !strArray(l.itemIds)) return false;
  return l.slots.every((s) => isRecord(s) && typeof s.slot === 'string' && (s.kind === 'plant' || s.kind === 'egg') && typeof s.id === 'string');
}

/** A ledger slot survives only if the same planting is still there (automation may have replaced it). */
function reconcile(slots: LedgerSlot[], before: FixtureSnapshot): { kept: LedgerSlot[]; dropped: LedgerSlot[] } {
  const kept: LedgerSlot[] = [];
  const dropped: LedgerSlot[] = [];
  for (const s of slots) {
    const tile = before.garden.find((g) => g.slot === s.slot);
    const same = tile && tile.objectType === s.kind && tile.id === s.id && (s.objectId === undefined || tile.objectId === s.objectId);
    (same ? kept : dropped).push(s);
  }
  return { kept, dropped };
}

export function createFixtureSession(deps: FixtureSessionDeps) {
  let run: Run | null = null;

  const close = (reason: EndResult['endReason']): void => {
    if (!run || run.endReason) return;
    run.endReason = reason;
    for (const fn of run.teardown.splice(0)) {
      try { fn(); } catch { /* teardown continues */ }
    }
  };

  const observePets = (): void => {
    if (!run || run.endReason) return;
    const data = deps.readData();
    if (!data) return;
    const cutoff = deps.now().getTime() - HATCH_WINDOW_MS;
    for (const id of petIdsOf(data)) {
      if (run.knownPets.has(id)) continue;
      run.knownPets.add(id);
      run.pendingHatches = run.pendingHatches.filter((at) => at >= cutoff);
      if (run.pendingHatches.length === 0) continue;
      run.pendingHatches.shift();
      run.state.ownedPetIds.add(id);
      run.learned.petIds.push(id);
    }
  };

  const record = (r: Run, type: string, origin: GuardOrigin, verdict: GuardVerdict): void => {
    // Background allows are logged once per type and origin; walking would flood the log otherwise.
    if (verdict.allow && BACKGROUND_TYPES.has(type)) {
      const key = `${type}|${origin}`;
      if (r.backgroundSeen.has(key)) return;
      r.backgroundSeen.add(key);
    }
    r.events.push({
      at: deps.now().toISOString(), type, origin,
      verdict: verdict.allow ? 'allow' : 'refuse', reason: verdict.allow ? null : verdict.reason,
    });
  };

  const predicate: GuardPredicate = (type, payload, origin) => {
    const r = run;
    if (!r || r.endReason) return { allow: true };
    const data = deps.readData();
    if (!data) {
      const refusal: GuardVerdict = { allow: false, reason: 'no-state' };
      record(r, type, origin, refusal);
      return refusal;
    }
    const j = judgeSend(type, payload, r.state, createLiveView(data));
    const verdict: GuardVerdict = j.allow ? { allow: true } : { allow: false, reason: j.reason };
    record(r, type, origin, verdict);
    if (!j.allow || !j.effects) return verdict;
    const e = j.effects;
    if (e.spend) r.state.spent += e.spend;
    if (e.useSeed) r.state.used.seeds += 1;
    if (e.useEgg) r.state.used.eggs += 1;
    if (e.ownSlot) { r.state.ownedSlots.add(e.ownSlot.slot); r.learned.slots.push(e.ownSlot); }
    if (e.ownItemId) { r.state.ownedItemIds.add(e.ownItemId); r.learned.itemIds.push(e.ownItemId); }
    if (e.expectHatchAt) r.pendingHatches.push(deps.now().getTime());
    return verdict;
  };

  function begin(input: unknown): BeginResult {
    if (!isBeginInput(input)) return { ok: false, reason: 'bad-input' };
    if (input.alert) return { ok: false, reason: 'alert' };
    // An auto-ended run still holds its events until end() collects them.
    if (run) return { ok: false, reason: 'open' };
    const data = deps.isReady() ? deps.readData() : null;
    if (!data) return { ok: false, reason: 'not-ready' };
    let before: FixtureSnapshot;
    try { before = buildSnapshot(data, deps.now()); } catch { return { ok: false, reason: 'not-ready' }; }
    const { kept, dropped } = reconcile(input.ledger.slots, before);
    const keptSlots = new Set(kept.map((s) => s.slot));
    const next: Run = {
      state: {
        runId: input.runId, config: input.config, spendCap: input.budget.spendCap, spent: 0, used: { seeds: 0, eggs: 0 },
        occupiedAtBegin: new Set(before.garden.map((g) => g.slot).filter((s) => !keptSlots.has(s))),
        ownedSlots: keptSlots, ownedPetIds: new Set(input.ledger.petIds), ownedItemIds: new Set(input.ledger.itemIds),
      },
      learned: { slots: [], petIds: [], itemIds: [] },
      events: [], backgroundSeen: new Set(), knownPets: new Set(before.pets.map((p) => p.id)),
      pendingHatches: [], endReason: null, teardown: [],
    };
    run = next;
    if (!deps.addGuard(GUARD_NAME, predicate)) {
      deps.removeGuard(GUARD_NAME);
      run = null;
      return { ok: false, reason: 'not-ready' };
    }
    next.teardown.push(() => deps.removeGuard(GUARD_NAME));
    const identity = deps.connectionIdentity();
    next.teardown.push(deps.onConnectionChange(() => {
      const current = deps.connectionIdentity();
      const swapped = current.length !== identity.length || current.some((v, i) => v !== identity[i]);
      if (swapped || !deps.guardActive()) close('connection-changed');
    }));
    next.teardown.push(deps.subscribeData(observePets));
    const onUnload = (): void => close('unload');
    deps.unloadTarget.addEventListener('pagehide', onUnload);
    next.teardown.push(() => deps.unloadTarget.removeEventListener('pagehide', onUnload));
    return { ok: true, before, ledgerDropped: dropped, allowlist: allowlistFor(before, input.config.allowRarity) };
  }

  function status(): FixtureStatus {
    if (!run) return { open: false, runId: null, spent: 0, used: { seeds: 0, eggs: 0 }, refusals: [], endReason: null };
    return {
      open: run.endReason === null, runId: run.state.runId, spent: run.state.spent, used: { ...run.state.used },
      refusals: run.events.filter((e) => e.verdict === 'refuse'), endReason: run.endReason,
    };
  }

  function end(): EndResult | { ok: false; reason: 'not-open' } {
    const r = run;
    if (!r) return { ok: false, reason: 'not-open' };
    if (!r.endReason) { observePets(); close('end'); }
    const data = deps.readData();
    // Thrown, not swallowed: the run stays recorded so end() can be retried once state is back.
    if (!data) throw new Error('fixture end: no seat data');
    const after = buildSnapshot(data, deps.now());
    const slots = r.learned.slots.map((s) => {
      const tile = after.garden.find((g) => g.slot === s.slot && g.objectType === s.kind && g.id === s.id);
      return tile?.objectId ? { ...s, objectId: tile.objectId } : s;
    });
    run = null;
    return {
      runId: r.state.runId, after, events: r.events, spent: r.state.spent,
      learned: { slots, petIds: [...r.learned.petIds], itemIds: [...r.learned.itemIds] },
      endReason: r.endReason ?? 'end',
    };
  }

  return { begin, status, end };
}
