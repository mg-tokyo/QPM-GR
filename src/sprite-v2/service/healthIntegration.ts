import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import type { Subsystem, SubsystemHealth } from '../../diagnostics/types';
import { spriteLog } from '../diagnostics';
import { HYDRATION_EVENT } from './constants';
import { bootReportRef } from './bootReport';
import { ctxRef } from './state';

// Diagnostics bus wiring (Phase 2 item 2.5)
// §4.4 ruling: single 'spriteV2' bus entry; sub-state lives in `metrics`, not split into multiple subsystems.
const SPRITE_SUBSYSTEM: Subsystem = 'spriteV2';
export const diagLog = createNamedLogger('spriteV2');

let spriteDiagnosticsStarted = false;
let hydrationEventHandler: ((event: Event) => void) | null = null;
let lastPublishedSig = '';
const spriteRenderFailureSignatures = new Set<string>();

export function rememberRenderFailure(sig: string, detail: Record<string, unknown>): void {
  if (spriteRenderFailureSignatures.has(sig)) return;
  spriteRenderFailureSignatures.add(sig);
  if (spriteRenderFailureSignatures.size > 512) {
    spriteRenderFailureSignatures.clear();
  }
  spriteLog('warn', 'render-to-canvas-failed', 'Sprite render to canvas failed', detail);
  if (spriteDiagnosticsStarted) {
    diagLog.warn('QPM-SPRITE-004', detail);
  }
}

function buildSpriteMetrics(detail?: Record<string, unknown>): Readonly<Record<string, number | string>> {
  const report = bootReportRef.current;
  const coverage = Number(
    (detail?.['coverage'] as number | undefined) ?? report?.coverage ?? 0,
  );
  const expected = Number(
    (detail?.['expectedFrames'] as number | undefined) ?? report?.expectedFrames ?? 0,
  );
  const hydrated = Number(
    (detail?.['hydratedFrames'] as number | undefined) ?? report?.hydratedFrames ?? 0,
  );
  const finalMode = String(
    (detail?.['mode'] as string | undefined) ?? report?.finalMode ?? 'unknown',
  );
  const loadMode = String(
    (detail?.['loadMode'] as string | undefined) ?? report?.loadMode ?? ctxRef.current?.state.loadMode ?? 'unknown',
  );
  const decoder = ctxRef.current?.state.decoder;
  const decoderSuccesses = decoder?.decodeSuccesses ?? 0;
  const decoderAvgMs = decoderSuccesses > 0
    ? Number(((decoder?.totalDecodeMs ?? 0) / decoderSuccesses).toFixed(1))
    : 0;
  return {
    coverage: Number.isFinite(coverage) ? Number(coverage.toFixed(3)) : 0,
    expectedFrames: Number.isFinite(expected) ? expected : 0,
    hydratedFrames: Number.isFinite(hydrated) ? hydrated : 0,
    finalMode,
    loadMode,
    textures: ctxRef.current?.state.tex.size ?? 0,
    items: ctxRef.current?.state.items.length ?? 0,
    decoderAttempts: decoder?.decodeAttempts ?? 0,
    decoderSuccesses,
    decoderFailures: decoder?.decodeFailures ?? 0,
    decoderAvgMs,
    decoderDiscovery: decoder?.discoveryStrategy ?? 'pending',
  };
}

function publishSpriteHealth(
  status: SubsystemHealth['status'] | undefined,
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (!spriteDiagnosticsStarted) return;
  const metrics = buildSpriteMetrics(detail);
  const sig = `${status ?? ''}|${message}|${metrics.coverage}|${metrics.hydratedFrames}|${metrics.expectedFrames}`;
  if (sig === lastPublishedSig) return;
  lastPublishedSig = sig;
  healthBus.publish({
    subsystem: SPRITE_SUBSYSTEM,
    category: 'core',
    ...(status === undefined ? {} : { status }),
    message,
    metrics,
  });
}

function describeHydration(detail: Record<string, unknown>): string {
  const hydrated = Number(detail['hydratedFrames'] ?? 0);
  const expected = Number(detail['expectedFrames'] ?? 0);
  const coverage = Number(detail['coverage'] ?? 0);
  return `Hydration ${(coverage * 100).toFixed(0)}% (${hydrated}/${expected})`;
}

function handleHydrationStateChange(detail: Record<string, unknown>): void {
  const reason = String(detail['reason'] ?? '');
  const status = String(detail['status'] ?? '');
  const degraded = Boolean(detail['degraded']);

  // 'boot' fires when start() begins — we already registered as 'starting'.
  if (reason === 'boot') return;

  if (status === 'failed') {
    diagLog.error('QPM-SPRITE-001', {
      reason,
      coverage: detail['coverage'] ?? 0,
      expectedFrames: detail['expectedFrames'] ?? 0,
      hydratedFrames: detail['hydratedFrames'] ?? 0,
      finalMode: detail['mode'],
      loadMode: detail['loadMode'],
    });
    return;
  }

  if (status === 'degraded' || degraded) {
    diagLog.warn('QPM-SPRITE-002', {
      reason,
      coverage: detail['coverage'] ?? 0,
      expectedFrames: detail['expectedFrames'] ?? 0,
      hydratedFrames: detail['hydratedFrames'] ?? 0,
      finalMode: detail['mode'],
      loadMode: detail['loadMode'],
    });
    return;
  }

  // status === 'ok' or no explicit degradation — publish healthy state.
  publishSpriteHealth('ok', describeHydration(detail), detail);
}

/** Wire sprite-v2 into the health bus. Idempotent; must run after initDiagnostics(). Safe to call before initSpriteSystem(). */
export function startSpriteV2Diagnostics(): void {
  if (spriteDiagnosticsStarted) return;
  spriteDiagnosticsStarted = true;

  healthBus.register(SPRITE_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Waiting for PIXI + atlas hydration',
  });

  // If sprite boot already completed before diagnostics started, replay state.
  const bootReport = bootReportRef.current;
  if (bootReport) {
    const reason = bootReport.status === 'ok' ? 'hydrated' : 'degraded/final';
    handleHydrationStateChange({
      reason,
      status: bootReport.status,
      degraded: bootReport.status !== 'ok',
      mode: bootReport.finalMode,
      loadMode: bootReport.loadMode,
      expectedFrames: bootReport.expectedFrames,
      hydratedFrames: bootReport.hydratedFrames,
      coverage: bootReport.coverage,
    });
  }

  hydrationEventHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail as Record<string, unknown> | null | undefined;
    if (!detail) return;
    handleHydrationStateChange(detail);
  };
  try {
    window.addEventListener(HYDRATION_EVENT, hydrationEventHandler);
  } catch {
    // window unavailable — bus stays in 'starting' until publish via report path.
  }
}

export function stopSpriteV2Diagnostics(): void {
  if (!spriteDiagnosticsStarted) return;
  if (hydrationEventHandler) {
    try { window.removeEventListener(HYDRATION_EVENT, hydrationEventHandler); } catch { /* ignore */ }
    hydrationEventHandler = null;
  }
  spriteDiagnosticsStarted = false;
  lastPublishedSig = '';
}

/**
 * Surface a sprite init failure on the health bus. Called from main.ts when
 * the initSpriteSystem() promise rejects — otherwise the bus would sit in
 * 'starting' forever.
 *
 * Publishes an explicit message BEFORE the log call so the bus row shows the
 * real error text; without this the previous 'starting' message ("Waiting for
 * PIXI + atlas hydration") leaks through because fanOut only sets status +
 * lastError, and healthBus.publish preserves any prior message field.
 */
export function reportSpriteV2InitFailed(error: unknown): void {
  const raw = error instanceof Error ? error.message : String(error);
  publishSpriteHealth('failed', `initSpriteSystem rejected: ${raw}`);
  diagLog.error('QPM-SPRITE-001', { phase: 'initSpriteSystem' }, error);
}

/**
 * Publish a recovery message + status when a late-boot retry succeeds. The bus
 * hysteresis machine coerces 'ok' from a failed state into 'recovering' and
 * drives the transition to 'ok' after the hysteresis window.
 */
export function reportSpriteV2InitRecovered(): void {
  publishSpriteHealth('ok', 'Recovered after late PIXI arrival');
}
