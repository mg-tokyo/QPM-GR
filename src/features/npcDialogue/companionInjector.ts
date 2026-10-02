import { readSync, subscribe } from '../../core/gameState';
import { pageWindow } from '../../core/pageContext';
import { isRecord } from '../../utils/typeGuards';
import { collectCandidates, renderFirst } from './lineRender';
import { PROVIDERS } from './providers';
import {
  markServed,
  selectLine,
  type SelectorState,
} from './selector';
import { getNpcDialogueSettings } from './settings';
import type { LineId, Speaker } from './types';

const DEBOUNCE_MS = 45_000;

interface CompanionSurface {
  isRunning?: () => unknown;
  getNpcId?: () => unknown;
  // Aries's own type reports say.length === 1; the runtime accepts an options object as arg 2. Type it wide.
  say?: (message: string, options?: { tags?: Record<number, unknown> }) => unknown;
}

type SkipReason = 'not-running' | 'aries-recent' | 'modal-open' | 'no-line' | 'say-threw' | null;

export interface CompanionInjectorDeps {
  getSelectorState(): SelectorState;
  setSelectorState(next: SelectorState): void;
  markLastLine(id: LineId): void;
}

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let subUnsub: (() => void) | null = null;
let lastInjectAt: number | null = null;
let injectCount = 0;
let lastSkipReason: SkipReason = null;

function getCompanion(): CompanionSurface | null {
  try {
    const comp = (pageWindow as unknown as { Companion?: unknown }).Companion;
    return isRecord(comp) ? (comp as CompanionSurface) : null;
  } catch {
    return null;
  }
}

function getCompanionNpcId(c: CompanionSurface): string | null {
  try {
    if (typeof c.getNpcId !== 'function') return null;
    const id = c.getNpcId();
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

function isCompanionRunning(c: CompanionSurface): boolean {
  try {
    return typeof c.isRunning === 'function' && c.isRunning() === true;
  } catch {
    return false;
  }
}

function armDebounce(deps: CompanionInjectorDeps, delayMs: number = DEBOUNCE_MS): void {
  if (!started) return;
  if (timer !== null) clearTimeout(timer);
  // polling-justified: one-shot debounce trailing an npcChatBubbles subscription — not a repeat timer.
  timer = setTimeout(() => { void tryInject(deps); }, delayMs);
}

// Client-tier subscriptions wake on user input only, so an Aries write with no input never re-arms
// the debounce; the bubble's own timestamp is the reliable "last spoke" signal.
function msUntilSilent(entry: unknown, nowMs: number): number {
  if (!isRecord(entry) || typeof entry.timestamp !== 'number') return 0;
  const age = nowMs - entry.timestamp;
  if (age >= DEBOUNCE_MS) return 0;
  return age < 0 ? DEBOUNCE_MS : DEBOUNCE_MS - age;
}

async function tryInject(deps: CompanionInjectorDeps): Promise<void> {
  timer = null;
  if (!started) return;
  const settings = getNpcDialogueSettings();
  if (!settings.enabled || !settings.companionInject) { lastSkipReason = null; return; }
  const c = getCompanion();
  if (!c || !isCompanionRunning(c) || typeof c.say !== 'function' || typeof c.getNpcId !== 'function') {
    lastSkipReason = 'not-running';
    return;
  }
  const npcId = getCompanionNpcId(c);
  if (npcId === null) { lastSkipReason = 'not-running'; return; }
  if (readSync('activeModal') !== null) { lastSkipReason = 'modal-open'; armDebounce(deps); return; }
  const bubbles = readSync('npcChatBubbles');
  const entry = isRecord(bubbles) ? bubbles[npcId] : null;
  const nowMs = Date.now();
  const waitMs = msUntilSilent(entry, nowMs);
  if (waitMs > 0) {
    lastSkipReason = 'aries-recent';
    armDebounce(deps, waitMs);
    return;
  }

  const speaker: Speaker = { npcId, role: 'companion', locationKey: null, voice: 'neutral' };
  const currentState = deps.getSelectorState();
  // Seed talks so the first-Talk guard does not swallow the very first inject on this borrowed NPC.
  const seeded: SelectorState = currentState.talks[npcId]
    ? currentState
    : { ...currentState, talks: { ...currentState.talks, [npcId]: 1 } };

  const candidates = collectCandidates(nowMs);
  const enabledSet = new Set<LineId>(PROVIDERS.map((p) => p.id).filter((id) => settings.lines[id]));
  const picked = selectLine({ speaker, companionActive: true, candidates, enabled: enabledSet, state: seeded, nowMs });
  const served = renderFirst(picked.ranked, 'neutral', nowMs);
  if (!served) {
    deps.setSelectorState(picked.state);
    lastSkipReason = 'no-line';
    armDebounce(deps);
    return;
  }
  const { line } = served;
  try {
    await c.say(line.message, line.tags ? { tags: line.tags } : {});
  } catch {
    lastSkipReason = 'say-threw';
    armDebounce(deps);
    return;
  }
  deps.setSelectorState(markServed(picked.state, served.lineId, nowMs));
  deps.markLastLine(served.lineId);
  lastInjectAt = nowMs;
  injectCount++;
  lastSkipReason = null;
  armDebounce(deps);
}

export function startCompanionInjector(deps: CompanionInjectorDeps): () => void {
  if (started) return stopInjector;
  started = true;
  lastInjectAt = null;
  injectCount = 0;
  lastSkipReason = null;
  armDebounce(deps);
  subUnsub = subscribe('npcChatBubbles', () => armDebounce(deps));
  return stopInjector;
}

function stopInjector(): void {
  if (!started) return;
  started = false;
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (subUnsub) {
    try { subUnsub(); } catch { /* ignore */ }
    subUnsub = null;
  }
}

export function getCompanionInjectorDiagnostics(): {
  running: boolean;
  npcId: string | null;
  lastInjectAt: number | null;
  injectCount: number;
  lastSkipReason: SkipReason;
} {
  const c = getCompanion();
  const npcId = c ? getCompanionNpcId(c) : null;
  return { running: started, npcId, lastInjectAt, injectCount, lastSkipReason };
}

export function _resetForTests(): void {
  stopInjector();
  lastInjectAt = null;
  injectCount = 0;
  lastSkipReason = null;
}
