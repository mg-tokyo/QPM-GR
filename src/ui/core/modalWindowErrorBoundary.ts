// src/ui/core/modalWindowErrorBoundary.ts
//
// Structured error UI painted into a modal window's body when render() throws.
// Companion to the try/catch in modalWindow.ts:openWindow(). Self-contained —
// no dependencies on other UI modules, design tokens, or i18n — so a failure
// in the surrounding UI cannot also break this boundary.
//
// §13 Phase 5 item 1 — "render failures show a structured error UI inside the
// window (with code + Copy button) instead of leaving the window blank."

const ERROR_CODE = 'QPM-UI-001';

const PALETTE = {
  fg: '#f44336',
  border: 'rgba(244, 67, 54, 0.55)',
  bg: 'rgba(244, 67, 54, 0.08)',
  text: '#e0e0e0',
  textMuted: 'rgba(224, 224, 224, 0.65)',
  accentBorder: 'rgba(143, 130, 255, 0.5)',
  accentSubtle: 'rgba(143, 130, 255, 0.18)',
  surfaceDeep: 'rgba(0, 0, 0, 0.32)',
};

interface ErrorDetail {
  message: string;
  stack?: string;
  name?: string;
}

function describeError(err: unknown): ErrorDetail {
  if (err instanceof Error) {
    return {
      message: err.message || err.name || 'Error',
      ...(err.stack === undefined ? {} : { stack: err.stack }),
      name: err.name,
    };
  }
  if (typeof err === 'string') return { message: err };
  if (err === null) return { message: '(null)' };
  if (err === undefined) return { message: '(undefined)' };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

function buildErrorClipboardText(windowId: string, err: unknown): string {
  const d = describeError(err);
  const ts = new Date().toISOString();
  const lines = [
    `${ERROR_CODE}  Window render failed`,
    `Window:    ${windowId}`,
    `Timestamp: ${ts}`,
  ];
  if (d.name && d.name !== 'Error') lines.push(`Type:      ${d.name}`);
  lines.push(`Message:   ${d.message}`);
  if (d.stack) {
    lines.push('Stack:');
    lines.push(d.stack);
  }
  return lines.join('\n');
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to textarea fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Replace `body`'s contents with a structured error card describing a render
 * failure. Idempotent — calling twice produces the same final state.
 *
 * `body` must be the window's content host (the `<div class="qpm-window-body">`
 * managed by modalWindow.ts). Any partially-rendered children are cleared.
 */
export function renderWindowRenderError(
  body: HTMLElement,
  windowId: string,
  err: unknown,
): void {
  // Wipe any half-painted children from the throwing render(). Leaving them
  // interleaved with the error UI would make it harder to spot what failed.
  body.innerHTML = '';

  const detail = describeError(err);

  const container = document.createElement('div');
  container.className = 'qpm-window-error-boundary';
  container.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:12px',
    'padding:16px',
    'margin:0',
    'border-radius:8px',
    `background:${PALETTE.bg}`,
    `border:1px solid ${PALETTE.border}`,
    `color:${PALETTE.text}`,
    'font-size:13px',
    'line-height:1.5',
    'min-height:0',
    'flex:1',
    'overflow:auto',
    'box-sizing:border-box',
  ].join(';');

  // Heading row: title + code badge
  const headRow = document.createElement('div');
  headRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

  const heading = document.createElement('div');
  heading.style.cssText = `font-size:14px;font-weight:600;color:${PALETTE.fg};`;
  heading.textContent = 'This window failed to render';

  const badge = document.createElement('span');
  badge.style.cssText = [
    'padding:2px 8px',
    'border-radius:9999px',
    'background:rgba(244,67,54,0.18)',
    `color:${PALETTE.fg}`,
    `border:1px solid ${PALETTE.border}`,
    'font-size:11px',
    'font-weight:600',
    'letter-spacing:0.3px',
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
  ].join(';');
  badge.textContent = ERROR_CODE;

  headRow.append(heading, badge);

  const idLine = document.createElement('div');
  idLine.style.cssText = `font-size:11px;color:${PALETTE.textMuted};`;
  idLine.textContent = `Window ID: ${windowId}`;

  const message = document.createElement('div');
  message.style.cssText = `font-size:12px;color:${PALETTE.text};word-break:break-word;`;
  message.textContent = detail.message;

  let stackEl: HTMLElement | null = null;
  if (detail.stack) {
    stackEl = document.createElement('pre');
    stackEl.style.cssText = [
      'margin:0',
      `background:${PALETTE.surfaceDeep}`,
      `border:1px solid ${PALETTE.accentBorder}`,
      'border-radius:6px',
      'padding:10px 12px',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
      'font-size:11px',
      `color:${PALETTE.textMuted}`,
      'white-space:pre-wrap',
      'word-break:break-word',
      'max-height:240px',
      'overflow:auto',
    ].join(';');
    stackEl.textContent = detail.stack;
  }

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy error details';
  copyBtn.style.cssText = [
    `background:${PALETTE.accentSubtle}`,
    `border:1px solid ${PALETTE.accentBorder}`,
    `color:${PALETTE.text}`,
    'border-radius:6px',
    'padding:6px 12px',
    'font-size:12px',
    'font-weight:600',
    'cursor:pointer',
  ].join(';');

  const status = document.createElement('span');
  status.style.cssText = `font-size:11px;color:${PALETTE.textMuted};min-height:14px;`;

  copyBtn.addEventListener('click', async () => {
    copyBtn.disabled = true;
    status.textContent = 'Copying…';
    const ok = await copyToClipboard(buildErrorClipboardText(windowId, err));
    if (ok) {
      status.textContent = 'Copied to clipboard.';
      window.setTimeout(() => {
        status.textContent = '';
        copyBtn.disabled = false;
      }, 1400);
    } else {
      status.textContent = 'Clipboard write failed.';
      copyBtn.disabled = false;
    }
  });

  actions.append(copyBtn, status);

  const pointer = document.createElement('div');
  pointer.style.cssText = `font-size:11px;color:${PALETTE.textMuted};`;
  pointer.textContent =
    'This failure has been logged. Open the Diagnostics window from the panel’s Config tab for the full report.';

  container.append(headRow, idLine, message);
  if (stackEl) container.append(stackEl);
  container.append(actions, pointer);

  body.appendChild(container);
}
