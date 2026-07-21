// Shared factory for feature:* bus wiring — replaces the hand-copied per-feature blocks
// that drifted (playbook §11.2: missing ensureBusRegistered guards). All three emitters
// guard so the bus row appears on first coded emission even for lifecycle-less features.
// FEATURE-* codes carry placeholder subsystem 'feature'; the override here is what
// attributes the bus degrade to the caller's row.

import { healthBus } from './healthBus';
import { createNamedLogger, type NamedLogger } from './logger';
import { buildError } from './result';
import type { ErrorCode, QpmError, Severity, Subsystem } from './types';

export type FeatureMetrics = Readonly<Record<string, number | string>>;

export interface FeatureDiagnostics {
  /** Bus subsystem id (e.g. 'feature:mutationReminder'). */
  readonly subsystem: Subsystem;
  /** Underlying named logger for non-coded debug/info chatter. */
  readonly diag: NamedLogger;
  /** Idempotent — registers the feature with the bus as 'starting'. */
  ensureBusRegistered(): void;
  /** Publish a healthy state (status 'ok'). Bus coerces to 'recovering' if previously degraded. */
  publishOk(message?: string, metrics?: FeatureMetrics): void;
  /** Emit a coded warn (bus → degraded). Merges { feature } into context. */
  warnFeature(code: ErrorCode, ctx?: Record<string, unknown>, cause?: unknown): void;
  /** Emit a coded error (bus → failed). Merges { feature } into context. */
  errorFeature(code: ErrorCode, ctx?: Record<string, unknown>, cause?: unknown): void;
}

/**
 * @param subsystem Bus subsystem id, e.g. 'feature:myFeature'.
 * @param featureName Short id attached as `context.feature` on every code, e.g. 'myFeature'.
 */
export function createFeatureDiagnostics(
  subsystem: Subsystem,
  featureName: string,
): FeatureDiagnostics {
  const diag = createNamedLogger(subsystem);
  let busRegistered = false;

  function ensureBusRegistered(): void {
    if (busRegistered) return;
    busRegistered = true;
    healthBus.register(subsystem, { category: 'feature', status: 'starting' });
  }

  function buildFeatureError(
    code: ErrorCode,
    severity: Severity,
    ctx?: Record<string, unknown>,
    cause?: unknown,
  ): QpmError {
    const built = buildError(code, { feature: featureName, ...(ctx ?? {}) }, cause);
    return { ...built, subsystem, severity };
  }

  return {
    subsystem,
    diag,
    ensureBusRegistered,
    publishOk(message, metrics): void {
      ensureBusRegistered();
      healthBus.publish({
        subsystem,
        category: 'feature',
        status: 'ok',
        ...(message === undefined ? {} : { message }),
        ...(metrics === undefined ? {} : { metrics }),
      });
    },
    warnFeature(code, ctx, cause): void {
      ensureBusRegistered();
      diag.warn(buildFeatureError(code, 'warn', ctx, cause));
    },
    errorFeature(code, ctx, cause): void {
      ensureBusRegistered();
      diag.error(buildFeatureError(code, 'error', ctx, cause));
    },
  };
}
