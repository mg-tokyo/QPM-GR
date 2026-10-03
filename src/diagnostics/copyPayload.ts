// Discord-friendly Copy renderer (§8.3): gathers live diagnostics state and
// hands a snapshot to the pure renderer in copyRender.ts.

import type { KeyExplain } from '../core/gameState/types';
import { getCurrentVersion } from '../utils/versionChecker';
import { lookupCode } from './codes';
import { DEFAULT_COPY_OPTIONS, renderReport } from './copyRender';
import type { CopyPayloadOptions } from './copyRender';
import { formatEnvironmentLine, formatFlagsLine, readEnvironmentInfo, readNonDefaultFlags } from './environmentInfo';
import { errorBuffer } from './errorBuffer';
import { getCapturedGameVersion } from './gameVersionCapture';
import { healthBus } from './healthBus';
import { detectOtherMods, formatModsLine, readSendChainLine } from './modDetection';
import { formatPerfLine } from './perfMonitor';
import type { ErrorCode } from './types';

export { DEFAULT_COPY_OPTIONS } from './copyRender';
export type { CopyPayloadOptions } from './copyRender';

// Populated by initGameState() with `() => reg.explainAll()`; C2's payload/window
// helpers read through this so diagnostics stays a leaf module.
let gameStatePayloadSource: (() => readonly KeyExplain[]) | null = null;
export function setGameStatePayloadSource(source: (() => readonly KeyExplain[]) | null): void {
  gameStatePayloadSource = source;
}
export function getGameStateSnapshotForPayload(): readonly KeyExplain[] | null {
  if (!gameStatePayloadSource) return null;
  try { return gameStatePayloadSource(); }
  catch { return null; }
}

export interface IdentityPayload {
  readonly playerId: string | null;
  readonly myIdx: number | null;
  readonly rung: string | null;
  readonly isSpectating: boolean;
}

let gameStateIdentitySource: (() => IdentityPayload | null) | null = null;
export function setGameStateIdentitySource(source: (() => IdentityPayload | null) | null): void {
  gameStateIdentitySource = source;
}

// Confirmation channels the restock feature can still hear from. 'A' shopPurchases
// counter, 'B' shop cycle rollover (always in list — weather events end reliably),
// 'C' envelope-transport reject fast-path (per-purchase transient; not tracked here),
// 'D' inventory / storage baseline delta.
export interface RestockPayload {
  readonly pendings: number;
  readonly active: number;
  readonly sources: readonly ('A' | 'B' | 'C' | 'D')[];
  readonly purchasesField: string | null;
}

let restockPayloadSource: (() => RestockPayload | null) | null = null;
export function setRestockPayloadSource(source: (() => RestockPayload | null) | null): void {
  restockPayloadSource = source;
}

function renderRestockLine(): string | null {
  const row = healthBus.readAll().find((s) => s.subsystem === 'feature:shopRestockAlerts');
  if (!row || row.status === 'ok' || row.status === 'starting') return null;
  if (!restockPayloadSource) return null;
  try {
    const p = restockPayloadSource();
    if (!p) return null;
    const sources = p.sources.length === 0 ? '[]' : `[${p.sources.join(',')}]`;
    const field = p.purchasesField ?? 'absent';
    return `Restock: pendings=${p.pendings}, active=${p.active}, sources=${sources}, purchasesField=${field}`;
  } catch { return null; }
}

export interface NpcDialoguePayload {
  readonly state: 'absent' | 'installed' | 'displaced' | 'passthrough';
  readonly companion: boolean;
  readonly lastLine: string | null;
  readonly inject: {
    readonly enabled: boolean;
    readonly lastLine: string | null;
    readonly lastInjectAt: number | null;
    readonly lastSkipReason: 'not-running' | 'aries-recent' | 'modal-open' | 'no-line' | 'say-threw' | null;
  };
}

let npcDialoguePayloadSource: (() => NpcDialoguePayload | null) | null = null;
export function setNpcDialoguePayloadSource(source: (() => NpcDialoguePayload | null) | null): void {
  npcDialoguePayloadSource = source;
}

let camera3dLineSource: (() => string | null) | null = null;
export function setCamera3dLineSource(source: (() => string | null) | null): void {
  camera3dLineSource = source;
}

// Silent when the interceptor is installed AND the Companion opt-in is off — otherwise surface state and inject stats.
function renderNpcDialogueLine(): string | null {
  if (!npcDialoguePayloadSource) return null;
  try {
    const p = npcDialoguePayloadSource();
    if (!p) return null;
    const injectOn = p.inject.enabled === true;
    if (p.state === 'installed' && !injectOn) return null;
    const base = `NpcDialogue: state=${p.state} companion=${p.companion ? 't' : 'f'} last=${p.lastLine ?? 'none'}`;
    if (!injectOn) return base;
    let suffix = ' inject=on';
    if (p.inject.lastLine !== null && p.inject.lastInjectAt !== null) {
      suffix += ` last=${p.inject.lastLine} ago=${Math.max(0, Date.now() - p.inject.lastInjectAt)}ms`;
    }
    if (p.inject.lastSkipReason !== null) suffix += ` skipped=${p.inject.lastSkipReason}`;
    return base + suffix;
  } catch { return null; }
}

function renderIdentityLine(): string | null {
  if (!gameStateIdentitySource) return null;
  try {
    const p = gameStateIdentitySource();
    if (!p) return null;
    const pid = p.playerId ?? 'null';
    const myIdx = p.myIdx === null ? 'null' : String(p.myIdx);
    const rung = p.rung ?? 'null';
    return `Identity: pid=${pid} myIdx=${myIdx} rung=${rung} spectating=${p.isSpectating ? 't' : 'f'}`;
  } catch { return null; }
}

function renderGameStateProblemLines(): string[] {
  const gs = getGameStateSnapshotForPayload();
  if (!gs) return [];
  const problems = gs.filter((e) => e.boundVia === null || !e.preferred).slice(0, 12)
    .map((e) => `${e.key}: ${e.boundDescription ?? 'unbound'}${e.preferred ? '' : ' (fallback)'}`);
  const idLine = renderIdentityLine();
  return idLine ? [idLine, ...problems] : problems;
}

interface UAInfo { browser: string; os: string }

function detectBrowserAndOs(): UAInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let browser = 'Unknown';
  let os = 'Unknown';

  if (/Edg\/(\d+)/.test(ua)) browser = `Edge ${RegExp.$1}`;
  else if (/OPR\/(\d+)/.test(ua) || /Opera\/(\d+)/.test(ua)) browser = `Opera ${RegExp.$1}`;
  else if (/Firefox\/(\d+)/.test(ua)) browser = `Firefox ${RegExp.$1}`;
  else if (/Chrome\/(\d+)/.test(ua)) browser = `Chrome ${RegExp.$1}`;
  else if (/Version\/(\d+).*Safari/.test(ua)) browser = `Safari ${RegExp.$1}`;

  if (/Windows NT 11/.test(ua)) os = 'Windows 11';
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10';
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6\.2/.test(ua)) os = 'Windows 8';
  else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
  else if (/Mac OS X (\d+)[._](\d+)/.test(ua)) os = `macOS ${RegExp.$1}.${RegExp.$2}`;
  else if (/Android (\d+)/.test(ua)) os = `Android ${RegExp.$1}`;
  else if (/iPad|iPhone/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { browser, os };
}

function safe<T>(read: () => T, fallback: T): T {
  try { return read(); } catch { return fallback; }
}

export function renderCopyPayload(opts: CopyPayloadOptions = DEFAULT_COPY_OPTIONS): string {
  const now = Date.now();
  const ua = detectBrowserAndOs();
  return renderReport({
    now,
    qpmVersion: getCurrentVersion(),
    gameVersion: getCapturedGameVersion(),
    browser: ua.browser,
    os: ua.os,
    environmentLine: safe(() => formatEnvironmentLine(readEnvironmentInfo(now)), 'Env: ?'),
    modsLine: safe(() => formatModsLine(detectOtherMods()), null),
    chainLine: safe(() => readSendChainLine(), null),
    flagsLine: safe(() => formatFlagsLine(readNonDefaultFlags()), null),
    perfLine: safe(() => formatPerfLine(), null),
    restockLine: safe(() => renderRestockLine(), null),
    npcDialogueLine: safe(() => renderNpcDialogueLine(), null),
    camera3dLine: safe(() => (camera3dLineSource ? camera3dLineSource() : null), null),
    subsystems: healthBus.readAll(),
    aggregate: healthBus.aggregate(),
    gameStateProblemLines: renderGameStateProblemLines(),
    errors: errorBuffer.readAll(),
    sessionStartedAt: errorBuffer.getSessionStartedAt(),
    lookupCode: (code) => lookupCode(code as ErrorCode),
  }, opts);
}

export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to manual fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function copyPayloadToClipboard(opts: CopyPayloadOptions = DEFAULT_COPY_OPTIONS): Promise<boolean> {
  return writeToClipboard(renderCopyPayload(opts));
}
