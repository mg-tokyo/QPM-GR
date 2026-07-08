import { pageWindow } from '../../core/pageContext';
import { log } from '../../utils/logger';
import { storage } from '../../utils/storage';
import { criticalInterval, visibleInterval } from '../../utils/scheduling/timerManager';

export interface AutoReconnectConfig {
  enabled: boolean;
  delayMs: number;
}

type AutoReconnectConfigPatch = Partial<AutoReconnectConfig>;
type ConfigListener = (config: AutoReconnectConfig) => void;

interface RoomConnectionLike {
  connect?: () => unknown;
  ws?: WebSocket | null;
  socket?: WebSocket | null;
  currentWebSocket?: WebSocket | null;
}

interface PageWithRoomConnection extends Window {
  MagicCircle_RoomConnection?: RoomConnectionLike;
}

type OverlayHandle = {
  update: (remainingMs: number) => void;
  destroy: () => void;
};

const AUTO_RECONNECT_ENABLED_KEY = 'qpm.autoReconnect.enabled.v1';
const AUTO_RECONNECT_DELAY_KEY = 'qpm.autoReconnect.delayMs.v1';

const DEFAULT_CONFIG: AutoReconnectConfig = {
  enabled: false,
  delayMs: 60_000,
};

const MIN_DELAY_MS = 0;
const MAX_DELAY_MS = 300_000;
const SOCKET_BIND_POLL_MS = 500;
const COUNTDOWN_TICK_MS = 1_000;
const CONNECT_RETRY_MAX = 5;
const CONNECT_RETRY_DELAY_MS = 400;

const OVERLAY_STYLE_ID = 'qpm-auto-reconnect-overlay-style';
const OVERLAY_ID = 'qpm-auto-reconnect-overlay';

let started = false;
let config: AutoReconnectConfig = loadConfig();
const listeners = new Set<ConfigListener>();

let activeSocket: WebSocket | null = null;
let socketPollStop: (() => void) | null = null;
let socketPollGeneration = 0;

let reconnectTimer: number | null = null;
let countdownStop: (() => void) | null = null;
let connectRetryTimer: number | null = null;
let overlay: OverlayHandle | null = null;
let versionReloadScheduled = false;

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return fallback;
}

function clampDelayMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CONFIG.delayMs;
  const floored = Math.floor(numeric);
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, floored));
}

function sanitizeConfig(value: AutoReconnectConfigPatch | null | undefined): AutoReconnectConfig {
  return {
    enabled: coerceBoolean(value?.enabled, DEFAULT_CONFIG.enabled),
    delayMs: clampDelayMs(value?.delayMs),
  };
}

function loadConfig(): AutoReconnectConfig {
  const rawEnabled = storage.get<unknown>(AUTO_RECONNECT_ENABLED_KEY, DEFAULT_CONFIG.enabled);
  const rawDelayMs = storage.get<unknown>(AUTO_RECONNECT_DELAY_KEY, DEFAULT_CONFIG.delayMs);
  return sanitizeConfig({
    enabled: coerceBoolean(rawEnabled, DEFAULT_CONFIG.enabled),
    delayMs: clampDelayMs(rawDelayMs),
  });
}

function saveConfig(next: AutoReconnectConfig): void {
  storage.set(AUTO_RECONNECT_ENABLED_KEY, next.enabled);
  storage.set(AUTO_RECONNECT_DELAY_KEY, next.delayMs);
}

function notifyConfigListeners(): void {
  const snapshot = { ...config };
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      log('[AutoReconnect] listener error', error);
    }
  }
}

function getRoomConnection(): RoomConnectionLike | null {
  return (pageWindow as PageWithRoomConnection).MagicCircle_RoomConnection ?? null;
}

function getRoomConnectionSocket(): WebSocket | null {
  const connection = getRoomConnection();
  if (!connection) return null;
  return connection.ws ?? connection.socket ?? connection.currentWebSocket ?? null;
}

function isSupersededSessionClose(event: CloseEvent): boolean {
  const reason = String(event?.reason ?? '');
  if (event?.code === 4300) {
    return !/heartbeat/i.test(reason);
  }
  if (event?.code !== 4250) {
    return false;
  }
  return (
    /supersed/i.test(reason)
    || /newer\s+session/i.test(reason)
    || /newer.*user.*session/i.test(reason)
    || /session.*newer/i.test(reason)
  );
}

function isVersionExpiredClose(event: CloseEvent): boolean {
  const reason = String(event?.reason ?? '');
  return event?.code === 4710 || /version\s*expired/i.test(reason);
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function shouldSkipVersionReload(): boolean {
  try {
    if (window.top !== window.self) return true;
  } catch {
    return true;
  }

  const refHost = safeHostname(document.referrer);
  if (refHost && /(^|\.)discord(app)?\.com$/i.test(refHost)) {
    return true;
  }

  return false;
}

function handleVersionExpiredClose(): void {
  if (versionReloadScheduled) return;
  if (shouldSkipVersionReload()) return;
  versionReloadScheduled = true;

  clearReconnectSchedule();

  try {
    log('[AutoReconnect] version expired, reloading page');
    pageWindow.location.reload();
  } catch {
    try {
      window.location.reload();
    } catch {}
  }
}

function ensureOverlayStyle(): void {
  if (document.getElementById(OVERLAY_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = OVERLAY_STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(8, 10, 18, 0.72);
      backdrop-filter: blur(8px);
      font-family: var(--qpm-font, 'Inter', 'Segoe UI', Arial, sans-serif);
    }
    #${OVERLAY_ID} .qpm-auto-reco-box {
      width: min(440px, calc(100vw - 28px));
      background: var(--qpm-surface-1, rgba(18, 21, 32, 0.96));
      border: 1px solid var(--qpm-border, rgba(120, 130, 170, 0.35));
      box-shadow: var(--qpm-shadow, 0 14px 32px rgba(15, 17, 28, 0.55));
      border-radius: 14px;
      padding: 22px 20px 18px;
      color: var(--qpm-text, #eef0ff);
      text-align: center;
    }
    #${OVERLAY_ID} .qpm-auto-reco-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.2px;
      color: var(--qpm-accent-strong, #b39cff);
      margin-bottom: 8px;
    }
    #${OVERLAY_ID} .qpm-auto-reco-subtitle {
      font-size: 13px;
      color: var(--qpm-text, #eef0ff);
      opacity: 0.9;
      line-height: 1.5;
      margin-bottom: 14px;
    }
    #${OVERLAY_ID} .qpm-auto-reco-btn {
      border: 1px solid rgba(143, 130, 255, 0.45);
      background: rgba(143, 130, 255, 0.18);
      color: var(--qpm-text, #eef0ff);
      border-radius: 999px;
      min-height: 44px;
      padding: 0 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.18s ease, border-color 0.18s ease;
    }
    #${OVERLAY_ID} .qpm-auto-reco-btn:hover {
      background: rgba(143, 130, 255, 0.28);
      border-color: rgba(143, 130, 255, 0.6);
    }
  `;
  document.documentElement.appendChild(style);
}

function destroyOverlayOnly(): void {
  if (!overlay) return;
  try {
    overlay.destroy();
  } catch {}
  overlay = null;
}

function clearCountdown(): void {
  if (countdownStop != null) {
    countdownStop();
    countdownStop = null;
  }
  destroyOverlayOnly();
}

function clearReconnectSchedule(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (connectRetryTimer != null) {
    clearTimeout(connectRetryTimer);
    connectRetryTimer = null;
  }
  clearCountdown();
}

function createOverlay(initialMs: number, onReconnectNow: () => void): OverlayHandle {
  ensureOverlayStyle();

  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = OVERLAY_ID;

  const box = document.createElement('div');
  box.className = 'qpm-auto-reco-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Auto reconnect status');

  const title = document.createElement('div');
  title.className = 'qpm-auto-reco-title';
  title.textContent = 'Auto reconnect';

  const subtitle = document.createElement('div');
  subtitle.className = 'qpm-auto-reco-subtitle';

  const reconnectNowBtn = document.createElement('button');
  reconnectNowBtn.className = 'qpm-auto-reco-btn';
  reconnectNowBtn.type = 'button';
  reconnectNowBtn.textContent = 'Reconnect now';
  reconnectNowBtn.addEventListener('click', (event) => {
    event.preventDefault();
    onReconnectNow();
  });

  const render = (remainingMs: number): void => {
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const unit = seconds === 1 ? 'second' : 'seconds';
    subtitle.textContent = `The game will reconnect in ${seconds} ${unit}...`;
  };

  box.append(title, subtitle, reconnectNowBtn);
  container.appendChild(box);
  document.documentElement.appendChild(container);
  render(initialMs);

  return {
    update: render,
    destroy: () => {
      container.remove();
    },
  };
}

/**
 * Try to click the game's native reconnect button.
 *
 * After a game update the disconnect screen renders a React overlay
 * ("Playing in another window" / "PLAY HERE INSTEAD") that manages its
 * own reconnect state.  Clicking the button uses the same code-path the
 * game uses, ensuring the overlay is dismissed and `connect()` is called
 * with the correct internal flags (e.g. `reclaimSupersededSession`).
 */
function tryClickGameReconnectButton(): boolean {
  try {
    const buttons = document.querySelectorAll<HTMLButtonElement>('button');
    for (const btn of buttons) {
      // Skip QPM's own overlay buttons
      if (btn.closest(`#${OVERLAY_ID}`)) continue;

      const text = (btn.textContent ?? '').trim().toLowerCase();
      if (text.includes('play here') || text === 'reconnect') {
        btn.click();
        log('[AutoReconnect] clicked game reconnect button');
        return true;
      }
    }
  } catch (error) {
    log('[AutoReconnect] game button click failed', error);
  }
  return false;
}

function tryConnect(attempt: number): void {
  if (!started) return;
  if (!config.enabled) {
    clearReconnectSchedule();
    return;
  }

  // Prefer the game's native reconnect button — it handles all internal
  // state (React overlay dismissal, reclaimSupersededSession flag, etc.).
  if (tryClickGameReconnectButton()) {
    return;
  }

  // Fallback: call connect() directly on the RoomConnection.
  const connection = getRoomConnection();
  const connect = connection?.connect;
  if (typeof connect === 'function') {
    try {
      connect.call(connection);
      log('[AutoReconnect] called connect() directly');
      return;
    } catch (error) {
      log('[AutoReconnect] reconnect call failed', error);
    }
  }

  if (attempt >= CONNECT_RETRY_MAX) {
    log('[AutoReconnect] reconnect unavailable after retries');
    return;
  }

  connectRetryTimer = window.setTimeout(() => {
    connectRetryTimer = null;
    tryConnect(attempt + 1);
  }, CONNECT_RETRY_DELAY_MS);
}

function runReconnect(): void {
  reconnectTimer = null;
  clearCountdown();
  tryConnect(0);
}

function scheduleReconnect(delayMs: number): void {
  clearReconnectSchedule();
  const safeDelayMs = clampDelayMs(delayMs);

  const triggerManualReconnect = (): void => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    runReconnect();
  };

  if (safeDelayMs > 0) {
    overlay = createOverlay(safeDelayMs, triggerManualReconnect);
    let remainingMs = safeDelayMs;
    countdownStop = criticalInterval('auto-reconnect-countdown', () => {
      remainingMs = Math.max(0, remainingMs - COUNTDOWN_TICK_MS);
      overlay?.update(remainingMs);
      if (remainingMs <= 0) {
        clearCountdown();
      }
    }, COUNTDOWN_TICK_MS);
  }

  reconnectTimer = window.setTimeout(() => {
    runReconnect();
  }, safeDelayMs);
}

function detachSocketListener(): void {
  if (!activeSocket) return;
  try {
    activeSocket.removeEventListener('close', handleSocketClose);
  } catch {}
  activeSocket = null;
}

function stopSocketPoll(): void {
  if (socketPollStop != null) {
    socketPollStop();
    socketPollStop = null;
  }
}

function ensureSocketPollRunning(): void {
  if (!started) return;
  if (activeSocket) return;
  if (socketPollStop != null) return;
  socketPollGeneration++;
  socketPollStop = visibleInterval(
    `auto-reconnect-socket-poll-v${socketPollGeneration}`,
    () => {
      bindSocketListenerIfNeeded();
    },
    SOCKET_BIND_POLL_MS
  );
}

function bindSocketListenerIfNeeded(): void {
  const socket = getRoomConnectionSocket();
  if (socket === activeSocket) {
    if (activeSocket) stopSocketPoll();
    return;
  }

  detachSocketListener();
  if (!socket) return;

  try {
    socket.addEventListener('close', handleSocketClose);
    activeSocket = socket;
    stopSocketPoll();
  } catch (error) {
    activeSocket = null;
    log('[AutoReconnect] failed to bind room socket close listener', error);
  }
}

function handleSocketClose(event: CloseEvent): void {
  if (!started) return;
  const priorActive = activeSocket;
  detachSocketListener();
  ensureSocketPollRunning();
  if (isVersionExpiredClose(event)) {
    handleVersionExpiredClose();
    return;
  }
  if (!isSupersededSessionClose(event)) return;

  const latestConfig = loadConfig();
  if (latestConfig.enabled !== config.enabled || latestConfig.delayMs !== config.delayMs) {
    config = latestConfig;
    notifyConfigListeners();
  }
  if (!latestConfig.enabled) return;

  const roomSocket = getRoomConnectionSocket();
  if (roomSocket && priorActive && roomSocket !== priorActive) {
    return;
  }

  scheduleReconnect(latestConfig.delayMs);
}

export function initializeAutoReconnect(): void {
  if (started) return;
  started = true;
  versionReloadScheduled = false;
  config = loadConfig();

  bindSocketListenerIfNeeded();
  ensureSocketPollRunning();

  log('[AutoReconnect] initialized');
}

export function stopAutoReconnect(): void {
  if (!started) return;
  started = false;
  versionReloadScheduled = false;

  stopSocketPoll();
  clearReconnectSchedule();
  detachSocketListener();
  log('[AutoReconnect] stopped');
}

export function getAutoReconnectConfig(): AutoReconnectConfig {
  return { ...config };
}

export function updateAutoReconnectConfig(patch: AutoReconnectConfigPatch): AutoReconnectConfig {
  const next = sanitizeConfig({
    enabled: patch.enabled ?? config.enabled,
    delayMs: patch.delayMs ?? config.delayMs,
  });
  const prev = config;
  config = next;
  saveConfig(config);

  if (!config.enabled) {
    clearReconnectSchedule();
  } else if (reconnectTimer != null && prev.delayMs !== config.delayMs) {
    scheduleReconnect(config.delayMs);
  }

  notifyConfigListeners();
  return getAutoReconnectConfig();
}

export function subscribeToAutoReconnectConfig(listener: ConfigListener): () => void {
  listeners.add(listener);
  try {
    listener(getAutoReconnectConfig());
  } catch (error) {
    log('[AutoReconnect] listener error', error);
  }
  return () => {
    listeners.delete(listener);
  };
}
