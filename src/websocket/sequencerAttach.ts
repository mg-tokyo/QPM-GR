// Install, defuse and re-arm of the command sequencer's send wrappers. Counters
// and result handling stay in commandSequencer.ts and are reached only through
// hooks, so the only wire-number assignment (in `rewrite`) stays there.

import { createNamedLogger } from '../diagnostics/logger';
import { notifyChainChanged } from './roomConnectionEvents';
import {
  brandWrapper,
  captureSendSlot,
  classifySendSlot,
  describeSendSlot,
  restoreSendSlot,
  type CapturedSlot,
  type ForeignEpisodeGate,
  type SendChainReport,
  type SendSlotClass,
} from './sendChain';
import { toUnsub } from './sequencerSocket';
import { discoverSendChokepoint } from './sendChokepoint';

const log = createNamedLogger('websocket');

export interface RoomFrameLike { executedCommandSequence?: unknown }

export interface SequencerConnection {
  sendMessage: (payload: unknown) => unknown;
  trySendMessageNow?: (payload: unknown) => boolean;
  subscribeToWelcome?: (cb: (state: unknown, publishedAtServerMs?: unknown, executedCommandSequence?: unknown) => void) => unknown;
  subscribeToRoomFrames?: (cb: (frame: RoomFrameLike) => void) => unknown;
  lastDistributedRoomPublication?: { executedCommandSequence?: unknown };
  ws?: WebSocket | null;
  socket?: WebSocket | null;
  currentWebSocket?: WebSocket | null;
  // False before Welcome. Envelopes sent via `sendMessage` in that window get
  // queued and later flushed with a stale commandSequence — CS-3 guard skips
  // rewrite so they land as legacy and don't burn a fresh number.
  isCommandSessionReady?: boolean;
}

// One record per connection. `live: false` means the wrapper is defused
// (buried under outer wrappers, pass-through, re-armable on a later event).
interface InstallRecord {
  live: boolean;
  send: CapturedSlot;
  trySlot: CapturedSlot | null;
  wrappedSend: (payload: unknown) => unknown;
  wrappedTry: ((payload: unknown) => boolean) | null;
  unsubWelcome: (() => void) | null;
  unsubFrames: (() => void) | null;
}

type ChokepointFn = (payload: unknown, ...rest: unknown[]) => unknown;

// Chokepoint mode: one own-property wrapper on the method both slot methods
// call, so every slot wrapper (ours or a third party's) sits above it.
interface ChokepointRecord {
  live: boolean;
  key: string;
  wrapped: ChokepointFn;
  unsubWelcome: (() => void) | null;
  unsubFrames: (() => void) | null;
}

type AttachMode = 'slot' | 'chokepoint';

type Attached =
  | { mode: 'slot'; room: SequencerConnection; record: InstallRecord }
  | { mode: 'chokepoint'; room: SequencerConnection; record: ChokepointRecord };

export interface AttachStats {
  layeringRefusals: number;
  rearms: number;
  defusedDetaches: number;
  chokepointCovered: number;
  chokepointReinstalls: number;
  chokepointBypassed: number;
}

export interface SequencerAttachHooks {
  getRoom: () => SequencerConnection | null;
  observeOutbound: (payload: unknown) => void;
  // CS-3: true when the payload must go out without a rewrite (counts and warns itself).
  skipPreSession: (room: SequencerConnection, payload: unknown) => boolean;
  rewrite: (payload: unknown) => number | null;
  rollback: (seq: number) => void;
  onFrame: (frame: RoomFrameLike) => void;
  onWelcome: (seq: unknown) => void;
  seedIfUnseeded: (room: SequencerConnection) => void;
  // Rebind the result listener to the room's current socket, then run the idle resync.
  refresh: (room: SequencerConnection) => void;
  counters: () => { wire: number; frontier: number };
  stats: AttachStats;
  gate: ForeignEpisodeGate;
}

export interface SequencerAttach {
  ensureAttached: () => void;
  detach: () => void;
  attachedRoom: () => SequencerConnection | null;
  isLive: () => boolean;
  resetWarnings: () => void;
  describe: () => { mode: AttachMode | null; chokepointKey: string | null };
  // A QPM envelope the sequencer never numbered came back invalid_message.
  reportBypass: (context: { type: string; requestId: string }) => boolean;
  chain: () => SendChainReport | null;
}

export function createSequencerAttach(hooks: SequencerAttachHooks): SequencerAttach {
  const installs = new WeakMap<SequencerConnection, InstallRecord>();
  let attached: Attached | null = null;
  const chokepoints = new WeakMap<SequencerConnection, ChokepointRecord>();
  const refusedChokepoint = new WeakSet<SequencerConnection>();
  const slotOnly = new WeakSet<SequencerConnection>();
  const coveredSeen = new WeakSet<object>();
  // QPM-branded wrapper on top but no re-armable record — warn once.
  let qpmToppedWarned = false;
  // Slot mode: rooms where a foreign slot wrapper was refused this session.
  const refusedRooms = new WeakSet<SequencerConnection>();
  let buriedWarned = false;

  function detach(): void {
    const current = attached;
    if (!current) return;
    if (current.mode === 'chokepoint') {
      detachChokepoint(current.room, current.record);
      attached = null;
      return;
    }
    const { room, record } = current;
    try { record.unsubWelcome?.(); } catch { /* noop */ }
    try { record.unsubFrames?.(); } catch { /* noop */ }
    record.unsubWelcome = null;
    record.unsubFrames = null;
    let sendRestored = false;
    let tryRestored = true;
    try { sendRestored = restoreSendSlot(room, 'sendMessage', record.send, record.wrappedSend); } catch { /* noop */ }
    try {
      if (record.wrappedTry && record.trySlot) {
        tryRestored = restoreSendSlot(room, 'trySendMessageNow', record.trySlot, record.wrappedTry);
      }
    } catch { tryRestored = false; }
    if (sendRestored && tryRestored) {
      installs.delete(room);
    } else {
      // Buried under outer wrappers — defuse: the closures become transparent
      // pass-throughs and the record stays re-armable for this connection.
      record.live = false;
      hooks.stats.defusedDetaches++;
    }
    attached = null;
  }

  function detachChokepoint(room: SequencerConnection, record: ChokepointRecord): void {
    try { record.unsubWelcome?.(); } catch { /* noop */ }
    try { record.unsubFrames?.(); } catch { /* noop */ }
    record.unsubWelcome = null;
    record.unsubFrames = null;
    const rec = room as unknown as Record<string, unknown>;
    let restored = false;
    try {
      if (rec[record.key] === record.wrapped) restored = Reflect.deleteProperty(rec, record.key);
    } catch { restored = false; }
    if (restored) {
      chokepoints.delete(room);
    } else {
      // Another script covers our wrapper: defuse to a pass-through and keep
      // the record so the next attach re-arms it in place.
      record.live = false;
      hooks.stats.defusedDetaches++;
    }
  }

  function ensureAttached(): void {
    const room = hooks.getRoom();
    if (!room) return;
    if (attached && attached.room === room) {
      if (attached.mode === 'chokepoint') verifyChokepoint(room, attached.record);
      hooks.refresh(room);
      return;
    }
    detach();
    const key = slotOnly.has(room) ? null : discoverSendChokepoint(Object.getPrototypeOf(room) as object | null);
    if (key !== null) {
      attachChokepoint(room, key);
      return;
    }
    attachSlots(room);
  }

  function attachSlots(room: SequencerConnection): void {
    // CS-5: an own-property send function that is neither the prototype method
    // nor QPM-branded is a third-party wrapper; attaching under it would burn a
    // number for every send its layer refuses. QPM-branded tops are our own
    // outer wrappers over a buried (defused) sequencer wrapper: re-arm it.
    const sendClass = classifySendSlot(room, 'sendMessage');
    const tryClass = classifySendSlot(room, 'trySendMessageNow');
    const foreignSend = sendClass === 'foreign';
    const foreignTry = tryClass === 'foreign';
    if (foreignSend || foreignTry) {
      hooks.stats.layeringRefusals++;
      refusedRooms.add(room);
      const refusal = hooks.gate.refused();
      if (refusal.warn) {
        log.warn('QPM-WS-013', { phase: 'layering', foreignSend, foreignTry, sustainedChecks: refusal.checks });
      }
      return;
    }
    const qpmTop = sendClass === 'qpm' || tryClass === 'qpm';
    if (qpmTop && !installs.has(room) && refusedRooms.has(room)) {
      // QPM outers cover the foreign wrapper we refused: episode still active.
      hooks.stats.layeringRefusals++;
      hooks.gate.refused();
      if (!buriedWarned) {
        buriedWarned = true;
        log.warn('QPM-WS-013', { phase: 'buried', sendClass, tryClass });
      }
      return;
    }
    const episode = hooks.gate.cleared();
    if (episode?.warned) {
      log.info('foreign send wrapper cleared', { checks: episode.checks, durationMs: episode.durationMs });
    }

    if (sendClass === 'qpm' || tryClass === 'qpm') {
      const record = installs.get(room);
      if (!record) {
        // Our outer wrappers sit on the slots with no sequencer wrapper below:
        // the kill switch was off when they installed, or a chokepoint bypass
        // moved this room to slot mode mid-session. Attaching on top would break
        // the innermost invariant; a reload with the switch on re-orders it.
        if (!qpmToppedWarned) {
          qpmToppedWarned = true;
          log.warn('QPM-WS-008', { phase: 'layering', qpmBranded: true, rearmable: false });
        }
        return;
      }
      rearm(room, record, sendClass, tryClass);
      return;
    }

    // Chain fully unwound — any old record's wrapper is no longer installed.
    installs.delete(room);

    const sendSlot = captureSendSlot(room, 'sendMessage');
    if (!sendSlot) return;
    const trySlot = captureSendSlot(room, 'trySendMessageNow');

    const record: InstallRecord = {
      live: true,
      send: sendSlot,
      trySlot,
      wrappedSend: sendSlot.bound,
      wrappedTry: null,
      unsubWelcome: null,
      unsubFrames: null,
    };
    const wrappedSend = brandWrapper((payload: unknown): unknown => {
      if (!record.live) return sendSlot.bound(payload);
      hooks.observeOutbound(payload);
      if (hooks.skipPreSession(room, payload)) return sendSlot.bound(payload);
      hooks.rewrite(payload);
      return sendSlot.bound(payload);
    }, 'commandSequencer', sendSlot.inner);
    record.wrappedSend = wrappedSend;
    const wrappedTry = trySlot
      ? brandWrapper((payload: unknown): boolean => {
          if (!record.live) return trySlot.bound(payload) === true;
          hooks.observeOutbound(payload);
          const seq = hooks.rewrite(payload);
          const sent = trySlot.bound(payload);
          if (seq !== null && sent !== true) hooks.rollback(seq);
          return sent === true;
        }, 'commandSequencer', trySlot.inner)
      : null;
    record.wrappedTry = wrappedTry;

    try {
      room.sendMessage = wrappedSend;
      if (wrappedTry) room.trySendMessageNow = wrappedTry;
      subscribeRoom(room, record);
      hooks.seedIfUnseeded(room);
      installs.set(room, record);
      refusedRooms.delete(room);
      attached = { mode: 'slot', room, record };
      qpmToppedWarned = false;
      hooks.refresh(room);
      notifyChainChanged();
      log.debug('command sequencer attached', { ...hooks.counters(), hasTry: !!trySlot });
    } catch (err) {
      try { restoreSendSlot(room, 'sendMessage', sendSlot, wrappedSend); } catch { /* noop */ }
      try { if (wrappedTry && trySlot) restoreSendSlot(room, 'trySendMessageNow', trySlot, wrappedTry); } catch { /* noop */ }
      try { record.unsubWelcome?.(); } catch { /* noop */ }
      try { record.unsubFrames?.(); } catch { /* noop */ }
      installs.delete(room);
      attached = null;
      log.warn('QPM-WS-008', { phase: 'attach' }, err);
    }
  }

  // Re-enter a defused install: the wrapper is still buried in the chain, so
  // re-arming it (not wrapping on top) preserves the innermost position. Slots
  // classified 'clean' get our wrapper re-installed — the captured original is
  // still valid because our own restore returned the slot to its prior state.
  function rearm(
    room: SequencerConnection,
    record: InstallRecord,
    sendClass: SendSlotClass,
    tryClass: SendSlotClass,
  ): void {
    try {
      if (sendClass === 'clean') room.sendMessage = record.wrappedSend;
      if (tryClass === 'clean' && record.wrappedTry) room.trySendMessageNow = record.wrappedTry;
      // Welcome fires synchronously when connected — reseeds wire/frontier,
      // which may have reset server-side while the wrapper was defused.
      subscribeRoom(room, record);
      record.live = true;
      attached = { mode: 'slot', room, record };
      hooks.stats.rearms++;
      qpmToppedWarned = false;
      hooks.refresh(room);
      notifyChainChanged();
      log.debug('command sequencer re-armed', { ...hooks.counters(), sendClass, tryClass });
    } catch (err) {
      record.live = false;
      try { record.unsubWelcome?.(); } catch { /* noop */ }
      try { record.unsubFrames?.(); } catch { /* noop */ }
      record.unsubWelcome = null;
      record.unsubFrames = null;
      attached = null;
      log.warn('QPM-WS-008', { phase: 'rearm' }, err);
    }
  }

  function subscribeRoom(
    room: SequencerConnection,
    record: { unsubWelcome: (() => void) | null; unsubFrames: (() => void) | null },
  ): void {
    if (typeof room.subscribeToRoomFrames === 'function') {
      record.unsubFrames = toUnsub(room.subscribeToRoomFrames(hooks.onFrame));
    }
    if (typeof room.subscribeToWelcome === 'function') {
      // Fires synchronously with the current publication when already connected.
      record.unsubWelcome = toUnsub(room.subscribeToWelcome((_state, _ms, seq) => hooks.onWelcome(seq)));
    }
  }

  function attachChokepoint(room: SequencerConnection, key: string): void {
    const slotClass = classifySendSlot(room, key);
    const existing = chokepoints.get(room);
    if (existing) {
      rearmChokepoint(room, existing, slotClass);
      return;
    }
    // Something already wraps the chokepoint: numbering under it would burn a
    // number for every send it refuses (CS-5). Refuse, keep room.send active.
    if (slotClass !== 'clean') {
      hooks.stats.layeringRefusals++;
      hooks.gate.refused();
      if (!refusedChokepoint.has(room)) {
        refusedChokepoint.add(room);
        log.warn('QPM-WS-013', { phase: 'chokepoint', key, slotClass });
      }
      return;
    }
    const proto = Object.getPrototypeOf(room) as Record<string, unknown> | null;
    const native = proto?.[key];
    if (typeof native !== 'function') return;
    const original = native as ChokepointFn;
    const episode = hooks.gate.cleared();
    if (episode?.warned) {
      log.info('foreign send wrapper cleared', { checks: episode.checks, durationMs: episode.durationMs });
    }
    const record: ChokepointRecord = { live: true, key, wrapped: original, unsubWelcome: null, unsubFrames: null };
    // The game reaches this only for a message it is writing now
    // (trySendMessageNow returns false before it), so there is no rollback.
    const wrapped = brandWrapper((payload: unknown, ...rest: unknown[]): unknown => {
      if (record.live) {
        hooks.observeOutbound(payload);
        if (!hooks.skipPreSession(room, payload)) hooks.rewrite(payload);
      }
      return original.call(room, payload, ...rest);
    }, 'commandSequencer', original);
    record.wrapped = wrapped;
    const rec = room as unknown as Record<string, unknown>;
    try {
      rec[key] = wrapped;
      subscribeRoom(room, record);
      hooks.seedIfUnseeded(room);
      chokepoints.set(room, record);
      attached = { mode: 'chokepoint', room, record };
      qpmToppedWarned = false;
      hooks.refresh(room);
      notifyChainChanged();
      log.debug('command sequencer attached', { mode: 'chokepoint', key, ...hooks.counters() });
    } catch (err) {
      try { if (rec[key] === wrapped) Reflect.deleteProperty(rec, key); } catch { /* noop */ }
      try { record.unsubWelcome?.(); } catch { /* noop */ }
      try { record.unsubFrames?.(); } catch { /* noop */ }
      chokepoints.delete(room);
      attached = null;
      log.warn('QPM-WS-008', { phase: 'attach', mode: 'chokepoint', key }, err);
    }
  }

  function rearmChokepoint(room: SequencerConnection, record: ChokepointRecord, slotClass: SendSlotClass): void {
    const rec = room as unknown as Record<string, unknown>;
    try {
      if (slotClass === 'clean') rec[record.key] = record.wrapped;
      subscribeRoom(room, record);
      record.live = true;
      attached = { mode: 'chokepoint', room, record };
      hooks.stats.rearms++;
      qpmToppedWarned = false;
      hooks.refresh(room);
      notifyChainChanged();
      log.debug('command sequencer re-armed', { mode: 'chokepoint', key: record.key, slotClass, ...hooks.counters() });
    } catch (err) {
      record.live = false;
      try { record.unsubWelcome?.(); } catch { /* noop */ }
      try { record.unsubFrames?.(); } catch { /* noop */ }
      record.unsubWelcome = null;
      record.unsubFrames = null;
      attached = null;
      log.warn('QPM-WS-008', { phase: 'rearm', mode: 'chokepoint', key: record.key }, err);
    }
  }

  // The game never reassigns this method, so any change is another script. A
  // cover that delegates is harmless; one that does not is caught by reportBypass.
  function verifyChokepoint(room: SequencerConnection, record: ChokepointRecord): void {
    const rec = room as unknown as Record<string, unknown>;
    const top = rec[record.key];
    if (top === record.wrapped) return;
    const slotClass = classifySendSlot(room, record.key);
    if (slotClass === 'clean') {
      try {
        rec[record.key] = record.wrapped;
        hooks.stats.chokepointReinstalls++;
        log.info('command sequencer chokepoint reinstalled', { key: record.key });
      } catch (err) {
        log.warn('QPM-WS-008', { phase: 'rearm', mode: 'chokepoint', key: record.key }, err);
      }
      return;
    }
    if (typeof top === 'function' && !coveredSeen.has(top)) {
      coveredSeen.add(top);
      hooks.stats.chokepointCovered++;
      log.info('command sequencer chokepoint covered', { key: record.key, slotClass });
    }
  }

  function reportBypass(context: { type: string; requestId: string }): boolean {
    const current = attached;
    if (!current || current.mode !== 'chokepoint' || !current.record.live) return false;
    hooks.stats.chokepointBypassed++;
    log.warn('QPM-WS-015', { phase: 'bypassed', key: current.record.key, ...context });
    slotOnly.add(current.room);
    detach();
    ensureAttached();
    return true;
  }

  function chain(): SendChainReport | null {
    const room = hooks.getRoom();
    if (!room) return null;
    const key = attached?.mode === 'chokepoint' ? attached.record.key : null;
    return {
      mode: attached?.mode ?? null,
      live: attached?.record.live ?? false,
      chokepointKey: key,
      sendMessage: describeSendSlot(room, 'sendMessage'),
      trySendMessageNow: describeSendSlot(room, 'trySendMessageNow'),
      chokepoint: key ? describeSendSlot(room, key) : null,
    };
  }

  return {
    ensureAttached,
    detach,
    attachedRoom: () => attached?.room ?? null,
    isLive: () => attached !== null && attached.record.live,
    resetWarnings: () => { qpmToppedWarned = false; buriedWarned = false; },
    describe: () => ({
      mode: attached?.mode ?? null,
      chokepointKey: attached?.mode === 'chokepoint' ? attached.record.key : null,
    }),
    reportBypass,
    chain,
  };
}
