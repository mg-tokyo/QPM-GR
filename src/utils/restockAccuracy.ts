// src/utils/restockAccuracy.ts
// Accuracy computation for restock predictions.
// Extracted from itemRestockDetailWindow.ts — pure functions, no side effects.

// ── Types ────────────────────────────────────────────────────────────────────

export interface AccuracyWindows {
  /** Error below this is "good" (green). */
  goodMs: number;
  /** Error below this is "warn" (yellow); above is "bad" (red). */
  warnMs: number;
  /** Scale parameter for the logistic scoring function. */
  scoreScaleMs: number;
}

export type EventStatus = 'accurate' | 'early' | 'late' | 'first';

export interface EventAccuracy {
  score: number;
  status: EventStatus;
  diffMs: number;
  estimatedTs: number | null;
  actualTs: number;
}

// ── Accuracy windows ─────────────────────────────────────────────────────────

/**
 * Compute adaptive accuracy windows for an item.
 *
 * When raw interval data is available (>= 5 samples), uses IQR-based windows
 * that scale naturally with the item's actual variability.
 *
 * Otherwise falls back to percentage-based windows with NO hard caps —
 * this was the root cause of celestial accuracy showing near-zero (the old
 * code capped goodMs at 1 hour, which is 0.04% of a 10-day median).
 */
export function getAccuracyWindows(
  medianMs: number | null,
  intervals?: number[] | null,
): AccuracyWindows {
  // IQR-based windows when we have enough data
  if (intervals && intervals.length >= 5) {
    const sorted = [...intervals].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
    const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
    const iqr = q3 - q1;
    // Cap scoreScaleMs at the median so high-variance items (IQR > median)
    // don't get artificially generous scoring from outlier-inflated IQR.
    const rawScale = iqr * 0.9;
    const cappedScale = medianMs != null && Number.isFinite(medianMs) && medianMs > 0
      ? Math.min(rawScale, medianMs * 0.9)
      : rawScale;
    // Proportional floor: 10% of median (not absolute) — prevents inflation
    // for fast-cycling items while staying fair for slow ones.
    const proportionalFloor = medianMs != null && medianMs > 0 ? medianMs * 0.10 : 60_000;
    return {
      goodMs: Math.max(iqr * 0.5, proportionalFloor, 30_000),
      warnMs: Math.max(iqr * 1.5, proportionalFloor * 3, 120_000),
      scoreScaleMs: Math.max(
        cappedScale,
        medianMs != null && medianMs > 0 ? medianMs * 0.20 : 120_000,
        120_000,
      ),
    };
  }

  // Percentage fallback — proportional floors (no absolute inflation)
  const base = medianMs != null && Number.isFinite(medianMs) && medianMs > 0
    ? medianMs
    : 1_800_000; // 30min default

  return {
    goodMs: Math.max(base * 0.10, 30_000),
    warnMs: Math.max(base * 0.30, 120_000),
    scoreScaleMs: Math.max(base * 0.40, 120_000),
  };
}

// ── Accuracy score ───────────────────────────────────────────────────────────

/**
 * Logistic decay scoring.
 *
 * Replaces the old arbitrary cubic (`100 / (1 + ratio^3.2)`) with a logistic
 * function that has well-defined statistical properties:
 * - score(0) = 100 (perfect prediction)
 * - score(scoreScaleMs) = 50 (midpoint)
 * - score(2 × scoreScaleMs) ≈ 0 (large error)
 */
export function computeAccuracyScore(errorMs: number, windows: AccuracyWindows): number {
  const absError = Math.abs(errorMs);
  if (windows.scoreScaleMs <= 0) return 50;
  const ratio = absError / windows.scoreScaleMs;
  return Math.round(100 / (1 + Math.exp(5.5 * (ratio - 1))));
}

// ── Per-event accuracy ───────────────────────────────────────────────────────

interface RowLike {
  timestamp: number;
  predicted_next_ms?: number | null;
}

/**
 * Compute accuracy for a single restock event.
 *
 * Uses logged model predictions when present. Falls back to interval-based
 * regularity by comparing `prevRow.timestamp + medianMs` with the event.
 */
export function computeEventAccuracy(
  row: RowLike,
  prevRow: RowLike | null,
  medianMs: number | null,
  intervals?: number[] | null,
): EventAccuracy {
  const windows = getAccuracyWindows(medianMs, intervals);
  const loggedPredictionTs =
    row.predicted_next_ms != null && Number.isFinite(row.predicted_next_ms) && row.predicted_next_ms > 0
      ? row.predicted_next_ms
      : null;

  // No logged prediction and no previous event to compare against.
  if (loggedPredictionTs == null && (!prevRow || medianMs == null || !Number.isFinite(medianMs) || medianMs <= 0)) {
    return {
      score: 0,
      status: 'first',
      diffMs: 0,
      estimatedTs: null,
      actualTs: row.timestamp,
    };
  }

  const estimatedTs = loggedPredictionTs ?? prevRow!.timestamp + medianMs!;
  const diffMs = row.timestamp - estimatedTs;
  const score = computeAccuracyScore(diffMs, windows);
  const absDiff = Math.abs(diffMs);
  let status: EventStatus;
  if (absDiff <= windows.goodMs) {
    status = 'accurate';
  } else if (diffMs < 0) {
    status = 'early';
  } else {
    status = 'late';
  }
  return {
    score,
    status,
    diffMs,
    estimatedTs,
    actualTs: row.timestamp,
  };
}

// ── Confidence interval ──────────────────────────────────────────────────────

/**
 * Compute an empirical confidence interval from raw intervals.
 * Returns [lo, hi] in ms — the bounds that contain `confidence` fraction
 * of observed intervals.
 *
 * Returns `null` if insufficient data (< 5 intervals).
 */
export function getConfidenceInterval(
  intervals: number[],
  confidence = 0.80,
): [number, number] | null {
  if (intervals.length < 5) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const lo = Math.floor(sorted.length * (1 - confidence) / 2);
  const hi = Math.ceil(sorted.length * (1 + confidence) / 2) - 1;
  return [sorted[lo]!, sorted[Math.min(hi, sorted.length - 1)]!];
}
