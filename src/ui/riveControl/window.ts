import { registerLazyWindow } from '../core/lazyWindow';
import { createButton } from '../components/button';
import { watchDetach } from '../../utils/dom/dom';
import type { RiveRuleTarget } from '../../features/standalone/riveControl';
import { renderBrowser } from './browser';
import { renderRulesList } from './rulesList';
import { renderRiveEditor } from './editorPanel';

export const RIVE_CONTROL_WINDOW_ID = 'rive-control';

type View = 'list' | 'browser' | 'editor';

export function registerRiveControlWindow(): () => Promise<boolean> {
  return registerLazyWindow(
    RIVE_CONTROL_WINDOW_ID,
    'Rive Control (dev)',
    async () => (root) => renderShell(root),
    '560px',
    'min(780px, calc(100vh - 32px))',
  );
}

function renderShell(root: HTMLElement): () => void {
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;position:relative;overflow:hidden;';
  const cleanups: Array<() => void> = [];

  if (!document.getElementById('qpm-shimmer-style')) {
    const style = document.createElement('style');
    style.id = 'qpm-shimmer-style';
    style.textContent = '@keyframes qpm-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
    document.head.appendChild(style);
    cleanups.push(() => style.remove());
  }

  // Layout: header row (breadcrumbs) + scrollable body + footer.
  const headerBar = document.createElement('div');
  headerBar.style.cssText = 'display:flex;align-items:center;gap:var(--qpm-space-2);padding:var(--qpm-space-3) var(--qpm-space-4);border-bottom:1px solid var(--qpm-divider,rgba(255,255,255,0.08));flex-shrink:0;';
  root.appendChild(headerBar);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:var(--qpm-space-4);gap:var(--qpm-space-3);font-family:var(--qpm-font);color:var(--qpm-text);';
  root.appendChild(body);

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:var(--qpm-space-2) var(--qpm-space-4);border-top:1px solid var(--qpm-accent-tint,rgba(143,130,255,0.15));display:flex;align-items:center;gap:var(--qpm-space-2);flex-shrink:0;';
  root.appendChild(footer);

  const info = document.createElement('div');
  info.style.cssText = 'font-size:var(--qpm-font-xs);color:var(--qpm-text-muted);flex:1;';
  info.textContent = 'Client-side visual only';
  footer.appendChild(info);

  let currentView: View = 'list';
  let viewCleanup: (() => void) | null = null;
  let currentTarget: { target: RiveRuleTarget; label: string } | null = null;

  const openEditor = (target: RiveRuleTarget, label: string): void => {
    currentTarget = { target, label };
    setView('editor');
  };

  function setView(next: View): void {
    currentView = next;
    render();
  }

  function render(): void {
    try { viewCleanup?.(); } catch { /* */ }
    viewCleanup = null;
    body.innerHTML = '';
    headerBar.innerHTML = '';

    if (currentView === 'list') renderListView();
    else if (currentView === 'browser') renderBrowserView();
    else if (currentView === 'editor') renderEditorView();
  }

  function renderListView(): void {
    // Header: title + subtitle
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1;';
    const title = document.createElement('div');
    title.textContent = 'Rive Control';
    title.style.cssText = 'font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-semibold);color:var(--qpm-accent);';
    const sub = document.createElement('div');
    sub.textContent = 'Persistent animation control over pets, avatars, and Rive decor.';
    sub.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
    titleWrap.append(title, sub);
    headerBar.appendChild(titleWrap);

    const browseBtn = createButton('Browse targets', {
      variant: 'primary',
      size: 'sm',
      onClick: () => setView('browser'),
    });
    headerBar.appendChild(browseBtn);

    // Body: hint + rules list
    const hint = document.createElement('div');
    hint.style.cssText = 'display:flex;align-items:center;gap:var(--qpm-space-2);padding:var(--qpm-space-3);background:var(--qpm-accent-subtle);border:1px dashed var(--qpm-accent-border);border-radius:var(--qpm-radius-md);font-size:var(--qpm-font-caption);';
    const hintText = document.createElement('div');
    hintText.style.cssText = 'flex:1;color:var(--qpm-text);';
    hintText.textContent = 'Click "Browse targets" to see live avatars, pets, and decor as sprite cards.';
    hint.appendChild(hintText);
    body.appendChild(hint);

    const list = renderRulesList({ onPick: openEditor });
    body.appendChild(list.element);
    viewCleanup = list.cleanup;
  }

  function renderBrowserView(): void {
    // Header: back + title
    const back = createButton('← Rules', {
      variant: 'ghost',
      size: 'sm',
      onClick: () => setView('list'),
    });
    headerBar.appendChild(back);
    const title = document.createElement('div');
    title.textContent = 'Browse targets';
    title.style.cssText = 'flex:1;font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-semibold);';
    headerBar.appendChild(title);

    const browser = renderBrowser({ onPick: openEditor });
    body.appendChild(browser.element);
    viewCleanup = browser.cleanup;
  }

  function renderEditorView(): void {
    if (!currentTarget) { setView('list'); return; }
    const editor = renderRiveEditor({
      target: currentTarget.target,
      targetLabel: currentTarget.label,
      onBack: () => setView('browser'),
    });
    body.appendChild(editor.element);
    viewCleanup = editor.cleanup;
  }

  render();

  watchDetach(root, () => {
    try { viewCleanup?.(); } catch { /* */ }
    for (const fn of cleanups) {
      try { fn(); } catch { /* */ }
    }
  });

  return () => {
    try { viewCleanup?.(); } catch { /* */ }
    for (const fn of cleanups) {
      try { fn(); } catch { /* */ }
    }
  };
}
