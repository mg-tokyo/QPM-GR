// src/features/shopEnhancer/buyAllButton.ts
// Injects a "Buy All" PIXI button into the expansion panel of in-stock shop items.

import {
  getPixiRuntime,
  inject,
  hasInjected,
  removeInjected,
  createGraphics,
  createText,
  createContainer,
  type PixiCtors,
} from '../../../core/pixiScene';
import { isRoomSocketOpen } from '../../../websocket/api';
import { sendPurchase, applyInventoryCapToQuantity } from '../../../ui/shop/restockAlerts/purchaseActions';
import { BUY_SEND_DELAY_MS } from '../../../ui/shop/restockAlerts/types';
import { CATEGORY_TO_SHOP_TYPE } from './types';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ShopEnhancer');
import type { ShopCategory } from '../../../types/shops';
import type { ShopRowInfo } from './types';

type PixiNode = Record<string, unknown>;

// --- Expansion panel button constants ---
const PANEL_BUTTON_TAG = 'buyall_panel';
const PANEL_BUYALL_COLOR = 0x2980b9; // blue fallback — used only if native color extraction fails

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let cachedCtors: PixiCtors | null = null;

/**
 * Extract PIXI constructors directly from shop row children.
 * Uses manual for loops to avoid cross-realm callback issues
 * with Tampermonkey sandbox.
 */
export function extractCtorsFromRows(rows: ShopRowInfo[]): PixiCtors | null {
  if (cachedCtors) return cachedCtors;

  const runtime = getPixiRuntime();
  if (!runtime.stage) {
    log('[ShopEnhancer:BuyAll] extractCtors: no stage available');
    return null;
  }

  const ContainerCtor = (runtime.stage as PixiNode).constructor as (new () => PixiNode) | undefined;
  if (!ContainerCtor) return null;

  let GraphicsCtor: (new () => PixiNode) | null = null;
  let TextCtor: (new (opts: { text: string; style: Record<string, unknown> }) => PixiNode) | null = null;

  for (const row of rows) {
    if (GraphicsCtor && TextCtor) break;
    if (!Array.isArray(row.node.children)) continue;
    const children = row.node.children as PixiNode[];

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child || typeof child !== 'object') continue;

      if (!GraphicsCtor && typeof child.rect === 'function') {
        GraphicsCtor = child.constructor as new () => PixiNode;
      }
      if (!TextCtor && typeof child.text === 'string' && child.constructor !== ContainerCtor) {
        TextCtor = child.constructor as new (opts: { text: string; style: Record<string, unknown> }) => PixiNode;
      }

      // Check one level deeper (text wrapped: Container → Text)
      if (Array.isArray(child.children)) {
        const subChildren = child.children as PixiNode[];
        for (let j = 0; j < subChildren.length; j++) {
          const sub = subChildren[j];
          if (!sub || typeof sub !== 'object') continue;
          if (!GraphicsCtor && typeof sub.rect === 'function') {
            GraphicsCtor = sub.constructor as new () => PixiNode;
          }
          if (!TextCtor && typeof sub.text === 'string' && sub.constructor !== ContainerCtor) {
            TextCtor = sub.constructor as new (opts: { text: string; style: Record<string, unknown> }) => PixiNode;
          }
        }
      }

      if (GraphicsCtor && TextCtor) break;
    }
  }

  if (!GraphicsCtor || !TextCtor) {
    log(`[ShopEnhancer:BuyAll] extractCtors: missing (Graphics=${!!GraphicsCtor}, Text=${!!TextCtor})`);
    return null;
  }

  cachedCtors = { Container: ContainerCtor, Graphics: GraphicsCtor, Text: TextCtor };
  log('[ShopEnhancer:BuyAll] extractCtors: constructors extracted successfully');
  return cachedCtors;
}

// ---------------------------------------------------------------------------
// Native button measurement + resize
// ---------------------------------------------------------------------------

interface NativeButtonMeasurement {
  btn: PixiNode;
  x: number;
  y: number;
  width: number;    // from hitArea.width → Graphics child → btn.width
  height: number;   // from hitArea.height → Graphics child → 40
  textStyle: Record<string, unknown> | null;
  buttonColor: number;
}

/** Read-only measurement of a native buy button. */
function measureNativeButton(btn: PixiNode): NativeButtonMeasurement {
  const x = typeof btn.x === 'number' ? btn.x : 0;
  const y = typeof btn.y === 'number' ? btn.y : 0;

  // Width/height: hitArea > Graphics child > btn.width > fallback
  const hitArea = btn.hitArea as { width?: number; height?: number } | undefined;
  let width = 267;
  let height = 40;
  if (hitArea && typeof hitArea.width === 'number' && hitArea.width > 0) {
    width = hitArea.width;
  } else if (typeof btn.width === 'number' && btn.width > 0) {
    width = btn.width as number;
  }
  if (hitArea && typeof hitArea.height === 'number' && hitArea.height > 0) {
    height = hitArea.height;
  }

  // Extract text style by walking children
  let textStyle: Record<string, unknown> | null = null;
  if (Array.isArray(btn.children)) {
    const children = btn.children as PixiNode[];
    for (let i = 0; i < children.length && !textStyle; i++) {
      const child = children[i];
      if (!child || typeof child !== 'object') continue;
      if (typeof child.text === 'string' && child.style && typeof child.style === 'object') {
        textStyle = cloneStyle(child.style as Record<string, unknown>);
      }
      if (!textStyle && Array.isArray(child.children)) {
        const subs = child.children as PixiNode[];
        for (let j = 0; j < subs.length; j++) {
          const sub = subs[j];
          if (sub && typeof sub.text === 'string' && sub.style && typeof sub.style === 'object') {
            textStyle = cloneStyle(sub.style as Record<string, unknown>);
            break;
          }
        }
      }
    }
  }

  // Extract color from tints (avoid Graphics context — circular ref crash risk)
  let buttonColor = PANEL_BUYALL_COLOR;
  const btnTint = typeof btn.tint === 'number' ? btn.tint : 0xffffff;
  if (btnTint !== 0xffffff && btnTint !== 16777215) {
    buttonColor = btnTint;
  } else if (Array.isArray(btn.children)) {
    const children = btn.children as PixiNode[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child || typeof child !== 'object') continue;
      const childTint = typeof child.tint === 'number' ? child.tint : 0xffffff;
      if (childTint !== 0xffffff && childTint !== 16777215) {
        buttonColor = childTint;
        break;
      }
    }
  }

  return { btn, x, y, width, height, textStyle, buttonColor };
}

/**
 * Resize a native button's Graphics backgrounds and update its hitArea.
 * Uses PIXI .width setter (applies scale.x internally) then restores height
 * to prevent vertical distortion. Avoids clear()+redraw which crashes the
 * game's state tracker due to circular refs in Graphics context.
 */
function resizeNativeButton(info: NativeButtonMeasurement, newWidth: number): void {
  const { btn } = info;

  // Update hitArea width (must use the same Rectangle instance to keep .contains())
  if (btn.hitArea && typeof btn.hitArea === 'object') {
    (btn.hitArea as { width: number }).width = newWidth;
  }

  if (!Array.isArray(btn.children)) return;
  const children = btn.children as PixiNode[];

  // Resize all Graphics children (background rect, accent bar, etc.)
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child || typeof child !== 'object') continue;
    if (typeof child.rect !== 'function' && typeof child.roundRect !== 'function') continue;
    const origH = typeof child.height === 'number' ? child.height as number : 40;
    child.width = newWidth;
    child.height = origH; // restore height — PIXI couples scale.x/y via .width/.height setters
  }
}

/** Create a hitArea object with the .contains() method PIXI requires. */
function makeHitArea(w: number, h: number): { x: number; y: number; width: number; height: number; contains: (px: number, py: number) => boolean } {
  return { x: 0, y: 0, width: w, height: h, contains(px: number, py: number) { return px >= 0 && px <= w && py >= 0 && py <= h; } };
}

function cloneStyle(style: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = ['fontSize', 'fontWeight', 'fontFamily', 'fill', 'fontStyle',
    'letterSpacing', 'lineHeight', 'align', 'dropShadow', 'stroke', 'padding'];
  for (const key of keys) {
    if (key in style && style[key] != null) {
      result[key] = style[key];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Button builder (matches native style)
// ---------------------------------------------------------------------------

/** Center a PIXI text node within a container of given dimensions. */
function centerText(
  textNode: PixiNode,
  containerWidth: number,
  containerHeight: number,
  style: Record<string, unknown>,
): void {
  // Use actual measured dimensions from PIXI Text when available
  let textW = typeof textNode.width === 'number' ? textNode.width : 0;
  let textH = typeof textNode.height === 'number' ? textNode.height : 0;

  // Fallback: estimate from font size if measurement returned 0
  if (textW <= 0 || textH <= 0) {
    const fontSize = typeof style.fontSize === 'number' ? style.fontSize : 14;
    const text = typeof textNode.text === 'string' ? textNode.text : '';
    if (textW <= 0) textW = fontSize * text.length * 0.55;
    if (textH <= 0) textH = fontSize;
  }

  textNode.x = Math.round((containerWidth - textW) / 2);
  textNode.y = Math.round((containerHeight - textH) / 2);
}

function buildButton(
  ctors: PixiCtors,
  label: string,
  width: number,
  height: number,
  color: number,
  textStyle: Record<string, unknown>,
): { btn: PixiNode; updateText: (text: string) => void } {
  const container = createContainer(ctors);
  const addChild = (container as { addChild?: (c: unknown) => void }).addChild;

  // Background — match native roundRect radius
  const bg = createGraphics(ctors);
  if (typeof bg.roundRect === 'function') {
    bg.roundRect(0, 0, width, height, 8);
  } else if (typeof bg.rect === 'function') {
    bg.rect(0, 0, width, height);
  }
  if (typeof bg.fill === 'function') {
    bg.fill({ color, alpha: 1 });
  }

  // Text — use cloned native style, ensure white fill for readability
  const style = { ...textStyle, fill: 0xffffff };
  const textNode = createText(ctors, label, style);

  // Center text using actual measured dimensions
  centerText(textNode, width, height, style);

  if (typeof addChild === 'function') {
    addChild.call(container, bg);
    addChild.call(container, textNode);
  }

  container.eventMode = 'static';
  container.cursor = 'pointer';

  const updateText = (text: string): void => {
    textNode.text = text;
    centerText(textNode, width, height, style);
  };
  return { btn: container, updateText };
}

// ---------------------------------------------------------------------------
// Purchase handler wiring
// ---------------------------------------------------------------------------

function wirePurchaseHandler(
  btn: PixiNode,
  shopType: string,
  itemId: string,
  quantity: number,
  itemType: string | undefined,
  updateText: (text: string) => void,
): void {
  let purchasing = false;

  const handler = async (): Promise<void> => {
    if (purchasing) return;
    purchasing = true;

    const canonicalKey = `${shopType}:${itemId}`;
    const cappedQty = applyInventoryCapToQuantity(
      shopType as 'seed' | 'egg' | 'tool' | 'decor' | 'dawn',
      itemId,
      canonicalKey,
      quantity,
    );

    if (cappedQty <= 0) {
      updateText('Full');
      setTimeout(() => { updateText('Buy All'); purchasing = false; }, 1500);
      return;
    }

    try {
      await executePurchaseLoop(shopType, itemId, cappedQty, itemType, updateText);
    } catch (err) {
      log('[ShopEnhancer] Purchase loop error', err);
      updateText('Error');
      setTimeout(() => updateText('Buy All'), 1500);
    } finally {
      purchasing = false;
    }
  };

  if (typeof (btn as { on?: (e: string, cb: () => void) => void }).on === 'function') {
    (btn as { on: (e: string, cb: () => void) => void }).on('pointertap', handler);
  }
}

async function executePurchaseLoop(
  shopType: string,
  itemId: string,
  quantity: number,
  itemType: string | undefined,
  updateText: (text: string) => void,
): Promise<void> {
  for (let i = 0; i < quantity; i++) {
    if (!isRoomSocketOpen()) {
      updateText('Offline');
      return;
    }

    const result = sendPurchase(shopType as 'seed' | 'egg' | 'tool' | 'decor' | 'dawn', itemId, itemType);
    if (!result.ok) {
      updateText('Failed');
      return;
    }

    updateText(`${i + 1}/${quantity}`);

    if (i < quantity - 1) {
      await sleep(BUY_SEND_DELAY_MS);
    }
  }

  updateText('Done!');
  setTimeout(() => updateText('Buy All'), 1500);
}

// ---------------------------------------------------------------------------
// Expansion panel detection
// ---------------------------------------------------------------------------

/**
 * Find the expansion panel in the content container.
 * The panel has 2-6 children, unlike item rows (≥7) and the footer (1).
 */
export function findExpansionPanel(content: PixiNode): PixiNode | null {
  if (!Array.isArray(content.children)) return null;
  const children = content.children as PixiNode[];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child || typeof child !== 'object') continue;
    if (!Array.isArray(child.children)) continue;
    const kidCount = (child.children as unknown[]).length;
    // Panel has 2-6 children — distinct from item rows (≥7) and footer (1).
    // With our injected button it gains +1.
    if (kidCount >= 2 && kidCount <= 6 && !hasInjected(child, PANEL_BUTTON_TAG)) {
      return child;
    }
    if (kidCount >= 3 && kidCount <= 7 && hasInjected(child, PANEL_BUTTON_TAG)) {
      return child;
    }
  }
  return null;
}

/**
 * Match the expansion panel to the item row it belongs to.
 * The panel's y is right after the expanded row (row.y + ~90).
 */
export function findExpandedRow(panel: PixiNode, rows: ShopRowInfo[]): ShopRowInfo | null {
  const panelY = typeof panel.y === 'number' ? panel.y : -1;
  if (panelY < 0) return null;

  let best: ShopRowInfo | null = null;
  let bestDist = Infinity;

  for (const row of rows) {
    const rowY = typeof row.node.y === 'number' ? row.node.y : -1;
    if (rowY < 0 || rowY >= panelY) continue;
    const dist = panelY - rowY;
    if (dist > 0 && dist < 120 && dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  }

  return best;
}

/**
 * Find native interactive buy buttons inside the expansion panel.
 */
function findNativeButtons(panel: PixiNode): PixiNode[] {
  if (!Array.isArray(panel.children)) return [];
  const children = panel.children as PixiNode[];
  const buttons: PixiNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child || typeof child !== 'object') continue;
    if (child.eventMode !== 'static') continue;
    if (!Array.isArray(child.children) || (child.children as unknown[]).length < 2) continue;
    if (typeof child.label === 'string' && (child.label as string).startsWith('__qpm_')) continue;
    buttons.push(child);
  }
  return buttons;
}

// ---------------------------------------------------------------------------
// Panel injection
// ---------------------------------------------------------------------------

/**
 * Inject a Buy All button into the expansion panel alongside native buy buttons.
 * Positions to the right of native buttons without modifying them.
 */
export function injectPanelBuyAll(
  content: PixiNode,
  rows: ShopRowInfo[],
  category: ShopCategory,
): void {
  const panel = findExpansionPanel(content);
  if (!panel) return;
  if (hasInjected(panel, PANEL_BUTTON_TAG)) return;

  const ctors = cachedCtors;
  if (!ctors) return;

  const expandedRow = findExpandedRow(panel, rows);
  if (!expandedRow) {
    log(`[ShopEnhancer:BuyAll] Panel: could not match panel (y=${typeof panel.y === 'number' ? panel.y : '?'}) to any row`);
    return;
  }
  if (!expandedRow.isAvailable || !expandedRow.itemId) return;
  if ((expandedRow.remaining ?? 0) <= 0) return;

  const rawButtons = findNativeButtons(panel);
  if (rawButtons.length === 0) return;

  // Measure native buttons
  const measurements = rawButtons.map(measureNativeButton);
  const first = measurements[0]!;

  // Derive layout metrics from native button positions
  const leftMargin = first.x;                                          // 16
  const btnY = first.y;                                                // 8
  const btnHeight = first.height;                                      // 40
  const gap = measurements.length > 1
    ? measurements[1]!.x - (first.x + first.width)                    // 8
    : 8;
  const nativeCount = rawButtons.length;

  // Layout width from expanded row (stable reference, not panel bounding box)
  const layoutWidth = typeof expandedRow.node.width === 'number'
    ? expandedRow.node.width as number
    : (typeof content.width === 'number' ? content.width as number : 576);

  // Compute button widths: shrink native buttons to fit Buy All.
  // Layout: leftMargin + N*(nativeW + gap) + buyAllW + rightMargin = layoutWidth
  // Use leftMargin for both sides (symmetric).
  const MIN_BUYALL_WIDTH = 90;
  const totalButtonSpace = layoutWidth - leftMargin * 2 - gap * nativeCount;
  const nativeW = Math.floor((totalButtonSpace - MIN_BUYALL_WIDTH) / nativeCount);
  const buyAllWidth = totalButtonSpace - nativeW * nativeCount;

  // Reposition and resize native buttons
  let x = leftMargin;
  for (const info of measurements) {
    info.btn.x = x;
    resizeNativeButton(info, nativeW);
    x += nativeW + gap;
  }
  const buyAllX = x;

  log(`[ShopEnhancer:BuyAll] Layout: layoutWidth=${layoutWidth} nativeW=${nativeW} (was ${first.width}) buyAllW=${buyAllWidth} buyAllX=${buyAllX}`);

  // Extract text style from native buttons; use fallback if none found
  let nativeTextStyle: Record<string, unknown> = { fontSize: 14, fontWeight: 'bold', fill: 0xffffff, fontFamily: 'Arial, sans-serif' };
  for (const m of measurements) {
    if (m.textStyle) { nativeTextStyle = m.textStyle; break; }
  }

  // Use first native button's color
  const nativeColor = first.buttonColor;

  let btn: PixiNode;
  let updateText: (text: string) => void;
  try {
    const result = buildButton(ctors, 'Buy All', buyAllWidth, btnHeight, nativeColor, nativeTextStyle);
    btn = result.btn;
    updateText = result.updateText;
  } catch (err) {
    log('[ShopEnhancer:BuyAll] Panel button build failed', err);
    return;
  }

  btn.x = buyAllX;
  btn.y = btnY;

  // Set hitArea with .contains() for PIXI hit testing.
  // Clone the Rectangle constructor from a native button's hitArea.
  const nativeHitArea = rawButtons[0]!.hitArea;
  if (nativeHitArea && typeof nativeHitArea === 'object' && typeof (nativeHitArea as Record<string, unknown>).constructor === 'function') {
    try {
      btn.hitArea = new ((nativeHitArea as { constructor: new (x: number, y: number, w: number, h: number) => unknown }).constructor)(0, 0, buyAllWidth, btnHeight);
    } catch {
      btn.hitArea = makeHitArea(buyAllWidth, btnHeight);
    }
  } else {
    btn.hitArea = makeHitArea(buyAllWidth, btnHeight);
  }

  const shopType = CATEGORY_TO_SHOP_TYPE[category] ?? category;
  wirePurchaseHandler(btn, shopType, expandedRow.itemId, expandedRow.remaining!, expandedRow.itemType, updateText);
  inject(panel, btn, PANEL_BUTTON_TAG);
  log(`[ShopEnhancer:BuyAll] Panel button injected for ${expandedRow.itemName} (${nativeCount} native btns resized ${first.width}→${nativeW}, buyAll w=${buyAllWidth})`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function removeBuyAllButtons(contentContainer: unknown): number {
  return removeInjected(contentContainer, PANEL_BUTTON_TAG);
}

export function resetCtorCache(): void {
  cachedCtors = null;
}
