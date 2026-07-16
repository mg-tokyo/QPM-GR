import { storage } from '../../utils/storage';
import type { RiveRuleTarget } from '../../features/standalone/riveControl';
import { renderAvatarCards } from './avatarCards';
import { renderPetCards } from './petCards';
import { renderDecorCards } from './decorCards';

const TAB_KEY = 'qpm.riveControl.browserTab.v1';

type TabId = 'avatars' | 'pets' | 'decor';

export interface BrowserHandle {
  element: HTMLElement;
  refresh: () => void;
  cleanup: () => void;
}

export interface BrowserOptions {
  onPick: (target: RiveRuleTarget, label: string) => void;
}

export function renderBrowser(opts: BrowserOptions): BrowserHandle {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

  let activeTab: TabId = storage.get<TabId>(TAB_KEY, 'avatars') ?? 'avatars';
  const cleanups: Array<() => void> = [];

  const tabRow = document.createElement('div');
  tabRow.style.cssText = 'display:flex;gap:var(--qpm-space-1);padding:var(--qpm-space-2) var(--qpm-space-3);border-bottom:1px solid var(--qpm-divider,rgba(255,255,255,0.08));flex-shrink:0;';

  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;';

  const makeTabBtn = (id: TabId, label: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    const active = activeTab === id;
    btn.style.cssText = [
      'flex:1;padding:var(--qpm-space-2) var(--qpm-space-3);',
      'border-radius:var(--qpm-radius-sm);',
      `background:${active ? 'var(--qpm-accent-tint)' : 'transparent'};`,
      `color:${active ? 'var(--qpm-accent)' : 'var(--qpm-text-muted)'};`,
      'border:none;font-size:var(--qpm-font-body);',
      'font-weight:var(--qpm-weight-semibold);cursor:pointer;',
      'transition:background 0.15s ease,color 0.15s ease;font-family:var(--qpm-font);',
    ].join('');
    btn.addEventListener('click', () => {
      if (activeTab === id) return;
      activeTab = id;
      storage.set(TAB_KEY, id);
      renderTabs();
      renderBody();
    });
    return btn;
  };

  function renderTabs(): void {
    tabRow.innerHTML = '';
    tabRow.appendChild(makeTabBtn('avatars', 'Avatars'));
    tabRow.appendChild(makeTabBtn('pets', 'Pets'));
    tabRow.appendChild(makeTabBtn('decor', 'Decor'));
  }

  function renderBody(): void {
    // Tear down previous cleanups (previews own WASM handles).
    for (const fn of cleanups) {
      try { fn(); } catch { /* */ }
    }
    cleanups.length = 0;
    body.innerHTML = '';

    let inner: { element: HTMLElement; cleanup: () => void };
    if (activeTab === 'avatars') inner = renderAvatarCards({ onPick: opts.onPick });
    else if (activeTab === 'pets') inner = renderPetCards({ onPick: opts.onPick });
    else inner = renderDecorCards({ onPick: opts.onPick });

    body.appendChild(inner.element);
    cleanups.push(inner.cleanup);
  }

  renderTabs();
  renderBody();
  root.append(tabRow, body);

  return {
    element: root,
    refresh: () => { renderTabs(); renderBody(); },
    cleanup: () => {
      for (const fn of cleanups) {
        try { fn(); } catch { /* */ }
      }
      cleanups.length = 0;
    },
  };
}
