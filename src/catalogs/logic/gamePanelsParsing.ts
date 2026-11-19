// The game's panel (modal) ids from bundle text (INP-1.4a, PD2). Beta pr-4669-gke-2911 ships every panel as a
// key of `INTERACTION_BY_MODAL` (playerInteraction.ts:9-45, `{seedShop:r.Seed,…,journal:`journal`,…,activityLog:null}`)
// and the storage panels as `STORAGE_BUILDING_MODALS` (data/storageBuildingModal.ts:3-9, `{PetHutch:`petHutch`,…}`).

// Fixed tokens only, so the scan stays linear (memory: bundle marker regexes can hang the tab).
export const PANEL_IDS_MARKER = /journal:[`'"]journal[`'"]/;
export const STORAGE_PANELS_MARKER = /PetHutch:[`'"]petHutch[`'"]/;
// Shop windows: one config per shop, `{modalName:`seedShop`,shopType:T.Seed,…}` (beta ShopModalView.ts:364-375, chunk installPlayerSystems).
export const SHOP_PANELS_MARKER = /modalName:[`'"]seedShop[`'"],shopType:/;

const MAX_PANEL_OBJECT_CHARS = 1500;
const MAX_STORAGE_OBJECT_CHARS = 300;
const MIN_PANEL_IDS = 8;
const MIN_STORAGE_PANELS = 3;
const MIN_SHOP_PANELS = 4;
const OBJECT_KEY = /[{,]([A-Za-z_$][\w$]{0,40}):/g;
const STORAGE_ENTRY = /[{,]([A-Z][\w$]{0,40}):([`'"])([A-Za-z]\w{0,40})\2/g;
const SHOP_ENTRY = /modalName:([`'"])([A-Za-z]\w{0,40})\1,shopType:/g;

function objectBody(text: string, markerIndex: number, maxChars: number): string | null {
  const open = text.lastIndexOf('{', markerIndex);
  if (open < 0 || markerIndex - open > maxChars) return null;
  const close = text.indexOf('}', markerIndex);
  if (close < 0 || close - open > maxChars) return null;
  return text.slice(open, close + 1);
}

/** Every panel id the game can open, or null when the anchor or the object bounds are missing. */
export function parsePanelIds(text: string): string[] | null {
  const marker = PANEL_IDS_MARKER.exec(text);
  if (!marker) return null;
  const body = objectBody(text, marker.index, MAX_PANEL_OBJECT_CHARS);
  if (!body) return null;
  const ids = new Set<string>();
  for (const m of body.matchAll(OBJECT_KEY)) if (m[1]) ids.add(m[1]);
  return ids.has('journal') && ids.size >= MIN_PANEL_IDS ? [...ids] : null;
}

/** The storage-building panel ids (`petHutch`, `seedSilo`, …), or null when the table is missing. */
export function parseStoragePanels(text: string): string[] | null {
  const marker = STORAGE_PANELS_MARKER.exec(text);
  if (!marker) return null;
  const body = objectBody(text, marker.index, MAX_STORAGE_OBJECT_CHARS);
  if (!body) return null;
  const ids = new Set<string>();
  for (const m of body.matchAll(STORAGE_ENTRY)) if (m[3]) ids.add(m[3]);
  return ids.size >= MIN_STORAGE_PANELS ? [...ids] : null;
}

/** The panel ids of the game's shop windows (`seedShop`, `rainShop`, …) in the game's order, or null when the configs are missing. */
export function parseShopPanels(text: string): string[] | null {
  if (!SHOP_PANELS_MARKER.test(text)) return null;
  const ids = new Set<string>();
  for (const m of text.matchAll(SHOP_ENTRY)) if (m[2]) ids.add(m[2]);
  return ids.size >= MIN_SHOP_PANELS ? [...ids] : null;
}
