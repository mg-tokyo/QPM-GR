// Ability-rate data from bundle text: day cycle (stage minutes, nocturnal bonus, chance cap) and
// crystal pet modifiers. Parsing lives in dayCycleParsing.ts / crystalModifierParsing.ts.
// No persistence (REL-6 PD1): parts stay null until parsed.

import { fetchBundleContaining, getMarkerMissCount, markBundleConsumerDone, onNewBundleChunk, registerBundleConsumer } from './bundleParser';
import { CRYSTAL_MODIFIER_MARKER, parseCrystalModifiers } from './crystalModifierParsing';
import type { CrystalModifierTable } from './crystalModifierParsing';
import {
  CHANCE_CAP_MARKER, DAY_CYCLE_MARKER, NOCTURNAL_BONUS_MARKER,
  parseChanceCap, parseDayCycleStages, parseNocturnalBonus,
} from './dayCycleParsing';
import type { DayCycleStage } from './dayCycleParsing';
import { isGameStateReady, subscribe } from '../../core/gameState';
import { createNamedLogger } from '../../diagnostics/logger';

export type { DayCycleStage, StageKeyMismatch } from './dayCycleParsing';
export type { CrystalModifier, CrystalModifierTable } from './crystalModifierParsing';

export interface DayCycleData {
  stages: readonly DayCycleStage[] | null;
  nocturnalBonus: Readonly<Record<string, number>> | null;
  chanceCapPerMinute: number | null;
  crystalModifiers: CrystalModifierTable | null;
}

export interface DayCyclePartStatus {
  resolved: boolean;
  attempts: number;
  parseFailures: number;
  markerMisses: number;   // chunks fetched and rejected for this marker
}

export interface DayCycleSourceStatus {
  started: boolean;
  complete: boolean;
  chunkRetryActive: boolean;
  stageWatchActive: boolean;
  parts: { cycle: DayCyclePartStatus; bonus: DayCyclePartStatus; cap: DayCyclePartStatus; crystal: DayCyclePartStatus };
  stagesSeen: string[];
}

interface Part<T> {
  readonly marker: RegExp;
  readonly parse: (text: string) => T | null;
  value: T | null;
  attempts: number;
  parseFailures: number;
}

const CONSUMER = 'day-cycle';
const MAX_STAGES_SEEN = 32;
const log = createNamedLogger('catalogs');

const cycle: Part<readonly DayCycleStage[]> = { marker: DAY_CYCLE_MARKER, parse: parseDayCycleStages, value: null, attempts: 0, parseFailures: 0 };
const bonus: Part<Readonly<Record<string, number>>> = { marker: NOCTURNAL_BONUS_MARKER, parse: parseNocturnalBonus, value: null, attempts: 0, parseFailures: 0 };
const cap: Part<number> = { marker: CHANCE_CAP_MARKER, parse: parseChanceCap, value: null, attempts: 0, parseFailures: 0 };
const crystal: Part<CrystalModifierTable> = { marker: CRYSTAL_MODIFIER_MARKER, parse: parseCrystalModifiers, value: null, attempts: 0, parseFailures: 0 };

const listeners = new Set<() => void>();
const stagesSeen = new Set<string>();
let started = false;
let inFlight: Promise<void> | null = null;
let rerun = false;
let chunkRetry: (() => void) | null = null;
let stageUnsub: (() => void) | null = null;

const isComplete = (): boolean => cycle.value !== null && bonus.value !== null && cap.value !== null && crystal.value !== null;

async function loadPart<T>(part: Part<T>): Promise<boolean> {
  if (part.value !== null) return false;
  part.attempts += 1;
  const text = await fetchBundleContaining(part.marker);
  if (!text) return false;
  const value = part.parse(text);
  if (value === null) { part.parseFailures += 1; return false; }
  part.value = value;
  return true;
}

function releaseChunkRetry(): void {
  if (chunkRetry) { chunkRetry(); chunkRetry = null; }
}

function emitChange(): void {
  for (const cb of Array.from(listeners)) {
    try { cb(); } catch (error) { log.debug('dayCycle: listener threw', { error: String(error) }); }
  }
}

// A call during an in-flight load reruns once after it, so a chunk that landed
// mid-scan is still tried (candidates are collected at the start of each scan).
function loadMissing(): Promise<void> {
  if (inFlight) { rerun = true; return inFlight; }
  inFlight = (async () => {
    registerBundleConsumer(CONSUMER);
    try {
      const gotCycle = await loadPart(cycle);
      const gotBonus = await loadPart(bonus);
      const gotCap = await loadPart(cap);
      const gotCrystal = await loadPart(crystal);
      if (isComplete()) releaseChunkRetry();
      if (gotCycle || gotBonus || gotCap || gotCrystal) emitChange();
    } catch (error) {
      log.debug('dayCycle: load failed', { error: String(error) });
    } finally {
      markBundleConsumerDone(CONSUMER);
    }
  })().finally(() => {
    inFlight = null;
    const again = rerun && started && !isComplete();
    rerun = false;
    if (again) void loadMissing();
  });
  return inFlight;
}

function recordStage(stage: string | null): void {
  if (typeof stage === 'string' && stagesSeen.size < MAX_STAGES_SEEN) stagesSeen.add(stage);
}

export function startDayCycleSource(): void {
  if (started) return;
  started = true;
  if (!isComplete()) chunkRetry = onNewBundleChunk(() => { void loadMissing(); });
  void loadMissing();
  if (isGameStateReady()) stageUnsub = subscribe('dayNightStage', recordStage);
}

export function stopDayCycleSource(): void {
  started = false;
  rerun = false;
  releaseChunkRetry();
  if (stageUnsub) { stageUnsub(); stageUnsub = null; }
}

export function getDayCycle(): DayCycleData {
  return { stages: cycle.value, nocturnalBonus: bonus.value, chanceCapPerMinute: cap.value, crystalModifiers: crystal.value };
}

/** Fires when a part resolves. */
export function onDayCycleChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function partStatus<T>(part: Part<T>): DayCyclePartStatus {
  return { resolved: part.value !== null, attempts: part.attempts, parseFailures: part.parseFailures, markerMisses: getMarkerMissCount(part.marker) };
}

export function getDayCycleSourceStatus(): DayCycleSourceStatus {
  return {
    started,
    complete: isComplete(),
    chunkRetryActive: chunkRetry !== null,
    stageWatchActive: stageUnsub !== null,
    parts: { cycle: partStatus(cycle), bonus: partStatus(bonus), cap: partStatus(cap), crystal: partStatus(crystal) },
    stagesSeen: [...stagesSeen],
  };
}
