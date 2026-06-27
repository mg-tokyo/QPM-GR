export function buildRuleBadge(type: 'swap' | 'mutation' | 'transparency', color?: string): HTMLElement {
  const badge = document.createElement('div');
  const colors: Record<string, string> = {
    swap: 'linear-gradient(135deg,var(--qpm-accent),#6c5ce7)',
    mutation: color ? `linear-gradient(135deg,${color},${color})` : 'linear-gradient(135deg,#f0c040,#e6a817)',
    transparency: 'linear-gradient(135deg,var(--qpm-info),var(--qpm-credits))',
  };
  // Glyphs are symbolic indicators (swap-arrows, sparkle, half-moon). They are
  // not decorative emoji and there is no sprite/CSS equivalent yet — deferred
  // to the icon system per .claude/docs/audit-manifest.md row #30.
  const icons: Record<string, string> = {
    swap: '⇄',
    mutation: '✦',
    transparency: '◐',
  };
  badge.style.cssText = [
    'width:22px;height:22px',
    'border-radius:50%',
    'border:2px solid var(--qpm-surface-window)',
    `background:${colors[type]}`,
    'display:flex;align-items:center;justify-content:center',
    'font-size:13px;color:var(--qpm-text);line-height:1',
    'flex-shrink:0',
    'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
  ].join(';');
  badge.textContent = icons[type] ?? '';
  badge.title = type;
  return badge;
}
