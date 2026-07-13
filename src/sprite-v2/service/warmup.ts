export type SpriteWarmupState = { total: number; done: number; completed: boolean; phase: string };

const warmupState: SpriteWarmupState = { total: 0, done: 0, completed: false, phase: 'idle' };
const warmupListeners = new Set<(state: SpriteWarmupState) => void>();

export function notifyWarmup(update: Partial<SpriteWarmupState>): void {
  Object.assign(warmupState, update);
  for (const listener of warmupListeners) {
    try {
      listener(warmupState);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function getSpriteWarmupState(): SpriteWarmupState {
  return { ...warmupState };
}

export function onSpriteWarmupProgress(listener: (state: SpriteWarmupState) => void): () => void {
  warmupListeners.add(listener);
  try {
    listener(warmupState);
  } catch {
    /* ignore */
  }
  return () => {
    warmupListeners.delete(listener);
  };
}
