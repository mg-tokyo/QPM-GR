import type { Coord, EndReason, FleetLayout, ShotResult } from './types';
import type { GridSide } from './gardenStage';
import {
  layoutToCompact,
  hashLayout,
  makeSalt,
  firstTurnFromHashes,
  compactToLayout,
} from './protocol';
import { openChatChannel, sendGameMsg, type ChatChannelHandle, type IncomingGameMsg } from './chatChannel';
import { OPPONENT_TIMEOUT_MS, TURN_SOFT_TIMEOUT_MS } from './constants';
import { subscribe as subscribeState } from '../../core/stateTree';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { notify } from '../../core/notifications';
import { createNamedLogger } from '../../diagnostics/logger';
import type { PlayerAtomValue } from '../../types/gameAtoms';
import { t } from '../../i18n';

const log = createNamedLogger('battleship');

export type MpRole = 'challenger' | 'opponent';

export interface MpSessionHooks {
  getMyName(): string;
  onIncomingChallenge(fromPlayerId: string, fromName: string): void;
  onOpponentAccepted(fromPlayerId: string): boolean;
  onOpponentDeclined(): void;
  onOpponentReady(fromPlayerId: string, hash8: string, oppGrid: GridSide): void;
  onIncomingShot(at: Coord): ShotResult | null;
  onIncomingVerdict(at: Coord, result: ShotResult): void;
  onIncomingReveal(layoutCompact: string, salt: string): void;
  onOpponentResigned(): void;
  onOpponentLeft(): void;
  onTurnTimeout(): void;
  onOutgoingVerdictSent(at: Coord, result: ShotResult): void;
}

export interface MpSession {
  role: MpRole;
  opponentPlayerId: string;
  opponentName: string;
  myGrid: GridSide;
  oppGrid: GridSide | null;
  myHash8: string | null;
  mySalt: string | null;
  myLayoutCompact: string | null;
  oppHash8: string | null;
  oppLayoutCompact: string | null;
  oppSalt: string | null;
  bothReady(): boolean;
  sendReady(layout: FleetLayout): Promise<{ ok: boolean; hash8: string | null }>;
  sendShot(at: Coord): boolean;
  sendVerdict(at: Coord, result: ShotResult): boolean;
  sendReveal(): boolean;
  sendResign(): boolean;
  verifyOpponentReveal(): Promise<boolean>;
  markTurnActivity(): void;
  destroy(): void;
}

/**
 * Feature-level chat listener that catches incoming 'challenge' messages while
 * no match is running. Once a match starts, it hands off to the match's own
 * MpSession (which opens its own chatChannel).
 */
export function openIdleChatWatcher(opts: {
  /** Called at msg time to resolve MY current display name (may change if
   *  the player renames themselves mid-session). */
  getMyName(): string;
  onIncomingChallenge(fromPlayerId: string, fromName: string): void;
}): () => void {
  const chat = openChatChannel({
    onGameMsg({ msg, fromPlayerId }) {
      if (msg.kind !== 'challenge') return;
      const myName = opts.getMyName();
      if (!myName || msg.to !== myName) return;
      opts.onIncomingChallenge(fromPlayerId, msg.from);
    },
  });
  return () => chat.close();
}

interface StartMpArgs {
  role: MpRole;
  opponentPlayerId: string;
  opponentName: string;
  myGrid: GridSide;
  hooks: MpSessionHooks;
}

export function startMpSession(args: StartMpArgs): MpSession {
  const state: {
    role: MpRole;
    opponentPlayerId: string;
    opponentName: string;
    myGrid: GridSide;
    oppGrid: GridSide | null;
    myHash8: string | null;
    mySalt: string | null;
    myLayoutCompact: string | null;
    oppHash8: string | null;
    oppLayoutCompact: string | null;
    oppSalt: string | null;
    chat: ChatChannelHandle | null;
    cleanups: Array<() => void>;
    turnTimerStop: (() => void) | null;
    turnStartAt: number;
  } = {
    role: args.role,
    opponentPlayerId: args.opponentPlayerId,
    opponentName: args.opponentName,
    myGrid: args.myGrid,
    oppGrid: null,
    myHash8: null,
    mySalt: null,
    myLayoutCompact: null,
    oppHash8: null,
    oppLayoutCompact: null,
    oppSalt: null,
    chat: null,
    cleanups: [],
    turnTimerStop: null,
    turnStartAt: Date.now(),
  };

  const hooks = args.hooks;
  const myName = (): string => hooks.getMyName();

  state.chat = openChatChannel({
    onGameMsg(inc: IncomingGameMsg) {
      // Only accept messages from our declared opponent — third parties in
      // the room might paste ⚓ lines but they're not part of this match.
      if (inc.fromPlayerId !== state.opponentPlayerId) return;
      const m = inc.msg;
      switch (m.kind) {
        case 'accept':
          hooks.onOpponentAccepted(inc.fromPlayerId);
          break;
        case 'decline':
          hooks.onOpponentDeclined();
          break;
        case 'ready':
          state.oppHash8 = m.hash8;
          state.oppGrid = m.grid;
          hooks.onOpponentReady(inc.fromPlayerId, m.hash8, m.grid);
          break;
        case 'shot': {
          const result = hooks.onIncomingShot(m.at);
          if (result) {
            const sent = sendGameMsg({ kind: 'verdict', at: m.at, result }, myName());
            if (sent) hooks.onOutgoingVerdictSent(m.at, result);
          }
          break;
        }
        case 'verdict':
          hooks.onIncomingVerdict(m.at, m.result);
          break;
        case 'reveal':
          state.oppLayoutCompact = m.layoutCompact;
          state.oppSalt = m.salt;
          hooks.onIncomingReveal(m.layoutCompact, m.salt);
          break;
        case 'resign':
          hooks.onOpponentResigned();
          break;
        case 'challenge':
        case 'rematch':
          break;
      }
    },
  });

  const stopPlayersWatch = subscribeState(
    (s) => (s.data?.players ?? []) as PlayerAtomValue[],
    (players) => {
      if (!players) return;
      const stillHere = players.some((p) => p?.id === state.opponentPlayerId);
      if (!stillHere) hooks.onOpponentLeft();
    },
    'battleship-mp-players',
  );
  state.cleanups.push(stopPlayersWatch);

  // Turn timers: no reactive "N seconds elapsed" primitive exists — polling
  // via visibleInterval (the QPM timer facade) is the correct pattern.
  function resetTurnTimer(): void {
    if (state.turnTimerStop) {
      try { state.turnTimerStop(); } catch { /* ignore */ }
      state.turnTimerStop = null;
    }
    state.turnStartAt = Date.now();
    let softNudged = false;
    const stop = visibleInterval('qpm-bs-mp-turn', () => {
      const elapsed = Date.now() - state.turnStartAt;
      if (!softNudged && elapsed >= TURN_SOFT_TIMEOUT_MS) {
        softNudged = true;
        notify({
          feature: 'battleship',
          level: 'info',
          message: t('feature.battleship.slowNudge', undefined, 'Waiting on the opponent…'),
        });
      }
      if (elapsed >= OPPONENT_TIMEOUT_MS) {
        try { state.turnTimerStop?.(); } catch { /* ignore */ }
        state.turnTimerStop = null;
        hooks.onTurnTimeout();
      }
    }, 5000);
    state.turnTimerStop = stop;
    state.cleanups.push(stop);
  }

  const session: MpSession = {
    get role() { return state.role; },
    get opponentPlayerId() { return state.opponentPlayerId; },
    get opponentName() { return state.opponentName; },
    get myGrid() { return state.myGrid; },
    get oppGrid() { return state.oppGrid; },
    get myHash8() { return state.myHash8; },
    get mySalt() { return state.mySalt; },
    get myLayoutCompact() { return state.myLayoutCompact; },
    get oppHash8() { return state.oppHash8; },
    get oppLayoutCompact() { return state.oppLayoutCompact; },
    get oppSalt() { return state.oppSalt; },
    bothReady(): boolean {
      return state.myHash8 !== null && state.oppHash8 !== null;
    },
    async sendReady(layout: FleetLayout): Promise<{ ok: boolean; hash8: string | null }> {
      const compact = layoutToCompact(layout);
      const salt = makeSalt();
      let fullHash: string;
      try {
        fullHash = await hashLayout(compact, salt);
      } catch (err) {
        log.warn('QPM-BS-MP-002', { reason: 'hash_failed' }, err);
        return { ok: false, hash8: null };
      }
      const hash8 = fullHash.slice(0, 8);
      state.myLayoutCompact = compact;
      state.mySalt = salt;
      state.myHash8 = hash8;
      const ok = sendGameMsg({ kind: 'ready', hash8, grid: state.myGrid }, myName());
      return { ok, hash8: ok ? hash8 : null };
    },
    sendShot(at: Coord): boolean {
      const ok = sendGameMsg({ kind: 'shot', at }, myName());
      if (ok) resetTurnTimer();
      return ok;
    },
    sendVerdict(at: Coord, result: ShotResult): boolean {
      return sendGameMsg({ kind: 'verdict', at, result }, myName());
    },
    sendReveal(): boolean {
      if (!state.myLayoutCompact || !state.mySalt) return false;
      return sendGameMsg(
        { kind: 'reveal', layoutCompact: state.myLayoutCompact, salt: state.mySalt },
        myName(),
      );
    },
    sendResign(): boolean {
      return sendGameMsg({ kind: 'resign' }, myName());
    },
    async verifyOpponentReveal(): Promise<boolean> {
      if (!state.oppHash8 || !state.oppLayoutCompact || !state.oppSalt) return false;
      let full: string;
      try {
        full = await hashLayout(state.oppLayoutCompact, state.oppSalt);
      } catch (err) {
        log.warn('QPM-BS-MP-003', { reason: 'verify_hash_failed' }, err);
        return false;
      }
      return full.startsWith(state.oppHash8);
    },
    markTurnActivity(): void {
      resetTurnTimer();
    },
    destroy(): void {
      for (const c of state.cleanups.splice(0)) {
        try { c(); } catch { /* ignore */ }
      }
      state.turnTimerStop = null;
      try { state.chat?.close(); } catch { /* ignore */ }
      state.chat = null;
    },
  };

  return session;
}

export function sendChallengeMsg(myName: string, toName: string): boolean {
  return sendGameMsg({ kind: 'challenge', from: myName, to: toName }, myName);
}

export function sendAcceptMsg(myName: string): boolean {
  return sendGameMsg({ kind: 'accept' }, myName);
}

export function sendDeclineMsg(myName: string): boolean {
  return sendGameMsg({ kind: 'decline' }, myName);
}

export function decodeRevealedLayout(compact: string, speciesFor: (id: string) => string): FleetLayout | null {
  return compactToLayout(compact, speciesFor);
}

export function decideOpeningTurn(challengerHash8: string, opponentHash8: string): 'challenger' | 'opponent' {
  return firstTurnFromHashes(challengerHash8, opponentHash8);
}

export type { EndReason };
