import type { ProbeLifecycleState } from './lifecycle';
import type { ProbeScanOptions, ProbeScanResult } from './types';

const WATCH_DEBOUNCE_MS = 140;
const WATCH_THROTTLE_MS = 320;
const WATCH_HEARTBEAT_MS = 800;
const WATCH_POINTER_DELTA_PX = 8;

export function startProbeWatch(
  state: ProbeLifecycleState,
  scan: (options?: ProbeScanOptions) => ProbeScanResult,
  options: ProbeScanOptions = {},
): { active: true } {
  if (state.watchCancel) state.watchCancel();

  let debounceTimer: number | null = null;
  let throttleTimer: number | null = null;
  let lastRunAt = 0;
  let lastPointerX = NaN;
  let lastPointerY = NaN;

  const run = (): void => {
    lastRunAt = Date.now();
    scan({ ...options, suppressConsole: true });
  };

  const schedule = (): void => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      const elapsed = Date.now() - lastRunAt;
      if (elapsed >= WATCH_THROTTLE_MS) {
        run();
        return;
      }
      if (throttleTimer !== null) return;
      throttleTimer = window.setTimeout(() => {
        throttleTimer = null;
        run();
      }, WATCH_THROTTLE_MS - elapsed);
    }, WATCH_DEBOUNCE_MS);
  };

  const observer = new MutationObserver(() => schedule());
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  const onResize = (): void => schedule();
  const onPointerMove = (event: PointerEvent): void => {
    if (Number.isFinite(lastPointerX) && Number.isFinite(lastPointerY)) {
      const distance = Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY);
      if (distance < WATCH_POINTER_DELTA_PX) return;
    }
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    schedule();
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  const heartbeat = window.setInterval(schedule, WATCH_HEARTBEAT_MS);
  run();

  state.watchCancel = () => {
    observer.disconnect();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointerMove);
    window.clearInterval(heartbeat);
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    if (throttleTimer !== null) window.clearTimeout(throttleTimer);
    debounceTimer = null;
    throttleTimer = null;
    state.watchCancel = null;
  };

  return { active: true };
}
