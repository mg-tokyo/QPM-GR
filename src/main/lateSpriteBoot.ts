import {
  initSpriteSystem,
  probePixiPresence,
  reportSpriteV2InitFailed,
  reportSpriteV2InitRecovered,
  resetSpriteBootStateForRetry,
} from '../sprite-v2/index';
import type { SpriteService } from '../sprite-v2/types';
import { isGameStateReady, subscribe } from '../core/gameState';
import { onPixiCaptureChange } from '../core/pixiCapture';

// Retries a failed sprite boot whenever PIXI may have become reachable: a capture
// fill/replace or a quinoaEngine change. No time cap — a missed init hook
// (tri-2026-10-31-003) otherwise leaves the session without sprites until reload.
export function startLateSpriteBoot(apply: (service: SpriteService) => void): () => void {
  let done = false;
  let retrying = false;
  const unsubs: Array<() => void> = [];

  const dispose = (): void => {
    done = true;
    for (const unsub of unsubs.splice(0)) {
      try { unsub(); } catch { /* best effort */ }
    }
  };

  const attempt = (): void => {
    if (done || retrying || !probePixiPresence()) return;
    retrying = true;
    resetSpriteBootStateForRetry();
    initSpriteSystem()
      .then((service) => {
        if (done) return;
        dispose();
        apply(service);
        reportSpriteV2InitRecovered();
      })
      .catch((err: unknown) => {
        retrying = false;
        if (done) return;
        reportSpriteV2InitFailed(err);
      });
  };

  unsubs.push(onPixiCaptureChange(attempt));
  if (isGameStateReady()) unsubs.push(subscribe('quinoaEngine', attempt));
  attempt();
  return dispose;
}
