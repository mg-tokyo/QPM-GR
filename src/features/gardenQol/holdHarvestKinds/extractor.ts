import {
  fetchBundleContaining,
  registerBundleConsumer,
  markBundleConsumerDone,
} from '../../../catalogs/logic/bundleParser';
import { healthBus } from '../../../diagnostics/healthBus';
import type { Subsystem } from '../../../diagnostics/types';

export interface ExtractedKind { actionType: string }
export interface ExtractorResult {
  kinds: ExtractedKind[];
  health: 'ok' | 'degraded' | 'failed';
}

const EXTRACTOR_SUBSYSTEM: Subsystem = 'feature:harvestKindExtractor';
const CONSUMER_NAME = 'harvest-kind-extractor';

// UI seed only — populates the toggle list synchronously before the async
// bundle scan runs (and covers the case where the scan finds nothing). The
// trigger path is data-driven: `instaHarvest.ts` classifies via the `action`
// atom, never via this list. A kind here that the game removed is inert —
// the action atom never returns it, so the toggle can be on and never fire.
const SEED_KINDS: ReadonlyArray<ExtractedKind> = [
  { actionType: 'rainbowHarvest' },
  { actionType: 'goldHarvest' },
  { actionType: 'preservedHarvest' },
  { actionType: 'rarePatchHarvest' },
];

export function getSeedKinds(): ExtractedKind[] {
  return SEED_KINDS.map(k => ({ ...k }));
}

const HARVEST_TOKEN_RE = /["'`]([A-Za-z][A-Za-z0-9]*[Hh]arvest)["'`]/g;
const MIN_OCCURRENCES = 2;

function tally(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  HARVEST_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HARVEST_TOKEN_RE.exec(text)) !== null) {
    const tok = m[1];
    if (!tok || tok === 'harvest' || tok === 'Harvest') continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  return counts;
}

export async function extractInitialKinds(): Promise<ExtractorResult> {
  registerBundleConsumer(CONSUMER_NAME);
  try {
    let text: string | null = null;
    try { text = await fetchBundleContaining('preservedHarvest'); } catch { text = null; }
    if (!text) {
      try { text = await fetchBundleContaining('rainbowHarvest'); } catch { text = null; }
    }

    if (!text) {
      publishHealth('degraded', 'no bundle chunk matched *Harvest markers');
      return { kinds: [], health: 'degraded' };
    }

    const counts = tally(text);
    const kinds: ExtractedKind[] = [];
    for (const [tok, count] of counts) {
      if (count >= MIN_OCCURRENCES) kinds.push({ actionType: tok });
    }

    if (kinds.length === 0) {
      publishHealth('degraded', 'no *Harvest tokens met occurrence threshold');
      return { kinds: [], health: 'degraded' };
    }

    publishHealth('ok', `${kinds.length} kind(s) extracted`);
    return { kinds, health: 'ok' };
  } catch {
    publishHealth('failed', 'extractor threw');
    return { kinds: [], health: 'failed' };
  } finally {
    markBundleConsumerDone(CONSUMER_NAME);
  }
}

function publishHealth(status: 'ok' | 'degraded' | 'failed', message: string): void {
  healthBus.publish({
    subsystem: EXTRACTOR_SUBSYSTEM,
    category: 'feature',
    status,
    message,
  });
}

export function getExtractorSubsystem(): Subsystem {
  return EXTRACTOR_SUBSYSTEM;
}
