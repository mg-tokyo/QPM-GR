import type { Coord, EndReason, ShotResult } from './types';
import { coordKey, resolveShot } from './board';
import { clearPreview } from './previewOverlay';
import {
  enterBattleStage,
  markShotOnMyBoard,
  markShotOnOppBoard,
  pickFleetSpecies,
  setOpponentStage,
  type GridSide,
} from './gardenStage';
import {
  startMpSession,
  sendChallengeMsg,
  sendAcceptMsg,
  sendDeclineMsg,
  decideOpeningTurn,
  type MpRole,
} from './mpSession';
import {
  _mpGetMatch,
  _mpSetMatch,
  _mpGetPendingChallenge,
  _mpSetPendingChallenge,
  _mpEmit,
  _mpEndMatch,
  _internal,
  type MatchInternal,
} from './state';
import { readAtomValueSync } from '../../core/atomRegistry';
import { selectSync } from '../../core/stateTree';
import { findSlotIdxByOwner, getPlayerIdSync } from '../../core/playerContext';
import { notify } from '../../core/notifications';
import { t } from '../../i18n';
import type { PlayerAtomValue } from '../../types/gameAtoms';

type Vec2 = { x: number; y: number };

/**
 * Placement 'Ready' path for MP. Computes hash+salt via mpSession, sends the
 * commit message, transitions to 'waitingReady'. If the opponent already sent
 * their ready before us (out-of-order handshake), kick off the battle now.
 */
export async function mpReady(m: MatchInternal): Promise<boolean> {
  if (!m.mp) return false;
  const res = await m.mp.sendReady(m.myLayout);
  if (!res.ok) {
    notify({
      feature: 'battleship',
      level: 'warn',
      message: t('feature.battleship.readySendFailed', undefined, 'Could not send your ready signal — try again.'),
    });
    return false;
  }
  m.phase = 'waitingReady';
  try { m.preview?.destroy(); } catch { /* ignore */ }
  m.preview = null;
  m.currentPreviewSnap = null;
  clearPreview();
  notify({
    feature: 'battleship',
    level: 'info',
    message: t('feature.battleship.waitingOpponent', undefined, 'Waiting for opponent to be ready…'),
  });
  _mpEmit();
  if (m.mp.bothReady()) startMpBattle(m);
  return true;
}

export function startMpBattle(m: MatchInternal): void {
  if (!m.mp || !m.mp.myHash8 || !m.mp.oppHash8) return;
  const chH = m.mpRole === 'challenger' ? m.mp.myHash8 : m.mp.oppHash8;
  const opH = m.mpRole === 'challenger' ? m.mp.oppHash8 : m.mp.myHash8;
  const firstTurn = decideOpeningTurn(chH, opH);
  m.myTurn = firstTurn === m.mpRole;
  m.phase = 'battle';
  try { m.preview?.destroy(); } catch { /* ignore */ }
  m.preview = null;
  m.currentPreviewSnap = null;
  clearPreview();
  const seed = readAtomValueSync('position') ?? readAtomValueSync('localPosition');
  _internal.updateAimFrom(seed as Vec2 | null);
  m.mp.markTurnActivity();
  notify({
    feature: 'battleship',
    level: 'info',
    message: m.myTurn
      ? t('feature.battleship.battleStartMine', undefined, 'You fire first — walk onto the enemy plot and press SPACE.')
      : t('feature.battleship.battleStartTheirs', undefined, 'Opponent fires first — hold tight.'),
  });
  _mpEmit();
}

// ─── MP entry points (re-exported via index.ts) ──────────────────────────

export function sendChallenge(playerId: string, playerName: string): boolean {
  const match = _mpGetMatch();
  if (match && match.phase !== 'ended') return false;
  const myPlayerId = getPlayerIdSync();
  if (!myPlayerId || myPlayerId === playerId) return false;
  const myName = readMyPlayerName();
  const ok = sendChallengeMsg(myName, playerName);
  if (!ok) {
    notify({
      feature: 'battleship',
      level: 'warn',
      message: t('feature.battleship.challengeSendFailed', undefined, 'Could not send challenge — try again.'),
    });
    return false;
  }
  const shell = createMpMatchShell('challenger', playerId, playerName, 0);
  _mpSetMatch(shell);
  installMpHooks(shell, playerId, playerName);
  notify({
    feature: 'battleship',
    level: 'info',
    message: t('feature.battleship.challengeSent', { name: playerName }, 'Waiting for {name} to accept…'),
  });
  _mpEmit();
  return true;
}

export function acceptChallenge(gridChoice: GridSide): boolean {
  const pending = _mpGetPendingChallenge();
  if (!pending) return false;
  const match = _mpGetMatch();
  if (match && match.phase !== 'ended') return false;
  _mpSetPendingChallenge(null);
  const myName = readMyPlayerName();
  const acceptOk = sendAcceptMsg(myName);
  if (!acceptOk) {
    notify({
      feature: 'battleship',
      level: 'warn',
      message: t('feature.battleship.acceptSendFailed', undefined, 'Could not send accept — try again.'),
    });
    _mpSetPendingChallenge(pending);
    return false;
  }
  const staged = enterBattleStage(gridChoice);
  if (!staged.ok) {
    notify({
      feature: 'battleship',
      level: 'warn',
      message: t('feature.battleship.stageFailed', undefined, 'Could not start — game systems not ready'),
    });
    return false;
  }
  const shell: MatchInternal = {
    mode: 'mp',
    phase: 'placing',
    mySlotIdx: staged.mySlotIdx,
    myGrid: gridChoice,
    oppSlotIdx: staged.mySlotIdx,
    oppGrid: 0,
    species: pickFleetSpecies(),
    myLayout: [],
    placementHorizontal: true,
    preview: null,
    currentPreviewSnap: null,
    currentAim: null,
    hitsOnMe: new Set(),
    hitsDealt: new Set(),
    shotsAtMe: new Set(),
    shotsAtThem: new Set(),
    shotCount: 0,
    myTurn: false,
    ai: null,
    aiLayout: null,
    opponentName: pending.playerName,
    endReason: null,
    cleanups: [],
    mp: null,
    mpRole: 'opponent',
    oppReveal: null,
    canClaimTimeoutWin: false,
    oppSunkCount: 0,
  };
  _mpSetMatch(shell);
  installMpHooks(shell, pending.playerId, pending.playerName);
  _internal.installGuards();
  _internal.installBattleKeyHandler();
  _internal.startAimTracker();
  notify({
    feature: 'battleship',
    level: 'info',
    message: t('feature.battleship.gardenHidden', undefined, 'Your real garden is hidden while you play — it is safe and untouched'),
  });
  _mpEmit();
  return true;
}

export function declineChallenge(): boolean {
  const pending = _mpGetPendingChallenge();
  if (!pending) return false;
  _mpSetPendingChallenge(null);
  sendDeclineMsg(readMyPlayerName());
  _mpEmit();
  return true;
}

export function claimTimeoutWin(): void {
  const match = _mpGetMatch();
  if (!match || !match.canClaimTimeoutWin) return;
  _mpEndMatch('timeoutClaim');
}

function readMyPlayerName(): string {
  const players = selectSync((s) => (s.data?.players ?? []) as PlayerAtomValue[]) ?? [];
  const myId = getPlayerIdSync();
  const me = players.find((p) => p?.id === myId);
  const name = typeof me?.name === 'string' && me.name.trim().length > 0 ? me.name : 'Player';
  return name;
}

function createMpMatchShell(
  role: MpRole,
  _opponentPlayerId: string,
  opponentName: string,
  myGrid: GridSide,
): MatchInternal {
  return {
    mode: 'mp',
    phase: 'waitingAccept',
    mySlotIdx: -1,
    myGrid,
    oppSlotIdx: -1,
    oppGrid: 0,
    species: pickFleetSpecies(),
    myLayout: [],
    placementHorizontal: true,
    preview: null,
    currentPreviewSnap: null,
    currentAim: null,
    hitsOnMe: new Set(),
    hitsDealt: new Set(),
    shotsAtMe: new Set(),
    shotsAtThem: new Set(),
    shotCount: 0,
    myTurn: false,
    ai: null,
    aiLayout: null,
    opponentName,
    endReason: null,
    cleanups: [],
    mp: null,
    mpRole: role,
    oppReveal: null,
    canClaimTimeoutWin: false,
    oppSunkCount: 0,
  };
}

function installMpHooks(m: MatchInternal, opponentPlayerId: string, opponentName: string): void {
  m.mp = startMpSession({
    role: m.mpRole ?? 'challenger',
    opponentPlayerId,
    opponentName,
    myGrid: m.myGrid,
    hooks: {
      getMyName: () => readMyPlayerName(),
      onIncomingChallenge() { /* handled by idle watcher */ },
      onOpponentAccepted(): boolean {
        const cur = _mpGetMatch();
        if (!cur || cur.phase !== 'waitingAccept') return false;
        const staged = enterBattleStage(cur.myGrid);
        if (!staged.ok) {
          notify({
            feature: 'battleship',
            level: 'warn',
            message: t('feature.battleship.stageFailed', undefined, 'Could not start — game systems not ready'),
          });
          _mpEndMatch('aborted');
          return false;
        }
        cur.mySlotIdx = staged.mySlotIdx;
        cur.oppSlotIdx = staged.mySlotIdx;
        cur.phase = 'placing';
        _internal.installGuards();
        _internal.installBattleKeyHandler();
        _internal.startAimTracker();
        notify({
          feature: 'battleship',
          level: 'info',
          message: t('feature.battleship.challengeAccepted', { name: opponentName }, '{name} accepted! Plant your fleet.'),
        });
        _mpEmit();
        return true;
      },
      onOpponentDeclined(): void {
        notify({
          feature: 'battleship',
          level: 'info',
          message: t('feature.battleship.challengeDeclined', { name: opponentName }, '{name} declined the challenge.'),
        });
        _mpEndMatch('aborted');
      },
      onOpponentReady(_fromId, _hash8, oppGrid): void {
        const cur = _mpGetMatch();
        if (!cur || !cur.mp) return;
        cur.oppGrid = oppGrid;
        setOpponentStage(opponentPlayerId, oppGrid);
        cur.oppSlotIdx = resolveOppSlotIdx(opponentPlayerId);
        if (cur.mp.bothReady() && cur.phase === 'waitingReady') startMpBattle(cur);
        _mpEmit();
      },
      onIncomingShot(at: Coord): ShotResult | null {
        const cur = _mpGetMatch();
        if (!cur || cur.phase !== 'battle') return null;
        const result = resolveShot(cur.myLayout, cur.hitsOnMe, at);
        cur.shotsAtMe.add(coordKey(at));
        if (result.verdict !== 'miss') {
          cur.hitsOnMe.add(coordKey(at));
          markShotOnMyBoard(at, 'hit');
        } else {
          markShotOnMyBoard(at, 'miss');
        }
        if (result.verdict === 'miss') {
          cur.myTurn = true;
          cur.mp?.markTurnActivity();
        }
        _mpEmit();
        return result;
      },
      onIncomingVerdict(at: Coord, result: ShotResult): void {
        const cur = _mpGetMatch();
        if (!cur || cur.phase !== 'battle') return;
        if (result.verdict === 'miss') {
          markShotOnOppBoard(at, 'miss');
          cur.myTurn = false;
          cur.mp?.markTurnActivity();
          _mpEmit();
          return;
        }
        cur.hitsDealt.add(coordKey(at));
        markShotOnOppBoard(at, 'hit', result.species);
        if (result.verdict === 'sunk' || result.verdict === 'win') cur.oppSunkCount++;
        if (result.verdict === 'win') {
          cur.mp?.sendReveal();
          notify({
            feature: 'battleship',
            level: 'success',
            message: t('feature.battleship.win', undefined, 'Victory! You harvested the whole enemy garden'),
          });
          _mpEndMatch('win');
          return;
        }
        _mpEmit();
      },
      onIncomingReveal(compact: string, salt: string): void {
        const cur = _mpGetMatch();
        if (!cur || !cur.mp) return;
        cur.oppReveal = { compact, salt };
        void cur.mp.verifyOpponentReveal().then((ok) => {
          if (!ok) {
            notify({
              feature: 'battleship',
              level: 'warn',
              message: t('feature.battleship.voidMismatch', undefined, 'Opponent layout did not match their commit — match voided.'),
            });
            const m2 = _mpGetMatch();
            if (m2 && m2.phase !== 'ended') _mpEndMatch('voidMismatch');
          }
        });
      },
      onOpponentResigned(): void {
        const cur = _mpGetMatch();
        if (!cur || cur.phase === 'ended') return;
        notify({
          feature: 'battleship',
          level: 'info',
          message: t('feature.battleship.opponentResigned', { name: opponentName }, '{name} resigned. You win!'),
        });
        _mpEndMatch('opponentResign');
      },
      onOpponentLeft(): void {
        const cur = _mpGetMatch();
        if (!cur || cur.phase === 'ended') return;
        notify({
          feature: 'battleship',
          level: 'warn',
          message: t('feature.battleship.opponentLeft', { name: opponentName }, '{name} left the room — match ended.'),
        });
        _mpEndMatch('opponentLeft');
      },
      onTurnTimeout(): void {
        const cur = _mpGetMatch();
        if (!cur || cur.phase === 'ended') return;
        cur.canClaimTimeoutWin = true;
        notify({
          feature: 'battleship',
          level: 'info',
          message: t('feature.battleship.turnTimeout', undefined, 'Opponent is taking a long time. You can claim the win.'),
        });
        _mpEmit();
      },
      onOutgoingVerdictSent(): void { /* visuals already updated */ },
    },
  });
}

function resolveOppSlotIdx(oppPlayerId: string): number {
  const slots = selectSync((s) => s.child?.data?.userSlots ?? []) ?? [];
  return findSlotIdxByOwner(slots, oppPlayerId);
}

export type { EndReason };
