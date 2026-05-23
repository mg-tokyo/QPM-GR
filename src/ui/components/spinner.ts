const SPINNER_STYLE_ID = 'qpm-spinner-keyframes';

function ensureSpinnerKeyframes(): void {
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SPINNER_STYLE_ID;
  style.textContent = '@keyframes qpm-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
  document.head.appendChild(style);
}

export function createSpinner(message?: string): HTMLElement {
  ensureSpinnerKeyframes();

  const container = document.createElement('div');
  container.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:8px;padding:16px;';

  const ring = document.createElement('div');
  ring.style.cssText =
    'width:24px;height:24px;' +
    'border:3px solid var(--qpm-accent-subtle);' +
    'border-top-color:var(--qpm-accent);' +
    'border-radius:50%;' +
    'animation:qpm-spin 0.8s linear infinite;' +
    'flex-shrink:0;';
  container.appendChild(ring);

  if (message) {
    const text = document.createElement('div');
    text.textContent = message;
    text.style.cssText =
      'font-size:var(--qpm-font-body);color:var(--qpm-text-muted);' +
      'font-family:var(--qpm-font);text-align:center;';
    container.appendChild(text);
  }

  return container;
}
