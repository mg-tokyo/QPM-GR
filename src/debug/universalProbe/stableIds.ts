import type { ProbeBucket, ProbeCandidateBase, ProbeContainerCandidate } from './types';

interface StableTrack {
  id: number;
  fingerprint: string;
  source: string;
  kind: string;
  type: string;
  label: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  lastSeen: number;
}

export interface StableIdTracker {
  assign: <T extends ProbeCandidateBase>(items: T[], bucket: ProbeBucket, prefix: string) => void;
  reset: () => void;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const DIGITS_RE = /\d+/g;
const MULTI_SPACE_RE = /\s+/g;

function normalizeStableToken(value: string): string {
  return value
    .replace(UUID_RE, '')
    .replace(DIGITS_RE, '#')
    .replace(MULTI_SPACE_RE, ' ')
    .toLowerCase()
    .trim()
    .slice(0, 96);
}

function stableFingerprintForItem(item: ProbeCandidateBase, bucket: ProbeBucket): string {
  const parts: string[] = [
    bucket,
    item.source,
    item.kind,
    item.type,
    normalizeStableToken(item.label),
    normalizeStableToken(item.assetHint ?? ''),
  ];
  // Include layout summary for container candidates
  const container = item as Partial<ProbeContainerCandidate>;
  if (container.layout) {
    parts.push(container.layout.pattern);
    parts.push(String(container.layout.inferredCols));
    parts.push(String(container.layout.inferredRows));
  }
  return parts.join('|');
}

const MAX_TRACKS = 2500;
const EVICT_AGE_MS = 10 * 60 * 1000; // 10 minutes

export function createStableIdTracker(): StableIdTracker {
  const tracks = new Map<string, StableTrack>();
  let nextId = 1;

  function evictStale(now: number): void {
    if (tracks.size <= MAX_TRACKS) return;
    for (const [key, track] of tracks) {
      if (now - track.lastSeen > EVICT_AGE_MS) {
        tracks.delete(key);
      }
    }
  }

  function pickStableTrack(
    fingerprint: string,
    source: string,
    kind: string,
    type: string,
    label: string,
    cx: number,
    cy: number,
    width: number,
    height: number,
  ): StableTrack | null {
    // Exact fingerprint match
    const exact = tracks.get(fingerprint);
    if (exact) return exact;

    // Loose match: same source/kind/type, compatible label, within distance/size threshold
    const normalizedLabel = normalizeStableToken(label);
    let bestMatch: StableTrack | null = null;
    let bestDist = Infinity;

    for (const track of tracks.values()) {
      if (track.source !== source || track.kind !== kind || track.type !== type) continue;
      if (normalizeStableToken(track.label) !== normalizedLabel) continue;

      const dx = cx - track.cx;
      const dy = cy - track.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Distance threshold: 150px
      if (dist > 150) continue;

      // Size threshold: within 2x
      const sizeRatio = Math.max(width / (track.width || 1), track.width / (width || 1));
      const heightRatio = Math.max(height / (track.height || 1), track.height / (height || 1));
      if (sizeRatio > 2 || heightRatio > 2) continue;

      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = track;
      }
    }

    return bestMatch;
  }

  function assign<T extends ProbeCandidateBase>(items: T[], bucket: ProbeBucket, prefix: string): void {
    const now = Date.now();
    evictStale(now);

    for (const item of items) {
      const fingerprint = stableFingerprintForItem(item, bucket);
      const cx = item.boundsCss.left + item.boundsCss.width / 2;
      const cy = item.boundsCss.top + item.boundsCss.height / 2;

      let track = pickStableTrack(
        fingerprint,
        item.source,
        item.kind,
        item.type,
        item.label,
        cx,
        cy,
        item.boundsCss.width,
        item.boundsCss.height,
      );

      if (track) {
        // Update existing track position and timestamp
        track.cx = cx;
        track.cy = cy;
        track.width = item.boundsCss.width;
        track.height = item.boundsCss.height;
        track.lastSeen = now;
        track.fingerprint = fingerprint;
        // Ensure it's indexed by current fingerprint
        if (!tracks.has(fingerprint)) {
          tracks.set(fingerprint, track);
        }
      } else {
        // Create new track
        const id = nextId++;
        track = {
          id,
          fingerprint,
          source: item.source,
          kind: item.kind,
          type: item.type,
          label: item.label,
          cx,
          cy,
          width: item.boundsCss.width,
          height: item.boundsCss.height,
          lastSeen: now,
        };
        tracks.set(fingerprint, track);
      }

      item.stableKey = fingerprint;
      item.stableId = track.id;
      item.stableTag = `${prefix}${track.id}`;
    }
  }

  function reset(): void {
    tracks.clear();
    nextId = 1;
  }

  return { assign, reset };
}
