// src/store/weatherHub.ts
// Centralised weather polling hub that reuses the shared detection helpers.

import {
  DetailedWeather,
  classifyWeather,
  classifyWeatherFromLabel,
  detectDetailedWeather,
  findWeatherCanvas,
  getCanvasHash,
  getWeatherDefinitionFromLabel,
  isCanvasDrawn,
  normalizeWeatherLabel,
} from '../utils/game/weatherDetection';
import { log } from '../utils/logger';
import { readAtomValue as readRegistryAtomValue, subscribeAtomValue } from '../core/atomRegistry';
import { visibleInterval } from '../utils/scheduling/timerManager';
import type { WeatherAtomValue } from '../types/gameAtoms';

export type WeatherSnapshot = {
  kind: DetailedWeather;
  raw: 'weather' | 'noweather';
  hash: string | null;
  canvasPresent: boolean;
  timestamp: number;
  source: 'atom' | 'canvas' | 'unknown';
  label: string | null;
  startedAt: number | null;
  expectedEndAt: number | null;
};

const listeners = new Set<(snapshot: WeatherSnapshot) => void>();
let current: WeatherSnapshot = {
  kind: 'unknown',
  raw: 'noweather',
  hash: null,
  canvasPresent: false,
  timestamp: Date.now(),
  source: 'unknown',
  label: null,
  startedAt: null,
  expectedEndAt: null,
};

let pollTimerCleanup: (() => void) | null = null;
let override: { kind: DetailedWeather; expiresAt: number } | null = null;
const POLL_INTERVAL_MS = 2000;
const BRIDGE_RETRY_INTERVAL_MS = 30_000;
let atomUnsubscribe: (() => void) | null = null;
let atomBridgeReady = false;
let atomValueSeen = false;
let lastAtomValue: WeatherAtomValue = null;
let atomInitPromise: Promise<void> | null = null;
let lastBridgeAttemptAt = 0;
let lastAtomEventId: string | null = null;
let lastAtomEventStartedAt: number | null = null;
let lastAtomEventExpectedEndAt: number | null = null;
let lastCanvasStartedAt: number | null = null;
let lastCanvasStartedAtKey: string | null = null;

function emit(next: WeatherSnapshot): void {
  if (
    current.kind === next.kind &&
    current.raw === next.raw &&
    current.hash === next.hash &&
    current.canvasPresent === next.canvasPresent &&
    current.source === next.source &&
    current.label === next.label &&
    current.startedAt === next.startedAt &&
    current.expectedEndAt === next.expectedEndAt
  ) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    try {
      listener(current);
    } catch (error) {
      log('⚠️ Weather hub listener failed', error);
    }
  }
}

function computeSnapshotFromCanvas(canvas: HTMLCanvasElement | null): WeatherSnapshot {
  const timestamp = Date.now();
  if (!canvas) {
    return {
      kind: 'unknown',
      raw: 'noweather',
      hash: null,
      canvasPresent: false,
      timestamp,
      source: 'canvas',
      label: null,
      startedAt: null,
      expectedEndAt: null,
    };
  }

  if (!isCanvasDrawn(canvas)) {
    return {
      kind: 'unknown',
      raw: 'noweather',
      hash: null,
      canvasPresent: true,
      timestamp,
      source: 'canvas',
      label: null,
      startedAt: null,
      expectedEndAt: null,
    };
  }

  const raw = classifyWeather(canvas);
  const kind = detectDetailedWeather(canvas);
  const hash = getCanvasHash(canvas);

  const startedAtKey = `${kind}|${hash}`;
  let startedAt: number;
  if (lastCanvasStartedAt != null && lastCanvasStartedAtKey === startedAtKey) {
    startedAt = lastCanvasStartedAt;
  } else {
    startedAt = timestamp;
    lastCanvasStartedAt = timestamp;
    lastCanvasStartedAtKey = startedAtKey;
  }

  return {
    kind,
    raw,
    hash,
    canvasPresent: true,
    timestamp,
    source: 'canvas',
    label: kind === 'unknown' ? null : kind,
    startedAt,
    expectedEndAt: null,
  };
}

function pollWeather(forceEmit = false): void {
  if (atomBridgeReady && atomValueSeen) {
    if (forceEmit) {
      handleAtomWeatherValue(lastAtomValue);
    }
    return;
  }

  const nowForRetry = Date.now();
  if (!atomBridgeReady && !atomInitPromise && nowForRetry - lastBridgeAttemptAt >= BRIDGE_RETRY_INTERVAL_MS) {
    lastBridgeAttemptAt = nowForRetry;
    void ensureAtomBridge();
  }

  const now = Date.now();

  if (override && now < override.expiresAt) {
    const raw = override.kind === 'sunny' ? 'noweather' : 'weather';
    const snapshot: WeatherSnapshot = {
      kind: override.kind,
      raw,
      hash: 'override',
      canvasPresent: true,
      timestamp: now,
      source: 'unknown',
      label: override.kind,
      startedAt: now,
      expectedEndAt: override.expiresAt,
    };
    if (forceEmit || snapshot.hash !== current.hash || snapshot.kind !== current.kind) {
      emit(snapshot);
    }
    return;
  }

  if (override && now >= override.expiresAt) {
    override = null;
  }

  const canvas = findWeatherCanvas();
  const snapshot = computeSnapshotFromCanvas(canvas);
  if (forceEmit) {
    emit(snapshot);
  } else {
    emit(snapshot);
  }
}

function handleAtomWeatherValue(rawValue: WeatherAtomValue): void {
  atomValueSeen = true;
  const normalizedLabel = typeof rawValue === 'string' && rawValue.trim().length > 0 ? rawValue.trim() : null;
  const def = getWeatherDefinitionFromLabel(normalizedLabel);
  const kind = def?.kind ?? classifyWeatherFromLabel(normalizedLabel);
  const rawState = def?.rawState ?? (kind === 'sunny' || kind === 'unknown' ? 'noweather' : 'weather');
  const signature = `atom:${normalizeWeatherLabel(normalizedLabel ?? def?.label ?? 'sunny') || 'sunny'}`;
  const now = Date.now();

  const defId = def?.id ?? 'Weather:Sunny';
  if (lastAtomEventId !== defId) {
    lastAtomEventId = defId;
    lastAtomEventStartedAt = now;
    lastAtomEventExpectedEndAt = def?.durationMs ? now + def.durationMs : null;
  }

  const snapshot: WeatherSnapshot = {
    kind,
    raw: rawState,
    hash: signature,
    canvasPresent: true,
    timestamp: now,
    source: 'atom',
    label: normalizedLabel ?? def?.label ?? null,
    startedAt: lastAtomEventStartedAt,
    expectedEndAt: lastAtomEventExpectedEndAt,
  };
  emit(snapshot);
}

async function ensureAtomBridge(): Promise<void> {
  if (atomUnsubscribe || atomInitPromise) return;
  atomInitPromise = (async () => {
    try {
      const unsubscribe = await subscribeAtomValue('weather', (value) => {
        atomBridgeReady = true;
        lastAtomValue = typeof value === 'string' ? value : null;
        handleAtomWeatherValue(lastAtomValue);
      });
      if (!unsubscribe) {
        atomBridgeReady = false;
        return;
      }
      atomUnsubscribe = unsubscribe;
      const initial = await readRegistryAtomValue('weather').catch(() => lastAtomValue);
      if (typeof initial === 'string' || initial == null) {
        lastAtomValue = initial;
      }
      atomBridgeReady = true;
      handleAtomWeatherValue(lastAtomValue);
    } catch (error) {
      atomBridgeReady = false;
      atomValueSeen = false;
      log('⚠️ Weather hub atom bridge error', error);
      atomUnsubscribe = null;
    } finally {
      atomInitPromise = null;
    }
  })();
  try {
    await atomInitPromise;
  } catch {
    // no-op; errors logged above
  }
}

export function startWeatherHub(): void {
  if (pollTimerCleanup != null) return;
  lastBridgeAttemptAt = Date.now();
  void ensureAtomBridge();
  pollWeather(true);
  pollTimerCleanup = visibleInterval('weather-hub-poll', () => pollWeather(false), POLL_INTERVAL_MS);
}

export function stopWeatherHub(): void {
  if (pollTimerCleanup != null) {
    pollTimerCleanup();
    pollTimerCleanup = null;
  }
  atomUnsubscribe?.();
  atomUnsubscribe = null;
  atomBridgeReady = false;
  atomValueSeen = false;
  atomInitPromise = null;
  lastBridgeAttemptAt = 0;
  lastCanvasStartedAt = null;
  lastCanvasStartedAtKey = null;
}

export function refreshWeatherState(): void {
  if (atomBridgeReady && atomValueSeen) {
    handleAtomWeatherValue(lastAtomValue);
  } else {
    pollWeather(true);
  }
}

export function onWeatherSnapshot(callback: (snapshot: WeatherSnapshot) => void, fireImmediately = true): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try {
      callback(current);
    } catch (error) {
      log('⚠️ Weather hub immediate listener failed', error);
    }
  }
  return () => {
    listeners.delete(callback);
  };
}

export function getWeatherSnapshot(): WeatherSnapshot {
  return current;
}

export function setWeatherOverride(kind: DetailedWeather, durationMs = 30000): void {
  const expiresAt = Date.now() + Math.max(1000, durationMs);
  override = { kind, expiresAt };
  pollWeather(true);
}
