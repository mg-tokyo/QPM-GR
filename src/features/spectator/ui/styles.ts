const STYLE_ID = 'qpm-spectator-styles';

// Compact (PS1, 2026-10-09): labels give way to icons below 960 × 480, which includes the Discord panel (903×303).
// The info card reads the same query for its width and line count (PS2).
export const COMPACT_QUERY = '(max-width: 959px), (max-height: 479px)';
export const CARD_WIDTH = 240;
export const CARD_COMPACT_WIDTH = 200;
/** On <html> while photo mode is on: hides QPM's page UI (S §9). */
export const PHOTO_PAGE_CLASS = 'qpm-spec-photo';

const CSS = `
.qpm-spec-bar { position: fixed; left: 50%; transform: translateX(-50%); z-index: 9000; display: flex; align-items: center;
  gap: var(--qpm-space-3); padding: var(--qpm-space-2) var(--qpm-space-4); background: var(--qpm-surface-1);
  border: 1px solid var(--qpm-accent-focus); border-radius: var(--qpm-radius-lg); box-shadow: var(--qpm-shadow-subtle);
  color: var(--qpm-text); font-family: var(--qpm-font); font-size: var(--qpm-font-body); white-space: nowrap; user-select: none; }
.qpm-spec-bar[hidden], .qpm-spec-pop[hidden] { display: none; }
.qpm-spec-chip { padding: var(--qpm-space-1) var(--qpm-space-4); border-radius: var(--qpm-radius-pill); background: var(--qpm-accent-subtle);
  border: 1px solid var(--qpm-accent-focus); color: var(--qpm-accent-hover); font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-semibold); letter-spacing: 0.3px; text-transform: uppercase; }
.qpm-spec-chip[data-paused] { color: var(--qpm-warning); background: color-mix(in srgb, var(--qpm-warning) 15%, transparent);
  border-color: color-mix(in srgb, var(--qpm-warning) 38%, transparent); }
.qpm-spec-sep { width: 1px; align-self: stretch; background: var(--qpm-divider); }
.qpm-spec-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
.qpm-spec-muted { color: var(--qpm-text-muted); }
.qpm-spec-av { width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--qpm-border); flex: none; object-fit: cover;
  background: var(--qpm-surface-3); }
.qpm-spec-ico { display: none; width: 14px; height: 14px; }
.qpm-spec-ico svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.qpm-spec-pop { position: fixed; z-index: 9001; width: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: var(--qpm-space-1);
  padding: var(--qpm-space-2); background: var(--qpm-surface-1); border: 1px solid var(--qpm-accent-focus);
  border-radius: var(--qpm-radius-lg); box-shadow: var(--qpm-shadow-subtle); color: var(--qpm-text); font-family: var(--qpm-font); }
.qpm-spec-row { display: flex; align-items: center; gap: var(--qpm-space-4); width: 100%; padding: var(--qpm-space-3) var(--qpm-space-4);
  border: 1px solid transparent; border-radius: var(--qpm-radius-md); background: transparent; color: inherit; font: inherit;
  text-align: left; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
.qpm-spec-row:hover:not(:disabled) { background: var(--qpm-accent-tint); }
.qpm-spec-row[aria-current="true"] { background: var(--qpm-accent-subtle); border-color: var(--qpm-accent-focus); }
.qpm-spec-row:disabled { opacity: 0.45; cursor: default; }
.qpm-spec-row .qpm-spec-av { width: 24px; height: 24px; }
.qpm-spec-row-text { display: flex; flex-direction: column; min-width: 0; }
.qpm-spec-row-name { font-size: var(--qpm-font-body); font-weight: var(--qpm-weight-semibold); overflow: hidden; text-overflow: ellipsis; }
.qpm-spec-row-sub, .qpm-spec-row-seat { font-size: var(--qpm-font-caption); color: var(--qpm-text-muted); }
.qpm-spec-row-seat { margin-left: auto; flex: none; }
.qpm-spec-wp { display: flex; flex-direction: column; gap: var(--qpm-space-2); }
.qpm-spec-wp-hd { display: flex; align-items: center; justify-content: space-between; gap: var(--qpm-space-4);
  padding-bottom: var(--qpm-space-3); border-bottom: 1px solid var(--qpm-divider); }
.qpm-spec-wp-count { flex: none; font-size: var(--qpm-font-caption); color: var(--qpm-text-muted); }
.qpm-spec-wp-list { display: flex; flex-direction: column; gap: var(--qpm-space-1); }
.qpm-spec-wp-row { display: flex; align-items: center; gap: var(--qpm-space-1); padding-right: var(--qpm-space-2);
  border: 1px solid transparent; border-radius: var(--qpm-radius-md); transition: background 0.15s ease, border-color 0.15s ease; }
.qpm-spec-wp-row:hover { background: var(--qpm-accent-tint); }
.qpm-spec-wp-row[aria-current="true"] { background: var(--qpm-accent-subtle); border-color: var(--qpm-accent-focus); }
.qpm-spec-wp-fly { flex: 1; min-width: 0; padding: var(--qpm-space-3) var(--qpm-space-4); border: none; background: transparent;
  color: inherit; font: inherit; font-size: var(--qpm-font-body); text-align: left; cursor: pointer; }
.qpm-spec-wp-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qpm-spec-wp-input { flex: 1; min-width: 0; margin: var(--qpm-space-1) 0 var(--qpm-space-1) var(--qpm-space-2); }
.qpm-spec-wp-row[data-editing] .qpm-spec-wp-act { display: none !important; /* createButton sets display inline */ }
.qpm-spec-wp .qpm-spec-ico { display: inline-flex; }
.qpm-spec-wp .qpm-spec-lbl { display: none; }
.qpm-spec-card { z-index: 9000; width: ${CARD_WIDTH}px; overflow: hidden; background: var(--qpm-surface-1); border: 1px solid var(--qpm-accent-focus);
  border-radius: var(--qpm-radius-lg); box-shadow: var(--qpm-shadow-subtle); color: var(--qpm-text); font-family: var(--qpm-font);
  font-size: var(--qpm-font-body); user-select: none; }
.qpm-spec-card-hd { display: flex; align-items: center; gap: var(--qpm-space-4); padding: var(--qpm-space-4) var(--qpm-space-4) var(--qpm-space-3); cursor: grab; }
.qpm-spec-card-hd:active { cursor: grabbing; }
.qpm-spec-card-hd .qpm-spec-av { width: 24px; height: 24px; }
.qpm-spec-card-who { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.qpm-spec-card-name, .qpm-spec-card-sub, .qpm-spec-card-what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qpm-spec-card-name { font-weight: var(--qpm-weight-semibold); }
.qpm-spec-card-sub { font-size: var(--qpm-font-caption); color: var(--qpm-text-muted); }
.qpm-spec-card-on { color: var(--qpm-positive); }
.qpm-spec-card-x { flex: none; align-self: flex-start; }
.qpm-spec-card-body { display: flex; flex-direction: column; gap: var(--qpm-space-3); padding: 0 var(--qpm-space-4) var(--qpm-space-4); }
.qpm-spec-card-pets { display: flex; flex-wrap: wrap; gap: var(--qpm-space-4); font-size: var(--qpm-font-caption); }
.qpm-spec-card-pet { display: grid; grid-template-columns: auto 32px; align-items: center; gap: var(--qpm-space-2); }
.qpm-spec-card-hunger { grid-column: 1 / -1; }
.qpm-spec-card-abs { display: flex; flex-direction: column; gap: var(--qpm-space-1); }
.qpm-spec-card-ab { width: 6px; height: 6px; border: 1px solid var(--qpm-border); }
.qpm-spec-card-sprite { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px;
  border-radius: var(--qpm-radius-md); background: var(--qpm-surface-2); }
.qpm-spec-card-sprite img { width: 100%; height: 100%; object-fit: contain; }
.qpm-spec-card-held { display: flex; align-items: center; gap: var(--qpm-space-3); min-width: 0; font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted); }
.qpm-spec-card-held .qpm-spec-card-sprite { width: 20px; height: 20px; }
.qpm-spec-card-lines { display: flex; flex-direction: column; gap: var(--qpm-space-2); font-size: var(--qpm-font-caption); }
.qpm-spec-card-line { display: flex; align-items: baseline; gap: var(--qpm-space-3); min-width: 0; }
.qpm-spec-card-what { flex: 1; min-width: 0; }
.qpm-spec-card-when { flex: none; color: var(--qpm-text-muted); }
.qpm-spec-card-cur { display: flex; gap: var(--qpm-space-4); padding-top: var(--qpm-space-3); border-top: 1px solid var(--qpm-divider);
  font-size: var(--qpm-font-caption); }
.qpm-spec-strip { bottom: var(--qpm-space-6); }
.qpm-spec-strip-thumb { width: 40px; height: 24px; flex: none; object-fit: cover; border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-sm); }
.qpm-spec-strip-thumb[hidden] { display: none; }
.qpm-spec-strip-status { min-width: 64px; font-size: var(--qpm-font-caption); color: var(--qpm-text-muted); }
.qpm-spec-preview { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 9002; display: flex;
  flex-direction: column; gap: var(--qpm-space-4); padding: var(--qpm-space-4); background: var(--qpm-surface-1);
  border: 1px solid var(--qpm-accent-focus); border-radius: var(--qpm-radius-lg); box-shadow: var(--qpm-shadow-subtle);
  color: var(--qpm-text); font-family: var(--qpm-font); font-size: var(--qpm-font-body); }
.qpm-spec-preview-hd { display: flex; align-items: center; justify-content: space-between; gap: var(--qpm-space-4);
  font-weight: var(--qpm-weight-semibold); }
.qpm-spec-preview-img { display: block; max-width: min(80vw, 1200px); max-height: min(70vh, calc(100vh - 120px)); object-fit: contain;
  border-radius: var(--qpm-radius-md); }
.qpm-spec-preview-hint { font-size: var(--qpm-font-caption); color: var(--qpm-text-muted); }
/* Photo mode (S §9): QPM's page UI is marked by a qpm- class or id (or data-qpm); the strip and preview stay. */
html.${PHOTO_PAGE_CLASS} body > :is([class^="qpm-"], [class*=" qpm-"], [id^="qpm-"], [data-qpm]):not(.qpm-spec-photo-ui),
html.${PHOTO_PAGE_CLASS} body > :is([class^="qpm-"], [class*=" qpm-"], [id^="qpm-"], [data-qpm]):not(.qpm-spec-photo-ui) * {
  visibility: hidden !important; }
@media ${COMPACT_QUERY} {
  .qpm-spec-bar .qpm-spec-lbl { display: none; }
  .qpm-spec-bar .qpm-spec-ico { display: inline-flex; }
  .qpm-spec-bar .qpm-spec-name { max-width: 96px; }
  .qpm-spec-card { width: ${CARD_COMPACT_WIDTH}px; }
  .qpm-spec-card-label { display: none; }
  .qpm-spec-card-pet { grid-template-columns: auto 24px; }
  .qpm-spec-card-pet .qpm-spec-card-sprite { width: 24px; height: 24px; }
  .qpm-spec-strip-status { min-width: 0; max-width: 96px; overflow: hidden; text-overflow: ellipsis; }
}
`;

let users = 0;

/** Counted, so the bar and the info card (Task 6) can share the sheet; the returned release is idempotent. */
export function acquireSpectatorStyles(): () => void {
  if (users++ === 0 && !document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--users === 0) document.getElementById(STYLE_ID)?.remove();
  };
}
