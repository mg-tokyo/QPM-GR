import { closeWindow, destroyWindow, isWindowOpen, openWindow, windowLog } from '../core/modalWindow';

const MUTED = 'font-size:12px;color:var(--qpm-text-muted);line-height:1.4;';

export function muted(text: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = MUTED;
  el.textContent = text;
  return el;
}

/** Slider rows sharing one label column (subgrid), so their tracks line up while each label stays on one line. */
export function alignedRows(rows: HTMLElement[]): HTMLElement {
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;gap:8px;';
  for (const row of rows) {
    row.style.display = 'grid';
    row.style.gridColumn = '1 / -1';
    row.style.gridTemplateColumns = 'subgrid';
  }
  grid.append(...rows);
  return grid;
}

export interface SectionHandle { root: HTMLElement; destroy: () => void }

/** A Config card's Detach: closes its window when open, else opens it with a fresh section. */
export function toggleDetachedSection(id: string, title: string, create: () => SectionHandle, what: string): void {
  if (isWindowOpen(id)) { closeWindow(id); return; }
  // Closing ran the section's cleanup but kept the element: rebuild it so it subscribes again (openDetachedTracker,
  // trackersGroup.ts:95). Position and size come back from storage inside openWindow.
  destroyWindow(id);
  openWindow(id, title, (root) => {
    root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
    try {
      const section = create();
      root.appendChild(section.root);
      return section.destroy;
    } catch (e) {
      windowLog.warn('QPM-UI-002', { what }, e);
      return undefined;
    }
  }, '420px', '60vh');
}
