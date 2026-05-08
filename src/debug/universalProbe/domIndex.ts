import type { ProbeBounds, ProbeLayout, ProbeTargetCandidate } from './types';

export interface DomEntry {
  element: Element;
  type: string;
  label: string;
  role: string;
  boundsCss: ProbeBounds;
  depth: number;
  interactive: boolean;
  childCount: number;
  layout: ProbeLayout;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT']);
const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const INTERACTIVE_ROLES = new Set(['button', 'menuitem']);

function isProbeElement(element: Element): boolean {
  const id = element.id || '';
  if (id.startsWith('qpm-probe') || id.startsWith('mg-probe')) return true;
  const classList = element.classList;
  if (classList) {
    for (let i = 0; i < classList.length; i++) {
      const cls = classList.item(i);
      if (cls && (cls.startsWith('qpm-probe') || cls.startsWith('mg-probe'))) return true;
    }
  }
  return false;
}

export function getElementLabel(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const title = element.getAttribute('title');
  if (title) return title.trim();
  const textContent = element.textContent?.trim() ?? '';
  return textContent.slice(0, 80);
}

export function isDomElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) <= 0.001) return false;
  return true;
}

export function isDomInteractive(element: Element): boolean {
  if (INTERACTIVE_TAGS.has(element.tagName)) return true;
  if (element.tagName === 'A' && element.hasAttribute('href')) return true;
  const role = element.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (element.hasAttribute('tabindex')) return true;
  const style = window.getComputedStyle(element);
  if (style.cursor === 'pointer') return true;
  return false;
}

export function buildDomSelectorPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 6) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
    } else if (current.classList.length > 0) {
      selector += `.${Array.from(current.classList).slice(0, 2).join('.')}`;
    }
    parts.unshift(selector);
    current = current.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

export function selectorCandidates(element: Element): string[] {
  const selectors: string[] = [];
  if (element.id) {
    selectors.push(`#${element.id}`);
  }
  if (element.classList.length > 0) {
    selectors.push(`.${Array.from(element.classList).join('.')}`);
  }
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    selectors.push(`[aria-label="${ariaLabel}"]`);
  }
  selectors.push(buildDomSelectorPath(element));
  return selectors;
}

export function inferDomLayoutFromChildren(children: ProbeBounds[]): ProbeLayout {
  if (children.length < 2) {
    return { pattern: 'single', inferredCols: 1, inferredRows: 1, regularity: 0 };
  }

  // Sort by top then left
  const sorted = [...children].sort((a, b) => a.top - b.top || a.left - b.left);

  // Detect rows by grouping items within 10px vertical tolerance
  const rows: ProbeBounds[][] = [];
  let currentRow: ProbeBounds[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]!;
    if (Math.abs(item.top - currentRow[0]!.top) < 10) {
      currentRow.push(item);
    } else {
      rows.push(currentRow);
      currentRow = [item];
    }
  }
  rows.push(currentRow);

  const inferredRows = rows.length;
  const inferredCols = Math.max(...rows.map((row) => row.length));

  // Calculate regularity: how consistent are item widths and spacing
  const widths = children.map((child) => child.width);
  const avgWidth = widths.reduce((sum, w) => sum + w, 0) / widths.length;
  const widthVariance = widths.reduce((sum, w) => sum + Math.abs(w - avgWidth), 0) / widths.length;
  const regularity = Math.max(0, Math.min(1, 1 - widthVariance / (avgWidth || 1)));

  let pattern = 'irregular';
  if (inferredRows === 1) {
    pattern = 'row';
  } else if (inferredCols === 1) {
    pattern = 'column';
  } else if (regularity > 0.7) {
    pattern = 'grid';
  } else {
    pattern = 'flow';
  }

  return { pattern, inferredCols, inferredRows, regularity };
}

export function buildDomIndex(maxElements = 4000): DomEntry[] {
  const entries: DomEntry[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let count = 0;

  let node = walker.nextNode();
  while (node && count < maxElements) {
    const element = node as Element;
    node = walker.nextNode();

    if (SKIP_TAGS.has(element.tagName)) continue;
    if (isProbeElement(element)) continue;
    if (!isDomElementVisible(element)) continue;

    count++;

    const rect = element.getBoundingClientRect();
    const boundsCss: ProbeBounds = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };

    const childElements = Array.from(element.children).filter(
      (child) => !SKIP_TAGS.has(child.tagName) && isDomElementVisible(child),
    );
    const childBounds = childElements.map((child) => {
      const childRect = child.getBoundingClientRect();
      return { left: childRect.left, top: childRect.top, width: childRect.width, height: childRect.height };
    });

    // Calculate depth
    let depth = 0;
    let parent: Element | null = element.parentElement;
    while (parent && depth < 30) {
      depth++;
      parent = parent.parentElement;
    }

    entries.push({
      element,
      type: element.tagName.toLowerCase(),
      label: getElementLabel(element),
      role: element.getAttribute('role') ?? '',
      boundsCss,
      depth,
      interactive: isDomInteractive(element),
      childCount: childElements.length,
      layout: inferDomLayoutFromChildren(childBounds),
    });
  }

  return entries;
}

export function domChainAt(clientX: number, clientY: number): ProbeTargetCandidate[] {
  const elements = document.elementsFromPoint(clientX, clientY);
  const candidates: ProbeTargetCandidate[] = [];

  for (const element of elements) {
    if (SKIP_TAGS.has(element.tagName)) continue;
    if (isProbeElement(element)) continue;
    if (!isDomElementVisible(element)) continue;

    const rect = element.getBoundingClientRect();
    candidates.push({
      source: 'dom',
      kind: isDomInteractive(element) ? 'action-target' : 'scene-object',
      type: element.getAttribute('role') ? `${element.tagName.toLowerCase()}[role=${element.getAttribute('role') ?? ''}]` : element.tagName.toLowerCase(),
      label: getElementLabel(element),
      boundsCss: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      confidence: isDomInteractive(element) ? 70 : 40,
      interactive: isDomInteractive(element),
      role: element.getAttribute('role') ?? '',
      childCount: element.children.length,
      layout: inferDomLayoutFromChildren(Array.from(element.children).map((child) => {
        const childRect = child.getBoundingClientRect();
        return { left: childRect.left, top: childRect.top, width: childRect.width, height: childRect.height };
      })),
      element,
    });
  }

  return candidates;
}
