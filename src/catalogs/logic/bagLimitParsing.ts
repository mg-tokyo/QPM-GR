// The bag slot limit from game bundle text (ALR-7 PD2). The minifier inlines `inventoryLimit`
// (beta common/games/Quinoa/utils/inventory.ts:29) into `getIsInventoryFull` (:236-249); live 2036
// ships `function hn(e,t){return Xt(e)<100?!1:!t||!Zt(e,t)&&!e.items.some(…`. The ring arrival test
// (`!Zt(e,t)&&`) is optional so a build without the tool ring still matches.

// Fixed tokens and single-class runs only, so the scan stays linear (memory: bundle regexes can hang the tab).
export const BAG_LIMIT_MARKER =
  /\{return [\w$]+\([\w$]+\)<(\d{1,5})\?!1:![\w$]+\|\|(?:![\w$]+\([\w$]+,[\w$]+\)&&)?![\w$]+\.items\.some\(/;

/** The limit, or null when the anchor is absent or the number is not a positive slot count. */
export function parseBagLimit(text: string): number | null {
  const match = BAG_LIMIT_MARKER.exec(text);
  const limit = match?.[1] ? Number(match[1]) : NaN;
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}
