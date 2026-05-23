export interface CardOptions {
  title?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: (collapsed: boolean) => void;
  className?: string;
}

interface CardResult {
  root: HTMLElement;
  body: HTMLElement;
  setTitle: (title: string) => void;
  setCollapsed: (collapsed: boolean) => void;
}

export function createCard(options: CardOptions = {}): CardResult {
  const {
    title,
    collapsible = false,
    collapsed: initialCollapsed = false,
    onToggle,
    className,
  } = options;

  let isCollapsed = initialCollapsed;

  const root = document.createElement('div');
  if (className) root.className = className;
  root.style.cssText =
    'background:var(--qpm-surface-2);' +
    'border:1px solid var(--qpm-border);' +
    'border-radius:var(--qpm-radius-md);' +
    'padding:var(--qpm-space-5);' +
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,0.03);';

  let titleEl: HTMLElement | null = null;
  let indicatorEl: HTMLElement | null = null;

  if (title) {
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'margin-bottom:var(--qpm-space-3);' +
      `${collapsible ? 'cursor:pointer;user-select:none;' : ''}`;

    titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText =
      'font-size:var(--qpm-font-subtitle);' +
      'font-weight:var(--qpm-weight-semibold);' +
      'color:var(--qpm-text);' +
      'display:flex;align-items:center;gap:6px;';
    header.appendChild(titleEl);

    if (collapsible) {
      indicatorEl = document.createElement('span');
      indicatorEl.style.cssText =
        'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);' +
        'transition:transform 0.2s ease;display:inline-block;';
      applyIndicator(indicatorEl, isCollapsed);
      header.appendChild(indicatorEl);

      header.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        applyIndicator(indicatorEl!, isCollapsed);
        body.style.display = isCollapsed ? 'none' : '';
        if (!isCollapsed) {
          header.style.marginBottom = 'var(--qpm-space-3)';
        } else {
          header.style.marginBottom = '0';
        }
        onToggle?.(isCollapsed);
      });
    }

    root.appendChild(header);
  }

  const body = document.createElement('div');
  body.style.display = isCollapsed ? 'none' : '';
  root.appendChild(body);

  function setTitle(t: string): void {
    if (titleEl) titleEl.textContent = t;
  }

  function setCollapsed(collapsed: boolean): void {
    isCollapsed = collapsed;
    body.style.display = isCollapsed ? 'none' : '';
    if (indicatorEl) applyIndicator(indicatorEl, isCollapsed);
  }

  return { root, body, setTitle, setCollapsed };
}

function applyIndicator(el: HTMLElement, collapsed: boolean): void {
  el.textContent = '\u25BC'; // ▼
  el.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}
