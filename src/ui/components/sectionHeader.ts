import { renderIcon } from './icon';

export interface SectionHeaderOptions {
  icon?: string;
  size?: 'default' | 'compact';
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: (collapsed: boolean) => void;
  badge?: string | number;
}

interface SectionHeaderResult {
  root: HTMLElement;
  setTitle: (title: string) => void;
  setBadge: (value: string | number) => void;
  setCollapsed: (collapsed: boolean) => void;
}

export function createSectionHeader(
  title: string,
  options: SectionHeaderOptions = {},
): SectionHeaderResult {
  const {
    icon,
    size = 'default',
    collapsible = false,
    collapsed: initialCollapsed = false,
    onToggle,
    badge,
  } = options;

  let isCollapsed = initialCollapsed;

  const isCompact = size === 'compact';

  const root = document.createElement('div');
  root.style.cssText = isCompact
    ? `${collapsible ? 'cursor:pointer;user-select:none;' : ''}`
    : 'display:flex;align-items:center;justify-content:space-between;' +
      'padding:var(--qpm-space-3) 0;' +
      'border-bottom:1px solid var(--qpm-divider);' +
      `${collapsible ? 'cursor:pointer;user-select:none;' : ''}`;

  const leftSide = document.createElement('div');
  leftSide.style.cssText =
    'display:flex;align-items:center;gap:var(--qpm-space-2);';

  if (icon) {
    const iconEl = renderIcon(icon, { size: 16 });
    leftSide.appendChild(iconEl);
  }

  const titleEl = document.createElement('span');
  titleEl.textContent = title;
  titleEl.style.cssText = isCompact
    ? 'font-size:9px;font-weight:600;color:rgba(224,224,224,0.3);text-transform:uppercase;letter-spacing:0.5px;'
    : 'font-size:var(--qpm-font-subtitle);' +
      'font-weight:var(--qpm-weight-semibold);' +
      'color:var(--qpm-text);' +
      'font-family:var(--qpm-font);';
  leftSide.appendChild(titleEl);

  root.appendChild(leftSide);

  const rightSide = document.createElement('div');
  rightSide.style.cssText =
    'display:flex;align-items:center;gap:var(--qpm-space-3);';

  let badgeEl: HTMLElement | null = null;
  if (badge !== undefined) {
    badgeEl = createBadgeEl(badge);
    rightSide.appendChild(badgeEl);
  }

  let indicatorEl: HTMLElement | null = null;
  if (collapsible) {
    indicatorEl = document.createElement('span');
    indicatorEl.textContent = '\u25BC';
    indicatorEl.style.cssText =
      'font-size:var(--qpm-font-xs);color:var(--qpm-text-muted);' +
      'transition:transform 0.2s ease;display:inline-block;';
    applyCollapsedIndicator(indicatorEl, isCollapsed);
    rightSide.appendChild(indicatorEl);

    root.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      applyCollapsedIndicator(indicatorEl!, isCollapsed);
      onToggle?.(isCollapsed);
    });
  }

  root.appendChild(rightSide);

  function setTitle(t: string): void {
    titleEl.textContent = t;
  }

  function setBadge(value: string | number): void {
    if (!badgeEl) {
      badgeEl = createBadgeEl(value);
      rightSide.insertBefore(badgeEl, rightSide.firstChild);
    } else {
      badgeEl.textContent = String(value);
    }
  }

  function setCollapsed(collapsed: boolean): void {
    isCollapsed = collapsed;
    if (indicatorEl) applyCollapsedIndicator(indicatorEl, isCollapsed);
  }

  return { root, setTitle, setBadge, setCollapsed };
}

function applyCollapsedIndicator(el: HTMLElement, collapsed: boolean): void {
  el.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function createBadgeEl(value: string | number): HTMLElement {
  const el = document.createElement('span');
  el.textContent = String(value);
  el.style.cssText =
    'font-size:var(--qpm-font-xs);' +
    'background:var(--qpm-accent-subtle);' +
    'color:var(--qpm-accent);' +
    'border-radius:var(--qpm-radius-pill);' +
    'padding:0 6px;line-height:1.6;' +
    'font-weight:var(--qpm-weight-semibold);';
  return el;
}
