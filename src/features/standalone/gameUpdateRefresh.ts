import { subscribe } from '../../core/gameState';
import { pageWindow } from '../../core/pageContext';
import { getPixiRefs } from '../../core/pixiCapture';
import { findByLabel } from '../../core/pixiScene';
import { createNamedLogger } from '../../diagnostics/logger';
import { t } from '../../i18n';
import { detectGameVersion } from '../../sprite-v2/detector';
import { showToast, type ToastHandle } from '../../ui/components';
import { isDiscordSurface } from '../../utils/environment';
import { storage } from '../../utils/storage';

// Close code the game writes to permanentlyDisconnectedReasonAtom when the client build is stale
// (numeric TS enum `VersionExpired=4710`, live 1973; spec F7).
const VERSION_EXPIRED = 4710;
// The game's notice button; its own `onTap` field runs the notice's command (spec F8, F9).
const NOTICE_ACTION_LABEL = 'SessionNotice:action';
const COUNTDOWN_S = 5;
const GUARD_WINDOW_MS = 10 * 60_000;

// v2: the public `qpm.autoReconnect.enabled.v1` shipped force-disabled and may still hold a stale `false`.
export const GAME_UPDATE_REFRESH_ENABLED_KEY = 'qpm.autoReconnect.enabled.v2';
export const GAME_UPDATE_REFRESH_GUARD_KEY = 'qpm.autoReconnect.guard.v1';

interface Guard { build: string; at: number }
export type RefreshDecision = 'off' | 'discord' | 'guarded' | 'countdown';

const log = createNamedLogger('gameUpdateRefresh');

let unsubscribe: (() => void) | null = null;
let handledThisPage = false;
let countdown: { timer: ReturnType<typeof setTimeout> | null; toast: ToastHandle | null; cancelled: boolean } | null = null;
const settingListeners = new Set<(enabled: boolean) => void>();

export function isGameUpdateRefreshEnabled(): boolean {
  return storage.get<boolean>(GAME_UPDATE_REFRESH_ENABLED_KEY, true) !== false;
}

export function setGameUpdateRefreshEnabled(enabled: boolean): void {
  storage.set(GAME_UPDATE_REFRESH_ENABLED_KEY, enabled);
  for (const cb of [...settingListeners]) {
    try { cb(enabled); } catch { /* isolate listeners */ }
  }
}

export function onGameUpdateRefreshSettingChange(cb: (enabled: boolean) => void): () => void {
  settingListeners.add(cb);
  return () => { settingListeners.delete(cb); };
}

function currentBuild(): string {
  try { return detectGameVersion(); } catch { return 'unknown'; }
}

function readGuard(): Guard | null {
  const raw = storage.get<unknown>(GAME_UPDATE_REFRESH_GUARD_KEY, null);
  if (!raw || typeof raw !== 'object') return null;
  const { build, at } = raw as Record<string, unknown>;
  return typeof build === 'string' && typeof at === 'number' ? { build, at } : null;
}

export function decideRefresh(input: { enabled: boolean; discord: boolean; guard: Guard | null; build: string; now: number }): RefreshDecision {
  if (!input.enabled) return 'off';
  if (input.discord) return 'discord';
  const { guard } = input;
  if (guard && guard.build === input.build && input.now - guard.at >= 0 && input.now - guard.at < GUARD_WINDOW_MS) return 'guarded';
  return 'countdown';
}

function pressGameButton(): 'button' | 'reload' {
  const stage = getPixiRefs()?.stage ?? null;
  const button = stage ? findByLabel(stage, NOTICE_ACTION_LABEL) : null;
  const onTap = button?.onTap;
  if (typeof onTap === 'function') {
    (onTap as (this: unknown) => void).call(button);
    return 'button';
  }
  pageWindow.location.reload();
  return 'reload';
}

function endCountdown(): void {
  if (!countdown) return;
  countdown.cancelled = true;
  if (countdown.timer !== null) clearTimeout(countdown.timer);
  countdown.toast?.close();
  countdown = null;
}

function showCountdownToast(seconds: number): ToastHandle {
  return showToast(t('feature.autoReconnect.countdown', { seconds }), {
    variant: 'info',
    persist: true,
    action: {
      label: t('feature.autoReconnect.cancel'),
      onClick: () => {
        log.info('Auto-refresh cancelled by the player');
        endCountdown();
      },
    },
  });
}

function runCountdown(build: string): void {
  const state: NonNullable<typeof countdown> = { timer: null, toast: null, cancelled: false };
  countdown = state;
  const tick = (remaining: number): void => {
    if (state.cancelled) return;
    if (remaining <= 0) {
      state.toast?.close();
      countdown = null;
      storage.set(GAME_UPDATE_REFRESH_GUARD_KEY, { build, at: Date.now() } satisfies Guard);
      log.info('Game update: refreshing', { build, via: pressGameButton() });
      return;
    }
    // A newer toast replaces ours; show the countdown again so Cancel stays reachable.
    if (state.toast?.isOpen()) state.toast.setMessage(t('feature.autoReconnect.countdown', { seconds: remaining }));
    else state.toast = showCountdownToast(remaining);
    state.timer = setTimeout(() => { tick(remaining - 1); }, 1000);
  };
  tick(COUNTDOWN_S);
}

function onReason(reason: number | null): void {
  if (reason !== VERSION_EXPIRED) {
    endCountdown();
    return;
  }
  if (handledThisPage) return;
  handledThisPage = true;
  const build = currentBuild();
  const decision = decideRefresh({
    enabled: isGameUpdateRefreshEnabled(),
    discord: isDiscordSurface,
    guard: readGuard(),
    build,
    now: Date.now(),
  });
  if (decision === 'countdown') runCountdown(build);
  else log.info('Game update: no auto-refresh', { decision, build });
}

export function startGameUpdateRefresh(): void {
  if (unsubscribe) return;
  unsubscribe = subscribe('permanentlyDisconnectedReason', onReason);
}

export function stopGameUpdateRefresh(): void {
  endCountdown();
  unsubscribe?.();
  unsubscribe = null;
  handledThisPage = false;
}
