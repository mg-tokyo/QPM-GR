import { ensureToastStyle } from '../core/panelStyles';
import { createButton } from './button';

/** A button under the message: a click closes the toast, then runs onClick once. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  variant?: 'success' | 'error' | 'info';
  duration?: number;
  /** Stay until `close()`, the action, or a newer toast; `duration` is ignored. */
  persist?: boolean;
  /** Wrap long text at this width (px); unset = no limit (callers before 2026-10-04 rely on that). */
  maxWidth?: number;
  action?: ToastAction;
}

export interface ToastHandle {
  setMessage(message: string): void;
  /** Removes the toast now; safe to call twice or after it faded. */
  close(): void;
  /** False once closed, faded out, closed by its action, or replaced by a newer toast. */
  isOpen(): boolean;
}

const VARIANT_BORDER: Record<string, string> = {
  success: 'border-color:var(--qpm-positive);',
  error: 'border-color:var(--qpm-danger);',
  info: 'border-color:var(--qpm-accent);',
};

const FADE_MS = 300;

export function showToast(message: string, options: ToastOptions = {}): ToastHandle {
  const { variant = 'info', duration = 2500, persist = false, maxWidth, action } = options;

  ensureToastStyle();

  const existing = document.querySelector('.qpm-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'qpm-toast';
  const text = document.createTextNode(message);
  toast.appendChild(text);

  let closed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const close = (): void => {
    closed = true;
    for (const id of timers) clearTimeout(id);
    timers.length = 0;
    toast.remove();
  };

  const borderStyle = VARIANT_BORDER[variant] ?? VARIANT_BORDER.info;
  toast.style.cssText +=
    `${borderStyle}font-family:var(--qpm-font);`;
  if (maxWidth !== undefined) toast.style.maxWidth = `${maxWidth}px`;
  if (action) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;margin-top:8px;';
    row.appendChild(createButton(action.label, {
      variant: 'primary',
      size: 'sm',
      onClick: () => {
        if (closed || !toast.isConnected) return;
        close();
        action.onClick();
      },
    }));
    toast.appendChild(row);
  }

  document.body.appendChild(toast);

  if (!persist) {
    timers.push(setTimeout(() => {
      closed = true;
      toast.style.transition = 'opacity 0.3s ease';
      toast.style.opacity = '0';
      timers.push(setTimeout(() => { toast.remove(); }, FADE_MS));
    }, duration));
  }

  return {
    setMessage: (next) => { text.data = next; },
    close,
    isOpen: () => !closed && toast.isConnected,
  };
}
