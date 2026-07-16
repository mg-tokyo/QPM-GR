import { readSharedGlobal, shareGlobal } from '../core/pageContext';
import { isVerboseLogsEnabled, writeShimConsole } from '../diagnostics/logger';

type SpriteLogLevel = 'debug' | 'info' | 'warn' | 'error';

type SpriteLogEntry = {
  at: number;
  level: SpriteLogLevel;
  code: string;
  message: string;
  data?: unknown;
};

const SPRITE_LOGS_FLAG = '__QPM_SPRITE_LOGS';
const MAX_SPRITE_LOG_ENTRIES = 300;

const spriteLogEntries: SpriteLogEntry[] = [];
const warnedOnce = new Set<string>();

function clampDumpLimit(limit: number | undefined): number {
  const value = Number(limit ?? 100);
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(1000, Math.floor(value)));
}

function pushEntry(entry: SpriteLogEntry): void {
  spriteLogEntries.push(entry);
  if (spriteLogEntries.length > MAX_SPRITE_LOG_ENTRIES) {
    spriteLogEntries.splice(0, spriteLogEntries.length - MAX_SPRITE_LOG_ENTRIES);
  }
}

export function isSpriteLogsEnabled(): boolean {
  return readSharedGlobal<boolean>(SPRITE_LOGS_FLAG) === true || isVerboseLogsEnabled();
}

export function setSpriteLogsEnabled(enabled: boolean): boolean {
  shareGlobal(SPRITE_LOGS_FLAG, Boolean(enabled));
  return isSpriteLogsEnabled();
}

function print(level: SpriteLogLevel, prefix: string, message: string, data?: unknown): void {
  // writeShimConsole normalises to console.log (severity is carried by the
  // ring-buffer entry level, not the console output). prefix is passed
  // without brackets so writeShimConsole can wrap it consistently.
  const bare = prefix.replace(/^\[|\]$/g, '');
  const payload = data === undefined ? [`${level.toUpperCase()}:`, message] : [`${level.toUpperCase()}:`, message, data];
  writeShimConsole(bare, payload);
}

export function spriteLog(
  level: SpriteLogLevel,
  code: string,
  message: string,
  data?: unknown,
  opts: { alwaysConsole?: boolean; onceKey?: string } = {}
): void {
  if (opts.onceKey) {
    if (warnedOnce.has(opts.onceKey)) return;
    warnedOnce.add(opts.onceKey);
  }

  const entry: SpriteLogEntry = {
    at: Date.now(),
    level,
    code,
    message,
    data,
  };
  pushEntry(entry);

  if (opts.alwaysConsole || isSpriteLogsEnabled()) {
    print(level, '[QPM Sprite-v2]', `${code}: ${message}`, data);
  }
}

export function spriteLogDump(limit?: number): SpriteLogEntry[] {
  const count = clampDumpLimit(limit);
  return spriteLogEntries.slice(-count).map((entry) => ({ ...entry }));
}

export function printSpriteLogDump(limit?: number): SpriteLogEntry[] {
  const rows = spriteLogDump(limit);
  const safeStringify = (value: unknown): string => {
    if (value == null) return '';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  console.table(
    rows.map((entry) => ({
      at: new Date(entry.at).toISOString(),
      level: entry.level,
      code: entry.code,
      message: entry.message,
      data: safeStringify(entry.data),
    }))
  );
  return rows;
}
