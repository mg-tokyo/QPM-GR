import {
  getActiveCustomSkin,
  onStateChange,
} from '../../features/bloblingCustomiser/customSkins';

/**
 * Render a small ★ corner badge on a cosmetic tile when an active custom
 * exists for the filename. Subscribes to the custom-skins update event so
 * the badge appears/disappears on every state change without polling.
 *
 * Spec §3.2.
 */
export function mountCustomsBadge(
  cell: HTMLElement,
  filename: string,
): () => void {
  const badge = document.createElement('span');
  badge.textContent = '★';   // ★
  badge.style.cssText = [
    'position:absolute',
    'top:2px',
    'right:2px',
    'font-size:9px',
    'color:#ffe66b',
    'text-shadow:0 1px 2px rgba(0,0,0,0.8)',
    'pointer-events:none',
    'z-index:2',
    'display:none',
  ].join(';');
  cell.appendChild(badge);

  function refresh(): void {
    badge.style.display = getActiveCustomSkin(filename) ? 'block' : 'none';
  }
  refresh();

  const unsubscribe = onStateChange(refresh);

  return () => {
    unsubscribe();
    badge.remove();
  };
}
