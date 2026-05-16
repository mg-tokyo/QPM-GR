// src/features/shopEnhancer/scanner.ts
// Scans the PIXI scene to find the active shop modal's item rows
// and matches them to shop stock data.

import { getPixiRuntime, findByLabel, getLabel, walkScene } from '../../core/pixiScene';
import { getShopStockState } from '../../store/shopStock';
import { createLogger } from '../../utils/logger';

const log = createLogger('ShopEnhancer');
import type { ShopStockItem } from '../../store/shopStockParsers';
import type { ShopCategory } from '../../types/shops';
import type { ShopRowInfo } from './types';

type PixiNode = Record<string, unknown>;

let _treeDumped = false;
let _rowsDumped = false;

// Names to exclude when extracting item labels from row children
const EXCLUDED_TEXT_LABELS = new Set([
  'NOTIFY',
  'WEB EXCLUSIVE!',
  'Buy with donuts',
  'OUT OF STOCK',
  'NEW',
]);

/**
 * Find the content container of the active shop modal.
 * Searches the modal subtree for the "ScrollableView" label, then navigates
 * ScrollableView → children[1] → children[0] to reach the content container.
 */
export function findShopContentContainer(): PixiNode | null {
  const runtime = getPixiRuntime();
  if (!runtime.ready || !runtime.stage) return null;

  const modal = findByLabel(runtime.stage, (label) => label.startsWith('ShopModal:'));
  if (!modal) return null;

  // The modal must be visible (not a stale cached node)
  if (modal.visible === false) return null;

  // Search the entire modal subtree for ScrollableView
  const scrollableView = findByLabel(modal, 'ScrollableView');
  if (!scrollableView) {
    if (!_treeDumped) {
      _treeDumped = true;
      log('[ShopEnhancer:Scanner] ScrollableView not found in modal subtree — dumping tree:');
      dumpModalTree(modal);
    }
    return null;
  }

  // Navigate: scrollableView.children[1].children[0] = content
  const svChildren = Array.isArray(scrollableView.children) ? scrollableView.children as PixiNode[] : [];
  if (svChildren.length < 2) return null;

  const contentWrapper = svChildren[1];
  if (!contentWrapper || typeof contentWrapper !== 'object') return null;

  const wrapperChildren = Array.isArray(contentWrapper.children) ? contentWrapper.children as PixiNode[] : [];
  const content = wrapperChildren[0] ?? null;

  if (content && !_treeDumped) {
    const contentChildren = Array.isArray(content.children) ? content.children as unknown[] : [];
    log(`[ShopEnhancer:Scanner] Content container found with ${contentChildren.length} children`);
  }

  return content;
}

/**
 * Dump top-level scene labels for diagnostic purposes.
 */
function dumpTopLabels(stage: unknown): void {
  const labels: string[] = [];
  walkScene(stage, (node, depth) => {
    const label = getLabel(node);
    if (label && depth <= 3) {
      labels.push(`${'  '.repeat(depth)}${label}`);
    }
    // Only go 3 levels deep for diagnostics
    if (depth >= 3) return;
  }, { maxDepth: 4, maxNodes: 200 });

  if (labels.length > 0) {
    log(`[ShopEnhancer:Scanner] Top scene labels:\n${labels.slice(0, 30).join('\n')}`);
  } else {
    log('[ShopEnhancer:Scanner] No labeled nodes found in top 3 levels');
  }
}

/**
 * Dump the modal's subtree structure for diagnostic purposes.
 * Goes 5 levels deep to find where the content container actually is.
 */
function dumpModalTree(modal: PixiNode): void {
  const lines: string[] = [];
  walkScene(modal, (node, depth) => {
    const label = getLabel(node);
    const childCount = Array.isArray(node.children) ? (node.children as unknown[]).length : 0;
    const hasText = typeof node.text === 'string';
    const type = node.constructor?.name ?? typeof node;
    const vis = node.visible !== false ? 'V' : 'H';
    const y = typeof node.y === 'number' ? `y=${Math.round(node.y as number)}` : '';
    const w = typeof node.width === 'number' ? `w=${Math.round(node.width as number)}` : '';
    const h = typeof node.height === 'number' ? `h=${Math.round(node.height as number)}` : '';

    let info = `${'  '.repeat(depth)}[${type}] ${vis} children=${childCount}`;
    if (label) info += ` label="${label}"`;
    if (hasText) info += ` text="${(node.text as string).slice(0, 30)}"`;
    if (y) info += ` ${y}`;
    if (w) info += ` ${w}`;
    if (h) info += ` ${h}`;

    lines.push(info);
  }, { maxDepth: 6, maxNodes: 300 });

  log(`[ShopEnhancer:Scanner] Modal tree (${lines.length} nodes):\n${lines.join('\n')}`);
}

/**
 * Get the text value from a node, checking both the node and its first child.
 * Text nodes in this game are often wrapped: Container → TextNode.
 */
function getTextValue(node: PixiNode): string | null {
  if (typeof node.text === 'string') return node.text.trim() || null;
  // Check first child (common pattern: Pk container wrapping an nc text node)
  if (Array.isArray(node.children)) {
    const children = node.children as PixiNode[];
    for (const child of children) {
      if (child && typeof child === 'object' && typeof child.text === 'string') {
        return child.text.trim() || null;
      }
    }
  }
  return null;
}

/**
 * Extract the item name text from a shop row container.
 * Searches text children (including wrapped text), skipping known non-name labels.
 */
function extractItemName(row: PixiNode): string | null {
  if (!Array.isArray(row.children)) return null;

  for (const child of row.children as PixiNode[]) {
    if (!child || typeof child !== 'object') continue;

    const text = getTextValue(child);
    if (!text || EXCLUDED_TEXT_LABELS.has(text)) continue;

    // Skip price numbers (pure digits, or digits with comma separators)
    if (/^[\d,]+$/.test(text)) continue;

    // Skip "x5" style quantity labels
    if (/^x\d+$/i.test(text)) continue;

    // Skip stock labels like "X16 STOCK"
    if (/^x\d+\s+stock$/i.test(text)) continue;

    return text;
  }

  return null;
}

/**
 * Check if a container looks like a shop item row.
 * Item rows have ≥7 children (bg graphics, sprite, text containers, tooltip, buy btn...).
 * The expansion panel has 4-5, and the footer text node has 1.
 */
function isItemRow(node: PixiNode): boolean {
  if (!Array.isArray(node.children)) return false;
  return (node.children as unknown[]).length >= 7;
}

// Common suffixes that the game UI appends to species/type names
const SHOP_DISPLAY_SUFFIXES = ['seed', 'egg', 'seeds', 'eggs'];

/**
 * Match a PIXI row's display name to a stock item using multiple strategies:
 * 1. Exact match (case-insensitive)
 * 2. Strip known suffixes from PIXI name (e.g. "Carrot Seed" → "Carrot")
 * 3. Stock label contained as prefix of PIXI name (e.g. stock "Carrot" matches "Carrot Seed")
 */
function matchStockItem(
  pixiName: string,
  stockByLabel: Map<string, ShopStockItem>,
  stockItems: ShopStockItem[],
): ShopStockItem | null {
  const lowerName = pixiName.toLowerCase();

  // Strategy 1: exact match
  const exact = stockByLabel.get(lowerName);
  if (exact) return exact;

  // Strategy 2: strip known suffixes ("Carrot Seed" → "Carrot")
  for (const suffix of SHOP_DISPLAY_SUFFIXES) {
    if (lowerName.endsWith(` ${suffix}`)) {
      const stripped = lowerName.slice(0, -(suffix.length + 1));
      const match = stockByLabel.get(stripped);
      if (match) return match;
    }
  }

  // Strategy 3: stock label is a prefix of the PIXI name
  // Handles cases like stock label "Butterfly" matching "Butterfly Egg"
  for (const item of stockItems) {
    const stockLabel = item.label.toLowerCase();
    if (lowerName.startsWith(stockLabel) && lowerName.length > stockLabel.length && lowerName[stockLabel.length] === ' ') {
      return item;
    }
  }

  return null;
}

/**
 * Scan the shop content container and match rows to stock data.
 */
export function scanShopRows(category: ShopCategory): ShopRowInfo[] {
  const content = findShopContentContainer();
  if (!content || !Array.isArray(content.children)) return [];

  const stockState = getShopStockState();
  const categoryState = stockState.categories[category];
  if (!categoryState) {
    log(`[ShopEnhancer:Scanner] No stock state for category: ${category}`);
    return [];
  }

  const stockItems = categoryState.items;
  log(`[ShopEnhancer:Scanner] Stock has ${stockItems.length} items for ${category}`);
  if (stockItems.length > 0) {
    log(`[ShopEnhancer:Scanner] First 3 stock labels: ${stockItems.slice(0, 3).map((i) => `"${i.label}"`).join(', ')}`);
  }

  // Build multiple lookup maps for flexible matching.
  // Stock labels may be species keys ("Carrot") while PIXI shows "Carrot Seed".
  const stockByLabel = new Map<string, ShopStockItem>();
  for (const item of stockItems) {
    stockByLabel.set(item.label.toLowerCase(), item);
  }

  const results: ShopRowInfo[] = [];
  const children = content.children as PixiNode[];
  let rowCount = 0;

  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    if (!isItemRow(child)) continue;
    rowCount++;

    const itemName = extractItemName(child);
    if (!itemName) {
      log(`[ShopEnhancer:Scanner] Row ${rowCount}: no item name extracted (${(child.children as unknown[]).length} children)`);
      continue;
    }

    const stockItem = matchStockItem(itemName, stockByLabel, stockItems) ?? null;

    results.push({
      node: child,
      itemName,
      itemId: stockItem?.id ?? null,
      isAvailable: stockItem?.isAvailable ?? false,
      remaining: stockItem?.remaining ?? stockItem?.currentStock ?? null,
      priceCoins: stockItem?.priceCoins ?? null,
      itemType: undefined,
    });

    // Resolve item type from raw data if available
    if (stockItem?.raw && results.length > 0) {
      const last = results[results.length - 1]!;
      const raw = stockItem.raw as Record<string, unknown>;
      if (raw.species != null) last.itemType = 'Seed';
      else if (raw.eggId != null) last.itemType = 'Egg';
      else if (raw.toolId != null) last.itemType = 'Tool';
      else if (raw.decorId != null) last.itemType = 'Decor';
    }
  }

  log(`[ShopEnhancer:Scanner] Found ${rowCount} item rows, matched ${results.filter((r) => r.itemId).length}/${results.length} to stock`);
  if (results.length > 0) {
    log(`[ShopEnhancer:Scanner] First 3 rows: ${results.slice(0, 3).map((r) => `"${r.itemName}" (id=${r.itemId}, avail=${r.isAvailable}, remaining=${r.remaining})`).join(', ')}`);
  }

  // One-time diagnostic: dump content children structure when no rows found
  if (rowCount === 0 && !_rowsDumped) {
    _rowsDumped = true;
    dumpContentChildren(children);
  }

  return results;
}

/**
 * Dump the structure of content children to understand actual row layout.
 */
function dumpContentChildren(children: PixiNode[]): void {
  const lines: string[] = [];
  const limit = Math.min(children.length, 5);
  for (let i = 0; i < limit; i++) {
    const child = children[i]!;
    const childChildren = Array.isArray(child.children) ? child.children as PixiNode[] : [];
    const label = getLabel(child);
    const type = child.constructor?.name ?? typeof child;
    const y = typeof child.y === 'number' ? Math.round(child.y as number) : '?';

    // Check for text at multiple depths
    const texts: string[] = [];
    walkScene(child, (node) => {
      if (typeof node.text === 'string' && node.text.trim()) {
        texts.push(node.text.trim().slice(0, 40));
      }
    }, { maxDepth: 4, maxNodes: 100 });

    lines.push(
      `  [${i}] ${type} y=${y} directChildren=${childChildren.length}` +
      (label ? ` label="${label}"` : '') +
      ` texts=[${texts.join(', ')}]`,
    );

    // Dump first-level children of this row
    for (let j = 0; j < Math.min(childChildren.length, 8); j++) {
      const sub = childChildren[j]!;
      const subType = sub.constructor?.name ?? typeof sub;
      const subLabel = getLabel(sub);
      const subChildCount = Array.isArray(sub.children) ? (sub.children as unknown[]).length : 0;
      const subText = typeof sub.text === 'string' ? ` text="${sub.text.slice(0, 30)}"` : '';
      lines.push(`    [${i}.${j}] ${subType} children=${subChildCount}${subLabel ? ` label="${subLabel}"` : ''}${subText}`);
    }
  }

  log(`[ShopEnhancer:Scanner] Content children dump (first ${limit} of ${children.length}):\n${lines.join('\n')}`);
}

/** Reset diagnostic state (call on shop close). */
export function resetScannerDiagnostics(): void {
  _treeDumped = false;
  _rowsDumped = false;
}

/** Returns the content container's child count for change detection. */
export function getContentChildCount(): number {
  const content = findShopContentContainer();
  if (!content || !Array.isArray(content.children)) return -1;
  return (content.children as unknown[]).length;
}
