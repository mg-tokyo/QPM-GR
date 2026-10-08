export const REWRAP_MAX = 4;
export const REWRAP_WINDOW_MS = 60_000;

/** Re-wraps of one hook (A R7). Each round of a fight with a script that also re-wraps adds two wrappers to the chain,
 * so more than REWRAP_MAX in a minute stops re-wrapping until the next install: the chain stays bounded. */
export class RewrapBudget {
  private readonly times: number[] = [];
  private isCapped = false;

  /** 'capped' once (report it), then 'denied'. */
  take(now: number): 'ok' | 'capped' | 'denied' {
    if (this.isCapped) return 'denied';
    while (this.times.length > 0 && now - this.times[0]! >= REWRAP_WINDOW_MS) this.times.shift();
    if (this.times.length >= REWRAP_MAX) { this.isCapped = true; return 'capped'; }
    this.times.push(now);
    return 'ok';
  }

  capped(): boolean { return this.isCapped; }
}
