// src/utils/timerManager.ts
// Unified timer management using requestAnimationFrame
// Replaces scattered setInterval calls with a single efficient loop

type TimerCallback = () => void;
type TimerPriority = 'critical' | 'normal' | 'low';

interface Timer {
  id: string;
  callback: TimerCallback;
  intervalMs: number;
  lastRun: number;
  priority: TimerPriority;
  runWhenHidden: boolean;
  paused: boolean;
}

// Hoisted so the tick loop doesn't allocate a new array every frame
const TICK_PRIORITIES: readonly TimerPriority[] = ['critical', 'normal', 'low'];

// Singleton timer manager
class TimerManager {
  private timers = new Map<string, Timer>();
  private rafId: number | null = null;
  private isRunning = false;
  private isPageVisible = true;
  private lastFrameTime = 0;
  private hiddenTimerCount = 0;

  constructor() {
    // Listen for visibility changes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private handleVisibilityChange = (): void => {
    this.isPageVisible = !document.hidden;
    
    if (this.isPageVisible && this.timers.size > 0) {
      // Resume the loop if we have timers
      this.start();
    }
  };

  /**
   * Register a timer callback
   * @param id Unique identifier for the timer
   * @param callback Function to call
   * @param intervalMs How often to call (in milliseconds)
   * @param options Additional options
   */
  register(
    id: string,
    callback: TimerCallback,
    intervalMs: number,
    options: {
      priority?: TimerPriority;
      runWhenHidden?: boolean;
      immediate?: boolean;
    } = {}
  ): () => void {
    const { priority = 'normal', runWhenHidden = false, immediate = false } = options;

    // Remove existing timer with same ID (decrement counter if it was hidden-capable)
    const existing = this.timers.get(id);
    if (existing && existing.runWhenHidden && !existing.paused) {
      this.hiddenTimerCount--;
    }
    this.timers.delete(id);

    const timer: Timer = {
      id,
      callback,
      intervalMs,
      lastRun: immediate ? 0 : performance.now(),
      priority,
      runWhenHidden,
      paused: false,
    };

    this.timers.set(id, timer);
    if (runWhenHidden) this.hiddenTimerCount++;

    // Start the loop if not running
    if (!this.isRunning) {
      this.start();
    }

    // Return unregister function
    return () => this.unregister(id);
  }

  /**
   * Unregister a timer
   */
  unregister(id: string): void {
    const timer = this.timers.get(id);
    if (timer && timer.runWhenHidden && !timer.paused) {
      this.hiddenTimerCount--;
    }
    this.timers.delete(id);

    // Stop loop if no timers left
    if (this.timers.size === 0) {
      this.stop();
    }
  }

  /**
   * Pause a specific timer
   */
  pause(id: string): void {
    const timer = this.timers.get(id);
    if (timer && !timer.paused) {
      if (timer.runWhenHidden) this.hiddenTimerCount--;
      timer.paused = true;
    }
  }

  /**
   * Resume a specific timer
   */
  resume(id: string): void {
    const timer = this.timers.get(id);
    if (timer && timer.paused) {
      timer.paused = false;
      timer.lastRun = performance.now(); // Reset to avoid immediate trigger
      if (timer.runWhenHidden) this.hiddenTimerCount++;
    }
  }

  /**
   * Check if a timer exists
   */
  has(id: string): boolean {
    return this.timers.has(id);
  }

  /**
   * Get count of active timers
   */
  get count(): number {
    return this.timers.size;
  }

  private start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
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
    const deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // Skip if page is hidden and we don't have hidden-capable timers
    const hasVisibleTimers = this.isPageVisible || this.hiddenTimerCount > 0;
    
    if (!hasVisibleTimers) {
      // Schedule next frame but don't process timers
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    // Process timers by priority (array is module-level to avoid per-frame allocation)
    for (const priority of TICK_PRIORITIES) {
      for (const timer of this.timers.values()) {
        if (timer.priority !== priority) continue;
        if (timer.paused) continue;
        if (!this.isPageVisible && !timer.runWhenHidden) continue;

        const elapsed = now - timer.lastRun;
        if (elapsed >= timer.intervalMs) {
          try {
            timer.callback();
          } catch (error) {
            console.error(`[TimerManager] Timer "${timer.id}" error:`, error);
          }
          timer.lastRun = now;
        }
      }
    }

    // Schedule next frame
    this.rafId = requestAnimationFrame(this.tick);
  };

  /**
   * Clean up all timers
   */
  destroy(): void {
    this.stop();
    this.timers.clear();
    this.hiddenTimerCount = 0;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  /**
   * Get debug info about active timers
   */
  getDebugInfo(): { id: string; intervalMs: number; priority: TimerPriority; paused: boolean }[] {
    return Array.from(this.timers.values()).map(t => ({
      id: t.id,
      intervalMs: t.intervalMs,
      priority: t.priority,
      paused: t.paused,
    }));
  }
}

// Export singleton instance
export const timerManager = new TimerManager();

// Legacy compatibility - drop-in replacement for setInterval
export function managedInterval(
  id: string,
  callback: TimerCallback,
  intervalMs: number,
  options?: { priority?: TimerPriority; runWhenHidden?: boolean }
): () => void {
  return timerManager.register(id, callback, intervalMs, options);
}

// For timers that should only run when visible (most UI timers)
export function visibleInterval(
  id: string,
  callback: TimerCallback,
  intervalMs: number
): () => void {
  return timerManager.register(id, callback, intervalMs, {
    runWhenHidden: false,
    priority: 'normal',
  });
}

// For critical timers that must run even when hidden
export function criticalInterval(
  id: string,
  callback: TimerCallback,
  intervalMs: number
): () => void {
  return timerManager.register(id, callback, intervalMs, {
    runWhenHidden: true,
    priority: 'critical',
  });
}






