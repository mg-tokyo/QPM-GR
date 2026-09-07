// ============================================================================
// BATCHED SUBSCRIPTION MANAGER
// Uses a single requestAnimationFrame loop instead of multiple setIntervals
// ============================================================================

type SubscriptionEntry = {
  atom: unknown;
  callbacks: Set<() => void>;
  getValue: () => unknown;
  lastValue: unknown;
};

class BatchedSubscriptionManager {
  private subscriptions = new Map<unknown, SubscriptionEntry>();
  private rafId: number | null = null;
  private isRunning = false;
  private lastPollTime = 0;
  private readonly POLL_INTERVAL_MS = 500; // Poll every 500ms instead of 100-250ms per subscription

  subscribe(atom: unknown, cb: () => void, getValue: () => unknown): () => void {
    let entry = this.subscriptions.get(atom);
    if (!entry) {
      entry = { atom, callbacks: new Set(), getValue, lastValue: undefined };
      // Get initial value
      try { entry.lastValue = getValue(); } catch {}
      this.subscriptions.set(atom, entry);
    }
    entry.callbacks.add(cb);

    // Start polling if not already running
    if (!this.isRunning && this.subscriptions.size > 0) {
      this.start();
    }

    return () => {
      entry?.callbacks.delete(cb);
      if (entry?.callbacks.size === 0) {
        this.subscriptions.delete(atom);
        if (this.subscriptions.size === 0) {
          this.stop();
        }
      }
    };
  }

  private start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastPollTime = performance.now();
    this.tick();
  }

  private stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isRunning = false;
  }

  private tick = (): void => {
    if (!this.isRunning) return;

    const now = performance.now();
    const elapsed = now - this.lastPollTime;

    // Only poll at the configured interval
    if (elapsed >= this.POLL_INTERVAL_MS) {
      this.lastPollTime = now;
      this.pollAllSubscriptions();
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private pollAllSubscriptions(): void {
    for (const entry of this.subscriptions.values()) {
      try {
        const current = entry.getValue();
        if (current !== entry.lastValue) {
          entry.lastValue = current;
          // Call all callbacks for this atom
          for (const cb of entry.callbacks) {
            try { cb(); } catch {}
          }
        }
      } catch {}
    }
  }

  getStats(): { count: number; atoms: string[] } {
    return {
      count: this.subscriptions.size,
      atoms: Array.from(this.subscriptions.keys()).map(a => String(a)),
    };
  }
}

export const batchedSubscriptionManager = new BatchedSubscriptionManager();

export function getJotaiSubscriptionStats(): { count: number; atoms: string[] } {
  return batchedSubscriptionManager.getStats();
}
