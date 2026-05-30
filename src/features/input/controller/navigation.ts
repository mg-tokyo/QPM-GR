/**
 * Directional cursor snap for D-pad UI navigation.
 *
 * Collects candidates from two sources:
 *   1. DOM focusable / ARIA-interactive elements
 *   2. Pixi interactive objects (passed in as {x,y} viewport-coordinate points)
 *
 * The nearest candidate in the pressed direction wins, scored by
 * `axialDistance + perpendicularOffset * 2` to prefer on-axis targets.
 */

import type { Cursor } from './cursor';

const FOCUSABLE_SELECTOR = [
  // Natively interactive
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'a[href]',
  // Chakra UI / ARIA-role interactive elements (inventory items, shop cards,
  // menu entries, tabs — rendered as divs/spans with role but no tabindex)
  '[role="button"]:not([disabled])',
  '[role="menuitem"]:not([disabled])',
  '[role="option"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="checkbox"]',
].join(', ');

/**
 * Snap cursor to the nearest interactive element in direction (dx, dy).
 *
 * `extraPoints` — additional viewport-coordinate {x,y} centers to consider
 * alongside DOM candidates (used for Pixi canvas interactables).
 *
 * Direction vector components should be in {-1, 0, 1}.
 * Origin is always the current cursor position — snapping is spatial,
 * not relative to whatever the browser has focused.
 *
 * Returns true if a target was found and the cursor was warped.
 */
export function snapCursorToNearest(
  dx: number,
  dy: number,
  cursor: Cursor,
  extraPoints: ReadonlyArray<{ x: number; y: number }> = [],
): boolean {
  const origin = cursor.getPosition();

  // Collect DOM candidates as viewport-coordinate centers
  const domPoints: Array<{ x: number; y: number }> =
    Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map(getCenterOf);

  const all = [...domPoints, ...extraPoints];
  if (all.length === 0) return false;

  let bestX = 0;
  let bestY = 0;
  let bestScore = Infinity;

  for (const pt of all) {
    const relX = pt.x - origin.x;
    const relY = pt.y - origin.y;

    // Must be in the correct direction
    const dot = relX * dx + relY * dy;
    if (dot <= 0) continue;

    const dist = Math.hypot(relX, relY);
    // Perpendicular distance — penalises off-axis elements
    const perp = Math.abs(relX * dy - relY * dx);
    const score = dist + perp * 2;

    if (score < bestScore) {
      bestScore = score;
      bestX = pt.x;
      bestY = pt.y;
    }
  }

  if (bestScore === Infinity) return false;

  cursor.warpTo(bestX, bestY);
  return true;
}

function getCenterOf(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width  / 2,
    y: rect.top  + rect.height / 2,
  };
}
