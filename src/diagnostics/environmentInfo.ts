import { isIsolatedContext, readSharedGlobal } from '../core/pageContext';
import { hasGmApis, isDiscordSurface } from '../utils/environment';
import { getStorageRuntime, storage } from '../utils/storage';
import { errorBuffer } from './errorBuffer';
import { isVerboseLogsEnabled } from './logger';

declare const GM_info: unknown;
declare const GM: unknown;

function readGmInfo(): { scriptHandler?: unknown; version?: unknown } | null {
  if (typeof GM_info !== 'undefined' && GM_info) return GM_info as { scriptHandler?: unknown; version?: unknown };
  if (typeof GM !== 'undefined' && GM && typeof GM === 'object') {
    const info = (GM as { info?: unknown }).info;
    if (info && typeof info === 'object') return info as { scriptHandler?: unknown; version?: unknown };
  }
  return null;
}

export interface EnvironmentInfo {
  readonly scriptHandler: string | null;
  readonly isolatedWorld: boolean;
  readonly surface: 'web' | 'discord';
  readonly uptimeMs: number;
  readonly duplicateVersion: string | null;
}

// Written by an aborted second QPM instance (src/core/instanceGuard.ts, spec D10).
// Read at report-render time because the second copy may load AFTER initialize().
function readDuplicateVersion(): string | null {
  try {
    const dup = readSharedGlobal<{ version?: unknown }>('__QPM_DUPLICATE__');
    if (dup && typeof dup === 'object' && typeof dup.version === 'string') return dup.version;
  } catch { /* shared global unreadable */ }
  return null;
}

// Starweaver Mod Manager provides GM_* storage but no GM_info, so a missing
// handler name with GM APIs present is "unknown manager", not "no manager".
function readScriptHandler(): string | null {
  try {
    const gi = readGmInfo();
    const handler = gi && typeof gi.scriptHandler === 'string' ? gi.scriptHandler : null;
    if (!handler) return hasGmApis ? 'GM:unknown-handler' : null;
    const version = gi && typeof gi.version === 'string' ? gi.version : '';
    return version ? `${handler} ${version}` : handler;
  } catch {
    return null;
  }
}

export function readEnvironmentInfo(now = Date.now()): EnvironmentInfo {
  const started = errorBuffer.getSessionStartedAt();
  return {
    scriptHandler: readScriptHandler(),
    isolatedWorld: isIsolatedContext,
    surface: isDiscordSurface ? 'discord' : 'web',
    uptimeMs: started > 0 ? Math.max(0, now - started) : 0,
    duplicateVersion: readDuplicateVersion(),
  };
}

export function formatUptime(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (h < 24) return `${h}h${m.toString().padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

export function formatEnvironmentLine(info: EnvironmentInfo): string {
  const parts: string[] = [];
  parts.push(info.scriptHandler ?? 'no-GM');
  if (info.isolatedWorld) parts.push('isolated');
  parts.push(info.surface);
  parts.push(`up ${formatUptime(info.uptimeMs)}`);
  if (info.duplicateVersion) parts.push(`dup:${info.duplicateVersion}`);
  return `Env: ${parts.join('  ')}`;
}

// Keys read directly (not via their owning modules) to avoid importing
// websocket/reactive/devMode into diagnostics. Defaults mirror each owner.
const DEFAULT_ON_FLAGS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'qpm.ws.envelope.enabled', label: 'envelope' },
  { key: 'qpm.ws.sequencer.enabled', label: 'sequencer' },
  { key: 'qpm.perf.reactive.stateEnabled', label: 'reactive.state' },
  { key: 'qpm.perf.reactive.clientEnabled', label: 'reactive.client' },
  { key: 'qpm.perf.reactive.compositeEnabled', label: 'reactive.composite' },
  { key: 'qpm.perf.reactive.dynamicEnabled', label: 'reactive.dynamic' },
];

const DEFAULT_OFF_FLAGS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'qpm.dev.enabled', label: 'dev' },
  { key: 'qpm.debug.globals.v1', label: 'debug' },
  { key: 'qpm.ws.chainSafetyPoll.enabled', label: 'chainSafetyPoll' },
];

function readBool(key: string): boolean | null {
  try {
    const raw = storage.get<unknown>(key, undefined);
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

/** Only flags that differ from their defaults — empty on a stock install. */
export function readNonDefaultFlags(): string[] {
  const out: string[] = [];
  for (const { key, label } of DEFAULT_ON_FLAGS) {
    if (readBool(key) === false) out.push(`${label}=off`);
  }
  for (const { key, label } of DEFAULT_OFF_FLAGS) {
    if (readBool(key) === true) out.push(`${label}=on`);
  }
  try {
    if (isVerboseLogsEnabled()) out.push('verbose=on');
  } catch { /* shared global unreadable */ }
  try {
    const runtime = getStorageRuntime();
    if (runtime === 'local-storage') out.push('storage=local-storage');
  } catch { /* runtime unresolved */ }
  return out;
}

export function formatFlagsLine(flags: readonly string[]): string | null {
  return flags.length === 0 ? null : `Flags: ${flags.join('  ')}`;
}
