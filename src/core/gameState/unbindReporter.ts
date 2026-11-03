// QPM-ATOM-001 gate for keys that drop to unbound. A rejoin Welcome after the
// server released the seat carries all-empty userSlots and a patch seats the
// player ~250 ms later (live 2026-11-02, game 1847), unbinding every {myIdx}
// key at once. Unbinds while seatless are held for a grace window; only keys
// still unbound after it, outside spectating, are reported.

const DEFAULT_GRACE_MS = 10_000;

export interface UnbindReporterDeps {
  hasSeat: () => boolean;
  isSpectating: () => boolean;
  warn: (context: { key: string; from: string; seatlessMs?: number }) => void;
  graceMs?: number;
  now?: () => number;
}

export interface UnbindReporter {
  onUnbind(key: string, from: string): void;
  onBound(key: string): void;
  held(): string[];
  dispose(): void;
}

export function createUnbindReporter(deps: UnbindReporterDeps): UnbindReporter {
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const now = deps.now ?? Date.now;
  const held = new Map<string, { from: string; at: number }>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  const expire = (): void => {
    timer = null;
    if (held.size === 0) return;
    const entries = [...held];
    held.clear();
    if (deps.isSpectating()) return;
    const t = now();
    for (const [key, h] of entries) deps.warn({ key, from: h.from, seatlessMs: t - h.at });
  };

  return {
    onUnbind(key, from) {
      if (deps.hasSeat()) { deps.warn({ key, from }); return; }
      if (!held.has(key)) held.set(key, { from, at: now() });
      if (timer === null) timer = setTimeout(expire, graceMs);
    },
    onBound(key) {
      if (!held.delete(key)) return;
      if (held.size === 0) clearTimer();
    },
    held: () => [...held.keys()],
    dispose() {
      clearTimer();
      held.clear();
    },
  };
}
