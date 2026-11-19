// What the shared panel chrome needs to know about a storage panel: where its sheet sits, how to make it
// lay out again, its z band, its frame colours and its title.
import { NEUTRAL_COLORS, sampleFrameColors, storageTitle, type FrameColors } from './chromeArt';
import type { PanelKind, PanelMetrics } from './chrome';
import type { PixiNode, StorageViewLike } from './gameHooks';
import { STORAGE_FIT, type Cell } from './layout';
import { getSavedLayout, saveLayoutCells } from './settings';

export interface StorageChromePanel {
  readonly id: string;
  readonly storageId: string;
  readonly index: number;
  readonly host: PixiNode;
  readonly cell: Cell;
  view(): StorageViewLike | null;
}

// Per storage: the trough has its own stone frame (beta StorageModalView.ts:369-372). Kept for the page,
// since each sample is a GPU read-back.
const frameColorCache = new Map<string, FrameColors>();

function frameColorsFor(panel: StorageChromePanel, extract: unknown): FrameColors | null {
  const cached = frameColorCache.get(panel.storageId);
  if (cached) return cached;
  const sampled = sampleFrameColors(extract, panel.view()?.itemSheet?.background);
  if (!sampled) return null;
  if (sampled === 'unreadable') return NEUTRAL_COLORS;
  frameColorCache.set(panel.storageId, sampled);
  return sampled;
}

/** Where the visible panel sits in its cell: centred, standing on the cell's bottom edge. */
function sheetMetrics(panel: StorageChromePanel): PanelMetrics | null {
  const sheet = panel.view()?.itemSheet;
  const body = sheet?.body;
  if (!sheet || !body || body.destroyed || !(sheet.widthPx > 0)) return null;
  const settled = sheet.layout?.heightPx;
  const height = settled !== undefined && settled > 0 ? settled : Math.max(0, panel.cell.h - body.y);
  return { left: body.x, width: sheet.widthPx, y: body.y, height, top: panel.cell.h - height };
}

/** The sheet re-lays out only when the game's viewport revision changes, so a new size clears the one it saw. */
function requestReflow(panel: StorageChromePanel): void {
  const sheet = panel.view()?.itemSheet;
  if (sheet && 'lastViewportRevision' in sheet) sheet.lastViewportRevision = -1;
}

export function panelRootZ(host: PixiNode): number {
  const root = host.children.find(child => child.label === 'StorageModal') ?? host.children[0];
  return root ? root.zIndex : 0;
}

export const storagePanelKind: PanelKind<StorageChromePanel> = {
  fit: STORAGE_FIT,
  labels: { header: 'MultiStorageHeader', grip: 'MultiStorageGrip' },
  metrics: sheetMetrics,
  requestReflow,
  rootZ: panel => panelRootZ(panel.host),
  title: panel => storageTitle(panel.storageId),
  colors: frameColorsFor,
  layout: { get: getSavedLayout, save: saveLayoutCells },
};
