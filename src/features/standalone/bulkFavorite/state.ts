import { storage } from '../../../utils/storage';
import { createNamedLogger } from '../../../diagnostics/logger';
import { buildError } from '../../../diagnostics/result';
import type { Subsystem } from '../../../diagnostics/types';
import { CONFIG_KEY, DEFAULT_CONFIG } from './constants';
import type { BulkFavoriteConfig } from './types';

export const FEATURE_SUBSYSTEM: Subsystem = 'feature:bulkFavorite';
export const FEATURE_NAME = 'bulkFavorite';
export const log = createNamedLogger(FEATURE_SUBSYSTEM);

/**
 * Re-attribute a FEATURE-* code emission to this feature's bus row. The
 * registered placeholder subsystem on FEATURE-* is `'feature'`; without this
 * override the bus would degrade a generic `feature` entry instead of
 * `feature:bulkFavorite`.
 */
export function warnFeature(code: Parameters<typeof buildError>[0], ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  log.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

/** Sidebar mutables shared across sidebar/actions/controller modules (live holder). */
export const ui = {
  sidebar: null as HTMLElement | null,
  closeProbeTimer: null as ReturnType<typeof setTimeout> | null,
  immediateSyncTimer: null as ReturnType<typeof setTimeout> | null,
  lastRenderSignature: '',
  lastLayoutSignature: '',
  anchorMissCount: 0,
  lockUiSpriteCache: null as { locked: string; unlocked: string } | null,
};

function loadConfig(): BulkFavoriteConfig {
  const saved = storage.get<Partial<BulkFavoriteConfig> | null>(CONFIG_KEY, null);
  return {
    ...DEFAULT_CONFIG,
    ...(saved ?? {}),
  };
}

export function saveConfig(): void {
  storage.set(CONFIG_KEY, configRef.current);
}

export const configRef = { current: loadConfig() };
