export const SR_STYLE_CSS = `
    .qpm-sr-metric[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 8px;
      padding: 8px 12px;
      background: var(--qpm-surface-window);
      border: 1px solid var(--qpm-border);
      border-radius: 8px;
      color: var(--qpm-text);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.5;
      white-space: pre-line;
      z-index: 100;
      box-shadow: var(--qpm-shadow-subtle);
      pointer-events: none;
    }
    .qpm-sr-th { cursor:pointer; user-select:none; }
    .qpm-sr-th:hover { opacity:1 !important; }
    .qpm-sr-tr { cursor:pointer; transition:background 0.12s; }
    .qpm-sr-tr:hover { background:var(--qpm-accent-tint); }
  `;

export const FILTER_LABEL_KEYS: Record<string, string> = {
  all: 'feature.shopRestock.filterAll',
  celestial: 'feature.shopRestock.filterCelestial',
  seed: 'feature.shopRestock.filterSeeds',
  egg: 'feature.shopRestock.filterEggs',
  decor: 'feature.shopRestock.filterDecor',
  tool: 'feature.shopRestock.filterTools',
  dawn: 'feature.shopRestock.filterDawn',
  snow: 'feature.shopRestock.filterSnow',
  weather: 'feature.shopRestock.filterWeather',
};

export const DEFAULT_PINNED_MAX = 'min(240px,35vh)';
export const MIN_PINNED = 40;
export const MIN_HIST = 60;

export const TH_BASE = 'padding:8px 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--qpm-text-muted);position:sticky;top:0;background:var(--qpm-surface-window);z-index:1;';
