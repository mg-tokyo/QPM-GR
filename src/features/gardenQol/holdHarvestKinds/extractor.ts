import {
  fetchAllBundlesContaining,
  registerBundleConsumer,
  markBundleConsumerDone,
} from '../../../catalogs/logic/bundleParser';
import { healthBus } from '../../../diagnostics/healthBus';
import type { Subsystem } from '../../../diagnostics/types';
import { criticalInterval } from '../../../utils/scheduling/timerManager';

export interface ExtractedKind { actionType: string }

const SUBSYSTEM: Subsystem = 'feature:harvestKindExtractor';
const CONSUMER = 'harvest-kind-extractor';

// UI seed only — the toggle list needs the well-known 4 kinds synchronously
// before the async scan runs, and the seed stays visible if the scan finds
// nothing. Trigger path is data-driven via the `action` atom, never this list
// (see instaHarvest.ts) — a kind here that the game removed is inert.
const SEED_KINDS: ReadonlyArray<ExtractedKind> = [
  { actionType: 'rainbowHarvest' },
  { actionType: 'goldHarvest' },
  { actionType: 'preservedHarvest' },
  { actionType: 'rarePatchHarvest' },
];

export function getSeedKinds(): ExtractedKind[] {
  return SEED_KINDS.map(k => ({ ...k }));
}

// The marker substring also hits localization-*.js, where the kinds are bare
// `preservedHarvest:{…}` colour keys that the quoted-only regex ignores. The
// colour consumers cache that chunk first, and a first-match lookup returned it
// over the uncached main-*.js — so every matching chunk is tallied together.
const TOKEN_RE = /["'`]([A-Za-z][A-Za-z0-9]*[Hh]arvest)["'`]/g;
const MARKER = 'preservedHarvest';
const MIN_HITS = 2;
const RETRY_MS = 1000;
const MAX_ATTEMPTS = 20;

let stopTimer: (() => void) | null = null;
let attempts = 0;
let inFlight = false;
let onKindsCb: ((kinds: ExtractedKind[]) => void) | null = null;

function finish(status: 'ok' | 'degraded' | 'failed', message: string): void {
  stopTimer?.();
  stopTimer = null;
  onKindsCb = null;
  healthBus.publish({ subsystem: SUBSYSTEM, category: 'feature', status, message });
  markBundleConsumerDone(CONSUMER);
}

async function attempt(): Promise<void> {
  if (inFlight || !onKindsCb) return;
  inFlight = true;
  attempts++;
  try {
    const counts = new Map<string, number>();
    for (const text of await fetchAllBundlesContaining(MARKER)) {
      TOKEN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        const tok = m[1];
        if (!tok || tok === 'harvest' || tok === 'Harvest') continue;
        counts.set(tok, (counts.get(tok) ?? 0) + 1);
      }
    }
    const kinds: ExtractedKind[] = [];
    for (const [actionType, n] of counts) if (n >= MIN_HITS) kinds.push({ actionType });
    if (kinds.length > 0) {
      onKindsCb?.(kinds);
      finish('ok', `${kinds.length} kind(s) extracted`);
    } else if (attempts >= MAX_ATTEMPTS) {
      finish('degraded', 'no *Harvest tokens met occurrence threshold');
    }
  } catch {
    finish('failed', 'extractor threw');
  } finally {
    inFlight = false;
  }
}

export function startHarvestKindExtractor(onKinds: (kinds: ExtractedKind[]) => void): void {
  if (stopTimer) return;
  onKindsCb = onKinds;
  attempts = 0;
  registerBundleConsumer(CONSUMER);
  stopTimer = criticalInterval('qpm-harvest-kind-extractor', () => { void attempt(); }, RETRY_MS);
  void attempt();
}

export function stopHarvestKindExtractor(): void {
  if (!stopTimer) return;
  stopTimer();
  stopTimer = null;
  onKindsCb = null;
  markBundleConsumerDone(CONSUMER);
}
