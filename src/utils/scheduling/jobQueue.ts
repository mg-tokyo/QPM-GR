// src/utils/jobQueue.ts
// Frame-budgeted job queue for processing work without blocking the main thread
// Based on Aries mod's JobQueue pattern

export interface Job {
  key: string;
  priority: number;
  run: () => void | Promise<void>;
}

export interface JobQueueConfig {
  /** Whether job processing is enabled */
  enabled: boolean;
  /** Maximum time budget per tick in milliseconds */
  budgetMs: number;
  /** Maximum number of jobs to process per tick */
  capPerTick: number;
  /** Whether to allow async jobs (if false, only sync jobs are processed) */
  allowAsync: boolean;
}

const DEFAULT_CONFIG: JobQueueConfig = {
  enabled: true,
  budgetMs: 8,
  capPerTick: 10,
  allowAsync: false,
};

/**
 * A job queue that processes work within a frame budget.
 * Designed to be ticked from requestAnimationFrame or game ticker.
 */
export class JobQueue {
  private queue: Job[] = [];
  private keySet = new Set<string>();
  private config: JobQueueConfig;
  private processing = false;

  constructor(config: Partial<JobQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration at runtime
   */
  configure(config: Partial<JobQueueConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Add a job to the queue. Jobs with higher priority are processed first.
   * If a job with the same key exists, it won't be added again.
   */
  enqueue(job: Job): boolean {
    if (this.keySet.has(job.key)) {
      return false;
    }

    this.queue.push(job);
    this.keySet.add(job.key);
    
    // Sort by priority (descending - higher priority first)
    this.queue.sort((a, b) => b.priority - a.priority);
    
    return true;
  }

  /**
   * Add multiple jobs at once
   */
  enqueueAll(jobs: Job[]): number {
    let added = 0;
    for (const job of jobs) {
      if (this.enqueue(job)) {
        added++;
      }
    }
    return added;
  }

  /**
   * Remove a job by key
   */
  remove(key: string): boolean {
    if (!this.keySet.has(key)) {
      return false;
    }

    const index = this.queue.findIndex((j) => j.key === key);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
    this.keySet.delete(key);
    return true;
  }

  /**
   * Clear all pending jobs
   */
  clear(): void {
    this.queue.length = 0;
    this.keySet.clear();
  }

  /**
   * Get the number of pending jobs
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Check if a job with the given key is queued
   */
  has(key: string): boolean {
    return this.keySet.has(key);
  }

  /**
   * Process jobs within the time budget.
   * Call this from your animation loop or game ticker.
   * 
   * @returns The time used in milliseconds
   */
  tick(): number {
    if (!this.config.enabled || this.queue.length === 0 || this.processing) {
      return 0;
    }

    this.processing = true;
    const start = performance.now();
    let jobsRun = 0;

    try {
      while (
        this.queue.length > 0 &&
        jobsRun < this.config.capPerTick &&
        performance.now() - start < this.config.budgetMs
      ) {
        const job = this.queue.shift();
        if (!job) break;

        this.keySet.delete(job.key);

        try {
          const result = job.run();
          // If async jobs are not allowed and job returns a promise, we ignore it
          if (this.config.allowAsync && result instanceof Promise) {
            // Don't await - fire and forget for async jobs
            result.catch((err) => {
              console.error('[JobQueue] Async job failed:', job.key, err);
            });
          }
        } catch (err) {
          console.error('[JobQueue] Job failed:', job.key, err);
        }

        jobsRun++;
      }
    } finally {
      this.processing = false;
    }

    return performance.now() - start;
  }

  /**
   * Process all jobs immediately (ignoring budget).
   * Use sparingly - this can block the main thread.
   */
  flush(): void {
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) break;

        this.keySet.delete(job.key);

        try {
          job.run();
        } catch (err) {
          console.error('[JobQueue] Job failed during flush:', job.key, err);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process all jobs asynchronously with yielding between batches.
   * Good for processing a large queue without blocking.
   */
  async flushAsync(batchSize = 5, delayMs = 8): Promise<void> {
    while (this.queue.length > 0) {
      let processed = 0;

      while (this.queue.length > 0 && processed < batchSize) {
        const job = this.queue.shift();
        if (!job) break;

        this.keySet.delete(job.key);

        try {
          const result = job.run();
          if (result instanceof Promise) {
            await result;
          }
        } catch (err) {
          console.error('[JobQueue] Job failed during async flush:', job.key, err);
        }

        processed++;
      }

      if (this.queue.length > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}

// Global job queue instance for general use
let globalQueue: JobQueue | null = null;

/**
 * Get the global job queue instance
 */
export function getGlobalJobQueue(): JobQueue {
  if (!globalQueue) {
    globalQueue = new JobQueue({
      enabled: true,
      budgetMs: 8,
      capPerTick: 10,
      allowAsync: true,
    });
  }
  return globalQueue;
}

/**
 * Start ticking the global job queue using requestAnimationFrame.
 * Returns a function to stop the ticker.
 */
export function startGlobalJobQueueTicker(): () => void {
  const queue = getGlobalJobQueue();
  let running = true;
  let frameId: number | null = null;

  const tick = () => {
    if (!running) return;
    
    queue.tick();
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return () => {
    running = false;
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
    }
  };
}







