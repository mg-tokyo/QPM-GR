import { storage } from '../../../utils/storage';
import { isRecord } from '../../../utils/typeGuards';

const OBSERVED_KEY = 'qpm.gardenQol.observedHarvestActions.v1';
const TOGGLES_KEY = 'qpm.gardenQol.instaHarvestActions.v1';

export interface HarvestKind {
  actionType: string;
  firstSeen: number;
  source: 'extractor' | 'observer' | 'both' | 'config';
}

interface ObservedEntry { actionType: string; firstSeen: number }

let extractorSnapshot: ReadonlyArray<{ actionType: string }> = [];
let cachedEnabled: Set<string> | null = null;

function loadObserved(): ObservedEntry[] {
  const raw = storage.get<unknown>(OBSERVED_KEY, null);
  if (!Array.isArray(raw)) return [];
  const out: ObservedEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.actionType !== 'string' || item.actionType.length === 0) continue;
    const firstSeen = typeof item.firstSeen === 'number' ? item.firstSeen : 0;
    out.push({ actionType: item.actionType, firstSeen });
  }
  return out;
}

function loadToggles(): Record<string, boolean> {
  const raw = storage.get<unknown>(TOGGLES_KEY, null);
  if (!isRecord(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function persistObserved(entries: ObservedEntry[]): void {
  storage.set(OBSERVED_KEY, entries);
}

function persistToggles(toggles: Record<string, boolean>): void {
  storage.set(TOGGLES_KEY, toggles);
}

export function setExtractorSnapshot(kinds: ReadonlyArray<{ actionType: string }>): void {
  extractorSnapshot = kinds.slice();
}

export function recordObservedKind(actionType: string): boolean {
  const observed = loadObserved();
  if (observed.some(e => e.actionType === actionType)) return false;
  observed.push({ actionType, firstSeen: Date.now() });
  persistObserved(observed);
  return true;
}

export function getKinds(): HarvestKind[] {
  const observed = loadObserved();
  const toggles = loadToggles();
  const observedByKey = new Map(observed.map(e => [e.actionType, e]));
  const extractorKeys = new Set(extractorSnapshot.map(e => e.actionType));

  const merged = new Map<string, HarvestKind>();

  for (const e of extractorSnapshot) {
    const obs = observedByKey.get(e.actionType);
    merged.set(e.actionType, {
      actionType: e.actionType,
      firstSeen: 0,
      source: obs ? 'both' : 'extractor',
    });
  }
  for (const e of observed) {
    if (merged.has(e.actionType)) continue;
    merged.set(e.actionType, {
      actionType: e.actionType,
      firstSeen: e.firstSeen,
      source: 'observer',
    });
  }
  for (const key of Object.keys(toggles)) {
    if (merged.has(key)) continue;
    merged.set(key, { actionType: key, firstSeen: 0, source: 'config' });
  }

  const out = Array.from(merged.values());
  out.sort((a, b) => {
    if (a.firstSeen === b.firstSeen) {
      const ai = extractorKeys.has(a.actionType) ? 0 : 1;
      const bi = extractorKeys.has(b.actionType) ? 0 : 1;
      return ai - bi;
    }
    return a.firstSeen - b.firstSeen;
  });
  return out;
}

export function getUserToggles(): Record<string, boolean> {
  return loadToggles();
}

export function setEnabled(actionType: string, enabled: boolean): void {
  const toggles = loadToggles();
  toggles[actionType] = enabled;
  persistToggles(toggles);
  cachedEnabled = null;
}

export function seedToggles(seed: Record<string, boolean>): void {
  const existing = loadToggles();
  const merged = { ...seed, ...existing };
  persistToggles(merged);
  cachedEnabled = null;
}

export function getEnabledActions(): Set<string> {
  if (cachedEnabled) return cachedEnabled;
  const toggles = loadToggles();
  const set = new Set<string>();
  for (const [k, v] of Object.entries(toggles)) if (v === true) set.add(k);
  cachedEnabled = set;
  return set;
}

export function invalidateEnabledCache(): void {
  cachedEnabled = null;
}
