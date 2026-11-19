// What the open/close and reset keys of a floating-panel family (storages, shops) run. Nothing here listens or
// wraps: the keybind dispatcher calls in only when a key is bound, and a session hooks the game only while open.
import { showToast } from '../../ui/components';

export type PanelToggleResult =
  | { ok: true; closed?: true }
  | { ok: false; reason: string; missing?: readonly string[] };

export interface PanelControlDeps {
  toggle(): Promise<PanelToggleResult>;
  close(): Promise<unknown>;
  dispose(): Promise<void>;
  reset(): unknown;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  /** The open's reason when nothing is there to open (no storages owned, no picked shop open). */
  emptyReason: string;
  emptyText(): string;
  unavailableText(): string;
  layoutResetText(): string;
  /** A missing handle that only means the game is still loading: told on every press, not as a changed game. */
  notReady?: { missing: string; text(): string };
}

export interface PanelControl {
  start(): void;
  stop(): void;
  toggleFromKey(): Promise<void>;
  /** The settings card's switch: off also closes open panels, the way Escape would. */
  setEnabled(enabled: boolean): void;
  resetFromKey(): void;
}

export function createPanelControl(deps: PanelControlDeps): PanelControl {
  let started = false;
  let toldUnavailable = false;
  const isLive = (): boolean => started && deps.isEnabled();
  const isNotReady = (missing: readonly string[] | undefined): boolean =>
    deps.notReady !== undefined && missing?.length === 1 && missing[0] === deps.notReady.missing;

  return {
    start() {
      started = true;
      toldUnavailable = false;
    },
    stop() {
      if (!started) return;
      started = false;
      void deps.dispose();
    },
    async toggleFromKey() {
      if (!isLive()) return;
      const result = await deps.toggle();
      if (result.ok) {
        if (result.closed) return;
        toldUnavailable = false;
        // Stopped while the open was in flight: nothing may stay open after stop.
        if (!started) void deps.close();
        return;
      }
      if (result.reason === deps.emptyReason) {
        showToast(deps.emptyText());
      } else if (result.reason === 'unavailable' && deps.notReady && isNotReady(result.missing)) {
        showToast(deps.notReady.text());
      } else if ((result.reason === 'unavailable' || result.reason === 'failed') && !toldUnavailable) {
        // Once until the next good open: the diagnostics code carries the detail.
        toldUnavailable = true;
        showToast(deps.unavailableText(), { variant: 'error' });
      }
    },
    setEnabled(enabled) {
      deps.setEnabled(enabled);
      if (!enabled) void deps.close();
    },
    resetFromKey() {
      if (!isLive()) return;
      deps.reset();
      showToast(deps.layoutResetText(), { variant: 'success' });
    },
  };
}
