// src/diagnostics/healthBus.ts — Bus + hysteresis state machine (§7)

import { writeInfrastructureError, writeInfrastructureWarn } from './consoleSink';
import type {
  AggregateStatus,
  QpmError,
  Subsystem,
  SubsystemCategory,
  SubsystemHealth,
  SubsystemStatus,
} from './types';

type Subscriber = (h: SubsystemHealth) => void;

interface PublishInput {
  subsystem: Subsystem;
  category?: SubsystemCategory;
  status?: SubsystemStatus;
  message?: string;
  lastError?: QpmError;
  metrics?: Readonly<Record<string, number | string>>;
}

interface RegisterOptions {
  category: SubsystemCategory;
  status?: SubsystemStatus;
  message?: string;
}

/** Default hysteresis window — recovering → ok unless interrupted (§7.2). */
const HYSTERESIS_MS = 3000;

const entries = new Map<Subsystem, SubsystemHealth>();
const hysteresisTimers = new Map<Subsystem, ReturnType<typeof setTimeout>>();
const subscribers = new Set<Subscriber>();

function emit(h: SubsystemHealth): void {
  for (const cb of subscribers) {
    try {
      cb(h);
    } catch (err) {
      // Subscriber exceptions cannot break the bus (§7.3).
      writeInfrastructureError('healthBus', 'subscriber threw', err);
    }
  }
}

function clearHysteresisTimer(subsystem: Subsystem): void {
  const t = hysteresisTimers.get(subsystem);
  if (t !== undefined) {
    clearTimeout(t);
    hysteresisTimers.delete(subsystem);
  }
}

function scheduleHysteresisTimer(subsystem: Subsystem): void {
  clearHysteresisTimer(subsystem);
  const t = setTimeout(() => {
    hysteresisTimers.delete(subsystem);
    const current = entries.get(subsystem);
    if (!current || current.status !== 'recovering') return;
    const next: SubsystemHealth = {
      ...current,
      status: 'ok',
      lastUpdate: Date.now(),
    };
    entries.set(subsystem, next);
    emit(next);
  }, HYSTERESIS_MS);
  hysteresisTimers.set(subsystem, t);
}

function differs(a: SubsystemHealth, b: SubsystemHealth): boolean {
  if (a.status !== b.status) return true;
  if (a.message !== b.message) return true;
  if (a.category !== b.category) return true;
  if (a.lastError !== b.lastError) return true;
  if (a.metrics !== b.metrics) return true;
  return false;
}

export const healthBus = {
  register(subsystem: Subsystem, opts: RegisterOptions): void {
    const existing = entries.get(subsystem);
    const next: SubsystemHealth = existing
      ? { ...existing, category: opts.category }
      : {
          subsystem,
          category: opts.category,
          status: opts.status ?? 'starting',
          ...(opts.message === undefined ? {} : { message: opts.message }),
          lastUpdate: Date.now(),
        };
    entries.set(subsystem, next);
    emit(next);
  },

  publish(input: PublishInput): void {
    const existing = entries.get(input.subsystem);
    if (!existing && !input.category) {
      // Cannot create a new entry without a category — drop silently.
      // Callers should register() first; this is a guard against the bus
      // being seeded by a stray logger call before init completes.
      return;
    }

    const requestedStatus = input.status ?? existing?.status ?? 'ok';

    // §7.2 — subsystems must not publish 'ok' directly out of degraded/failed.
    // The bus owns that transition via the hysteresis machine. If we see it,
    // we coerce to 'recovering' so the UI does not flash green.
    let coercedStatus: SubsystemStatus = requestedStatus;
    if (
      requestedStatus === 'ok' &&
      existing &&
      (existing.status === 'degraded' || existing.status === 'failed')
    ) {
      coercedStatus = 'recovering';
      writeInfrastructureWarn(
        'healthBus',
        `${input.subsystem} published 'ok' directly from '${existing.status}'. ` +
          `Coerced to 'recovering' — let the bus drive the transition.`,
      );
    }

    // Cancel any in-flight hysteresis timer on degraded/failed (§7.2 row 3).
    if (coercedStatus === 'degraded' || coercedStatus === 'failed') {
      clearHysteresisTimer(input.subsystem);
    }

    const next: SubsystemHealth = {
      subsystem: input.subsystem,
      category: input.category ?? existing!.category,
      status: coercedStatus,
      ...(input.message !== undefined
        ? { message: input.message }
        : existing?.message !== undefined
          ? { message: existing.message }
          : {}),
      ...(input.lastError !== undefined
        ? { lastError: input.lastError }
        : existing?.lastError !== undefined
          ? { lastError: existing.lastError }
          : {}),
      ...(input.metrics !== undefined
        ? { metrics: input.metrics }
        : existing?.metrics !== undefined
          ? { metrics: existing.metrics }
          : {}),
      lastUpdate: Date.now(),
    };

    if (existing && !differs(existing, next)) return;
    entries.set(input.subsystem, next);

    if (coercedStatus === 'recovering') {
      scheduleHysteresisTimer(input.subsystem);
    }

    emit(next);
  },

  read(subsystem: Subsystem): SubsystemHealth | undefined {
    return entries.get(subsystem);
  },

  readAll(): readonly SubsystemHealth[] {
    return Array.from(entries.values());
  },

  subscribe(cb: Subscriber): () => void {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  },

  aggregate(): AggregateStatus {
    let degraded = false;
    for (const h of entries.values()) {
      if (h.status === 'failed') return 'failed';
      if (h.status === 'degraded' || h.status === 'recovering') degraded = true;
    }
    return degraded ? 'degraded' : 'ok';
  },

  /** Tear down all timers — called on beforeunload to keep things tidy. */
  teardown(): void {
    for (const t of hysteresisTimers.values()) clearTimeout(t);
    hysteresisTimers.clear();
  },
};

export type HealthBus = typeof healthBus;
