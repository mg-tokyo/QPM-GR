// src/features/shopEnhancer/sorting.ts
// Reorders shop item rows so in-stock items appear first.
// Handles expansion panel repositioning to keep it attached to its row.

import { reorderByY } from '../../core/pixiScene';
import { findShopContentContainer, scanShopRows } from './scanner';
import { findExpansionPanel, findExpandedRow } from './buyAllButton';
import type { ShopCategory } from '../../types/shops';
import type { ShopRowInfo } from './types';

type PixiNode = Record<string, unknown>;

/**
 * Check if a content child is an item row (has ≥7 children).
 * The expansion panel has 4-5, and the footer text node has 1.
 */
function isItemRow(node: PixiNode): boolean {
  if (!Array.isArray(node.children)) return false;
  return (node.children as unknown[]).length >= 7;
}

/**
 * Compute the typical row height from adjacent row Y positions.
 * Returns the smallest positive gap (skips the panel gap which is larger).
 */
function computeRowHeight(rows: ShopRowInfo[]): number {
  if (rows.length < 2) return 90;

  const ys = rows
    .map((r) => (typeof r.node.y === 'number' ? (r.node.y as number) : -1))
    .filter((y) => y >= 0)
    .sort((a, b) => a - b);

  let minGap = Infinity;
  for (let i = 1; i < ys.length; i++) {
    const gap = ys[i]! - ys[i - 1]!;
    if (gap > 0 && gap < minGap) minGap = gap;
  }

  return minGap > 0 && minGap < Infinity ? minGap : 90;
}

/**
 * Sort shop rows so in-stock items appear first, preserving relative order
 * within each group (in-stock and out-of-stock).
 *
 * When an expansion panel is open, recalculates all Y positions from scratch
 * so the panel stays attached to its associated row.
 */
export function applySorting(category: ShopCategory): void {
  const content = findShopContentContainer();
  if (!content) return;

  const rows = scanShopRows(category);
  if (rows.length < 2) return;

  const contentNode = content as PixiNode;
  const panel = findExpansionPanel(contentNode);

  if (!panel) {
    // No expansion panel — use simple Y-slot reorder (preserves exact positions)
    applySimpleSort(content, rows);
    return;
  }

  // Panel is open — need to recompute all Y positions after sorting
  // to keep the panel attached to its expanded row.
  const expandedRow = findExpandedRow(panel, rows);
  if (!expandedRow) {
    // Can't determine which row owns the panel — fall back to simple sort
    applySimpleSort(content, rows);
    return;
  }

  const rowHeight = computeRowHeight(rows);
  const panelHeight = typeof panel.height === 'number' ? (panel.height as number) : 56;

  // Sort: in-stock first, preserve relative order within groups
  const sorted = [...rows];
  const indexMap = new Map<object, number>();
  for (let i = 0; i < rows.length; i++) {
    indexMap.set(rows[i]!.node, i);
  }
  sorted.sort((a, b) => {
    if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
    return (indexMap.get(a.node) ?? 0) - (indexMap.get(b.node) ?? 0);
  });

  // Get the starting Y from the topmost row
  const startY = rows.reduce((min, r) => {
    const y = typeof r.node.y === 'number' ? (r.node.y as number) : Infinity;
    return y < min ? y : min;
  }, Infinity);

  // Assign Y positions from scratch, inserting panel after its associated row
  let currentY = startY === Infinity ? 0 : startY;
  for (const row of sorted) {
    row.node.y = currentY;
    currentY += rowHeight;
    if (row === expandedRow) {
      panel.y = currentY;
      currentY += panelHeight;
    }
  }

  // Reposition non-row, non-panel children (e.g. footer) at the end
  if (Array.isArray(contentNode.children)) {
    const children = contentNode.children as PixiNode[];
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      if (child === panel) continue;
      if (isItemRow(child)) continue;
      // Footer or other non-row child — move to end
      if (typeof child.y === 'number') {
        child.y = currentY;
      }
    }
  }
}

/** Simple Y-slot reorder when no expansion panel is present. */
function applySimpleSort(content: unknown, rows: ShopRowInfo[]): void {
  const availabilityMap = new WeakMap<object, { isAvailable: boolean; orderIndex: number }>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    availabilityMap.set(row.node, { isAvailable: row.isAvailable, orderIndex: i });
  }

  reorderByY(
    content,
    (node) => isItemRow(node),
    (a, b) => {
      const infoA = availabilityMap.get(a);
      const infoB = availabilityMap.get(b);

      if (!infoA && !infoB) return 0;
      if (!infoA) return 1;
      if (!infoB) return -1;

      // In-stock first
      if (infoA.isAvailable !== infoB.isAvailable) {
        return infoA.isAvailable ? -1 : 1;
      }

      // Within same group, preserve original shop order
      return infoA.orderIndex - infoB.orderIndex;
    },
  );
}

/**
 * Get the current scan results for button injection.
 * This is a convenience re-export to avoid scanner import in other modules.
 */
export function getScannedRows(category: ShopCategory): ShopRowInfo[] {
  return scanShopRows(category);
}
