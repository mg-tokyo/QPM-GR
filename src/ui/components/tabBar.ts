import { storage } from '../../utils/storage';

export interface TabDef {
  id: string;
  label: string;
  badge?: number | string;
}

export interface TabBarOptions {
  persistKey?: string;
  onChange?: (tabId: string) => void;
  defaultTab?: string;
}

interface TabBarResult {
  root: HTMLElement;
  setActive: (id: string) => void;
  getActive: () => string;
  setBadge: (id: string, value: number | string) => void;
}

export function createTabBar(tabs: TabDef[], options: TabBarOptions = {}): TabBarResult {
  const { persistKey, onChange, defaultTab } = options;

  const buttonMap = new Map<string, HTMLButtonElement>();
  const badgeMap = new Map<string, HTMLElement>();

  let persisted: string | null = null;
  if (persistKey) {
    persisted = storage.get<string | null>(persistKey, null);
  }
  let activeId = persisted ?? defaultTab ?? tabs[0]?.id ?? '';

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;gap:var(--qpm-space-1);' +
    'background:var(--qpm-surface-2);' +
    'border-radius:var(--qpm-radius-md);' +
    'padding:var(--qpm-space-1);' +
    'border:1px solid var(--qpm-border);';

  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText =
      'flex:1;padding:var(--qpm-space-2) var(--qpm-space-4);' +
      'border:none;border-radius:var(--qpm-radius-sm);' +
      'font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);' +
      'font-family:var(--qpm-font);' +
      'cursor:pointer;transition:background 0.15s ease,color 0.15s ease;' +
      'display:inline-flex;align-items:center;justify-content:center;gap:4px;' +
      'white-space:nowrap;';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = tab.label;
    btn.appendChild(labelSpan);

    if (tab.badge !== undefined) {
      const badge = createBadgeEl(tab.badge);
      btn.appendChild(badge);
      badgeMap.set(tab.id, badge);
    }

    btn.addEventListener('click', () => {
      if (activeId === tab.id) return;
      setActive(tab.id);
      if (persistKey) storage.set(persistKey, tab.id);
      onChange?.(tab.id);
    });

    buttonMap.set(tab.id, btn);
    root.appendChild(btn);
  }

  applyStyles();

  function applyStyles(): void {
    for (const [id, btn] of buttonMap) {
      if (id === activeId) {
        btn.style.background = 'var(--qpm-accent-tint)';
        btn.style.color = 'var(--qpm-accent)';
      } else {
        btn.style.background = 'transparent';
        btn.style.color = 'var(--qpm-text-muted)';
      }
    }
  }

  function setActive(id: string): void {
    if (!buttonMap.has(id)) return;
    activeId = id;
    applyStyles();
  }

  function getActive(): string {
    return activeId;
  }

  function setBadge(id: string, value: number | string): void {
    let badge = badgeMap.get(id);
    const btn = buttonMap.get(id);
    if (!btn) return;

    if (!badge) {
      badge = createBadgeEl(value);
      btn.appendChild(badge);
      badgeMap.set(id, badge);
    } else {
      badge.textContent = String(value);
    }
  }

  return { root, setActive, getActive, setBadge };
}

function createBadgeEl(value: number | string): HTMLElement {
  const badge = document.createElement('span');
  badge.textContent = String(value);
  badge.style.cssText =
    'font-size:var(--qpm-font-xs);' +
    'background:var(--qpm-accent-subtle);' +
    'color:var(--qpm-accent);' +
    'border-radius:var(--qpm-radius-pill);' +
    'padding:0 5px;min-width:16px;text-align:center;' +
    'font-weight:var(--qpm-weight-semibold);line-height:1.6;';
  return badge;
}
