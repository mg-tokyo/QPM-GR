import { atomObjectFor, readSync, subscribe } from '../../core/gameState';
import { pageWindow } from '../../core/pageContext';
import { setNpcDialoguePayloadSource } from '../../diagnostics/copyPayload';
import { createNamedLogger } from '../../diagnostics/logger';
import { isAriesInstalled } from '../../integrations/ariesDetection';
import { isRecord } from '../../utils/typeGuards';
import { getCompanionInjectorDiagnostics, startCompanionInjector } from './companionInjector';
import { collectCandidates, renderFirst } from './lineRender';
import { PROVIDERS } from './providers';
import {
  initialSelectorState,
  markServed,
  selectLine,
  type SelectorState,
} from './selector';
import { getNpcDialogueSettings } from './settings';
import { hasNpcSpawn, isCompanionActive, resolveSpeaker } from './speakers';
import {
  ensureTalkInterceptor,
  getInterceptorState,
  installTalkInterceptor,
  uninstallTalkInterceptor,
} from './talkInterceptor';
import type { BubbleLine, LineId } from './types';

export {
  LINE_IDS,
  getNpcDialogueSettings,
  setNpcDialogueCompanionInject,
  setNpcDialogueEnabled,
  setNpcDialogueLineEnabled,
} from './settings';
export type { NpcDialogueSettings } from './settings';

const log = createNamedLogger('feature.npcDialogue');

const cleanups: Array<() => void> = [];
let started = false;
let selectorState: SelectorState = initialSelectorState();
let lastLine: LineId | null = null;
let lastInjectedLine: LineId | null = null;
let companionSeen = false;
let installWarned = false;
let injectorStop: (() => void) | null = null;
let injectSurfaceWarned = false;

// Aries's Companion owns its borrowed NPC's bubble: it emits proactive proposals via ariesAuthored writes,
// and forwards user-Talks as game-native bubbles that carry no marker. `window.Companion.isRunning()` is the
// authoritative signal; `isAriesInstalled()` caches false when Aries loads after the 3 s detection window.
interface CompanionSurface { isRunning?: () => unknown; getNpcId?: () => unknown; say?: unknown }
function getCompanion(): CompanionSurface | null {
  try {
    const comp = (pageWindow as unknown as { Companion?: unknown }).Companion;
    return isRecord(comp) ? (comp as CompanionSurface) : null;
  } catch { return null; }
}
function isCompanionRunning(): boolean {
  try {
    const c = getCompanion();
    return c !== null && typeof c.isRunning === 'function' && c.isRunning() === true;
  } catch { return false; }
}
function isCompanionNpc(npcId: string): boolean {
  try {
    const c = getCompanion();
    if (!c || typeof c.isRunning !== 'function' || typeof c.getNpcId !== 'function') return false;
    if (c.isRunning() !== true) return false;
    return c.getNpcId() === npcId;
  } catch { return false; }
}

function rewrite(npcId: string): BubbleLine | null {
  const settings = getNpcDialogueSettings();
  if (!settings.enabled) return null;
  if (isCompanionNpc(npcId)) return null;
  const map = readSync('map');
  if (!hasNpcSpawn(map, npcId)) return null;
  const nowMs = Date.now();
  const qd = readSync('quinoaData') as unknown;
  const npcTiles = isRecord(qd) ? qd.npcs : null;
  const companionRunning = isCompanionRunning();
  const aries = companionRunning || isAriesInstalled();
  const speaker = resolveSpeaker(npcId, map, npcTiles, aries);
  companionSeen = companionRunning || isCompanionActive(map, npcTiles, aries);

  const candidates = collectCandidates(nowMs);
  const enabled = new Set(PROVIDERS.map((p) => p.id).filter((id) => settings.lines[id]));
  const picked = selectLine({ speaker, companionActive: companionSeen, candidates, enabled, state: selectorState, nowMs });
  selectorState = picked.state;
  const served = renderFirst(picked.ranked, speaker.voice, nowMs);
  if (!served) return null;
  selectorState = markServed(selectorState, served.lineId, nowMs);
  lastLine = served.lineId;
  return served.line;
}

function tryInstall(): boolean {
  return installTalkInterceptor(atomObjectFor('npcChatBubbles'), rewrite);
}

function startInjector(): void {
  if (injectorStop !== null) return;
  if (!getNpcDialogueSettings().companionInject) return;
  // Log-once only when the user opted in — never during Aries-absent operation with the toggle off.
  const c = getCompanion();
  if ((!c || typeof c.say !== 'function') && !injectSurfaceWarned) {
    injectSurfaceWarned = true;
    log.info('QPM-NPC-002', { hasCompanion: c !== null, hasSay: !!(c && typeof c.say === 'function') });
  }
  injectorStop = startCompanionInjector({
    getSelectorState: () => selectorState,
    setSelectorState: (n) => { selectorState = n; },
    markLastLine: (id) => { lastLine = id; lastInjectedLine = id; },
  });
}

function stopInjector(): void {
  if (injectorStop === null) return;
  try { injectorStop(); } catch { /* ignore */ }
  injectorStop = null;
}

export function restartCompanionInjector(): void {
  stopInjector();
  if (started) startInjector();
}

export function startNpcDialogue(): void {
  if (started) return;
  started = true;
  installWarned = false;
  injectSurfaceWarned = false;
  const firstInstalled = tryInstall();
  setNpcDialoguePayloadSource(() => {
    const settings = getNpcDialogueSettings();
    const injDiag = getCompanionInjectorDiagnostics();
    return {
      state: getInterceptorState(),
      companion: companionSeen,
      lastLine,
      inject: {
        enabled: settings.companionInject,
        lastLine: lastInjectedLine,
        lastInjectAt: injDiag.lastInjectAt,
        lastSkipReason: injDiag.lastSkipReason,
      },
    };
  });
  startInjector();
  // Walking up to an NPC is the moment before a Talk: install if the atom resolved late, re-wrap if another mod displaced us.
  cleanups.push(
    subscribe('adjacentNpcId', (id) => {
      if (id === null) return;
      const state = getInterceptorState();
      if (state === 'absent') {
        const ok = tryInstall();
        if (!ok && !firstInstalled && !installWarned) {
          installWarned = true;
          log.warn('QPM-NPC-001', { state: getInterceptorState() });
        }
      } else {
        ensureTalkInterceptor();
      }
    }),
  );
}

export function stopNpcDialogue(): void {
  if (!started) return;
  started = false;
  stopInjector();
  for (const off of cleanups.splice(0)) {
    try { off(); } catch { /* ignore */ }
  }
  uninstallTalkInterceptor();
  setNpcDialoguePayloadSource(null);
  selectorState = initialSelectorState();
  lastLine = null;
  lastInjectedLine = null;
  installWarned = false;
  injectSurfaceWarned = false;
}

export function getNpcDialogueDiagnostics(): {
  state: string;
  companion: boolean;
  lastLine: LineId | null;
  inject: ReturnType<typeof getCompanionInjectorDiagnostics> & { enabled: boolean; lastLine: LineId | null };
} {
  const settings = getNpcDialogueSettings();
  return {
    state: getInterceptorState(),
    companion: companionSeen,
    lastLine,
    inject: { ...getCompanionInjectorDiagnostics(), enabled: settings.companionInject, lastLine: lastInjectedLine },
  };
}
