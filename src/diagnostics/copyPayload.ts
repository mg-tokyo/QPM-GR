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
import { detectOtherMods, formatModsLine } from './modDetection';
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

function renderGameStateProblemLines(): string[] {
  const gs = getGameStateSnapshotForPayload();
  if (!gs) return [];
  return gs.filter((e) => e.boundVia === null || !e.preferred).slice(0, 12)
    .map((e) => `${e.key}: ${e.boundDescription ?? 'unbound'}${e.preferred ? '' : ' (fallback)'}`);
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
    flagsLine: safe(() => formatFlagsLine(readNonDefaultFlags()), null),
    perfLine: safe(() => formatPerfLine(), null),
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
