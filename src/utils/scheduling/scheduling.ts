// src/utils/scheduling.ts
// Cooperative scheduling utilities for async work

/**
 * Yield control back to the browser event loop.
 * Allows UI updates and prevents long-running scripts from freezing the page.
 */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    // Use setTimeout with 0 delay to yield to macrotask queue
    setTimeout(resolve, 0);
  });
}

/**
 * Wait for a specified number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to become true.
 * @param condition Function that returns true when ready
 * @param maxWaitMs Maximum time to wait
 * @param pollInterval How often to check (default 50ms)
 */
export async function waitFor(
  condition: () => boolean,
  maxWaitMs: number = 5000,
  pollInterval: number = 50
): Promise<boolean> {
  const start = Date.now();
  
  while (Date.now() - start < maxWaitMs) {
    if (condition()) {
      return true;
    }
    await delay(pollInterval);
  }
  
  return condition();
}

/**
 * YieldController provides cooperative multitasking for batch operations.
 * Automatically yields to the browser after a certain amount of work.
 */
export class YieldController {
  private lastYield: number = 0;
  private readonly yieldInterval: number;
  private workCount: number = 0;
  private readonly workThreshold: number;

  /**
   * @param yieldIntervalMs Yield at least every N milliseconds (default 16ms for 60fps)
   * @param workThreshold Yield after N work items (default 100)
   */
  constructor(yieldIntervalMs: number = 16, workThreshold: number = 100) {
    this.yieldInterval = yieldIntervalMs;
    this.workThreshold = workThreshold;
    this.lastYield = performance.now();
  }

  /**
   * Call this after each unit of work. Will yield if needed.
   */
  async yieldIfNeeded(): Promise<void> {
    this.workCount++;
    
    const now = performance.now();
    const elapsed = now - this.lastYield;
    
    if (elapsed >= this.yieldInterval || this.workCount >= this.workThreshold) {
      await yieldToBrowser();
      this.lastYield = performance.now();
      this.workCount = 0;
    }
  }

  /**
   * Force a yield regardless of timing.
   */
  async forceYield(): Promise<void> {
    await yieldToBrowser();
    this.lastYield = performance.now();
    this.workCount = 0;
  }

  /**
   * Reset the controller state.
   */
  reset(): void {
    this.lastYield = performance.now();
    this.workCount = 0;
  }
}

/**
 * Process an array in batches with automatic yielding.
 * @param items Array to process
 * @param processor Function to call for each item
 * @param batchSize Process this many items before yielding (default 50)
 */
export async function processBatched<T>(
  items: T[],
  processor: (item: T, index: number) => void | Promise<void>,
  batchSize: number = 50
): Promise<void> {
  const yieldCtrl = new YieldController(16, batchSize);
  
  for (let i = 0; i < items.length; i++) {
    await processor(items[i]!, i);
    await yieldCtrl.yieldIfNeeded();
  }
}

/**
 * Throttle a function to run at most once per interval.
 * @param fn Function to throttle
 * @param limitMs Minimum time between calls
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limitMs: number
): T {
  let lastRun = 0;
  let pendingArgs: Parameters<T> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const throttled = (...args: Parameters<T>) => {
    const now = Date.now();
    const elapsed = now - lastRun;

    if (elapsed >= limitMs) {
      lastRun = now;
      fn(...args);
    } else {
      // Schedule for when the cooldown expires
      pendingArgs = args;
      if (!timeout) {
        timeout = setTimeout(() => {
          timeout = null;
          if (pendingArgs) {
            lastRun = Date.now();
            fn(...pendingArgs);
            pendingArgs = null;
          }
        }, limitMs - elapsed);
      }
    }
  };

  return throttled as T;
}

/**
 * Debounce a function to run only after a pause in calls.
 * @param fn Function to debounce
 * @param waitMs Time to wait after last call
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  waitMs: number
): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      fn(...args);
    }, waitMs);
  };

  return debounced as T;
}

/**
 * Schedule work during browser idle time (Aries Mod pattern).
 * Uses requestIdleCallback when available, falling back to rAF then setTimeout.
 * This prevents blocking the main thread during heavy operations.
 * 
 * @param cb Callback to execute during idle time
 * @param timeoutMs Maximum time to wait before forcing execution (default 50ms)
 */
export function scheduleNonBlocking<T>(cb: () => T | Promise<T>, timeoutMs: number = 50): Promise<T> {
  return new Promise((resolve, reject) => {
    const runner = () => {
      Promise.resolve()
        .then(cb)
        .then(resolve)
        .catch(reject);
    };

    // Prefer requestIdleCallback for true idle-time scheduling
    if (typeof (window as any).requestIdleCallback === 'function') {
      (window as any).requestIdleCallback(runner, { timeout: timeoutMs });
    } else if (typeof requestAnimationFrame === 'function') {
      // Fallback to rAF - runs before next paint
      requestAnimationFrame(runner);
    } else {
      // Last resort - use setTimeout
      setTimeout(runner, 0);
    }
  });
}

/**
 * Process items in staggered batches (Aries Mod pattern).
 * Processes BATCH_SIZE items, then waits DELAY_MS before next batch.
 * 
 * @param items Array of items to process
 * @param processor Async function to process each item
 * @param onProgress Optional progress callback
 * @param batchSize Number of items per batch (default 3)
 * @param delayMs Delay between batches in ms (default 8)
 */
export async function processStaggered<T>(
  items: T[],
  processor: (item: T, index: number) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
  batchSize: number = 3,
  delayMs: number = 8
): Promise<void> {
  const total = items.length;
  let done = 0;

  const processBatch = async (startIndex: number): Promise<void> => {
    const batch = items.slice(startIndex, startIndex + batchSize);
    
    // Process batch items in parallel
    await Promise.all(
      batch.map(async (item, i) => {
        await processor(item, startIndex + i);
        done++;
        onProgress?.(done, total);
      })
    );

    // Schedule next batch if there are more items
    const nextStart = startIndex + batchSize;
    if (nextStart < items.length) {
      await delay(delayMs);
      await processBatch(nextStart);
    }
  };

  if (items.length > 0) {
    await processBatch(0);
  }
}

