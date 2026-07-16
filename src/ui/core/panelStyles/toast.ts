export const TOAST_STYLE_ID = 'qpm-toast-style';

export const TOAST_MAIN_CSS = `.qpm-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: rgba(20, 26, 40, 0.92);
    border: 1px solid rgba(143, 130, 255, 0.35);
    color: var(--qpm-text);
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 12px;
    z-index: 2147483647;
    box-shadow: 0 10px 26px rgba(12, 16, 28, 0.55);
    animation: qpm-toast-in 0.25s ease;
  }

  @keyframes qpm-toast-in {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }`;

export function ensureToastStyle(): void {
  if (document.getElementById(TOAST_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TOAST_STYLE_ID;
  style.textContent = '@keyframes qpm-toast-in { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 0.95; } }';
  document.head.appendChild(style);
}
