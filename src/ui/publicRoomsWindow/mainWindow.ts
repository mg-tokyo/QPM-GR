import {
  fetchRooms,
  initPublicRooms,
  setConnectionStatusCallback,
  setErrorCallback,
  setPlayerFilter,
  setRoomsUpdateCallback,
  setSearchTerm,
  setSortBy,
} from '../../features/publicRooms';
import { t } from '../../i18n';
import { showToast } from './helpers';
import { openInspectorDirect } from './inspectorShell';
import { PR_STYLES } from './styles';
import {
  createAppContainer,
  renderRooms,
  showRoomsError,
  updateConnectionStatus,
} from './roomsList';

export function renderPublicRoomsWindow(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText = 'flex: 1; min-height: 0; overflow-y: auto; background: linear-gradient(135deg, rgba(33, 33, 33, 0.95) 0%, rgba(0, 0, 0, 0.95) 50%, rgba(22, 22, 44, 0.95) 100%);';

  if (!document.querySelector('#pr-style-block')) {
    const style = document.createElement('style');
    style.id = 'pr-style-block';
    style.textContent = PR_STYLES;
    document.head.appendChild(style);
  }

  const appEl = createAppContainer();
  root.appendChild(appEl);

  const searchInput = document.getElementById('pr-search-input') as HTMLInputElement | null;
  const playerFilter = document.getElementById('pr-player-filter') as HTMLSelectElement | null;
  const sortBy = document.getElementById('pr-sort-by') as HTMLSelectElement | null;
  const refreshBtn = document.getElementById('pr-refresh-btn');

  if (searchInput) {
    let timeout: number | null = null;
    const swallowKey = (e: Event): void => {
      e.stopPropagation();
      if (typeof (e as KeyboardEvent).stopImmediatePropagation === 'function') {
        (e as KeyboardEvent).stopImmediatePropagation();
      }
    };
    (['keydown', 'keyup', 'keypress'] as const).forEach(evt => searchInput.addEventListener(evt, swallowKey, true));
    searchInput.addEventListener('input', (e) => {
      if (timeout) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        setSearchTerm((e.target as HTMLInputElement).value);
      }, 200);
    });
  }

  playerFilter?.addEventListener('change', (e) => {
    setPlayerFilter((e.target as HTMLSelectElement).value as Parameters<typeof setPlayerFilter>[0]);
  });

  sortBy?.addEventListener('change', (e) => {
    setSortBy((e.target as HTMLSelectElement).value as Parameters<typeof setSortBy>[0]);
  });

  refreshBtn?.addEventListener('click', () => {
    fetchRooms();
    showToast(t('feature.publicRooms.refreshingRooms'), 'info');
  });

  setRoomsUpdateCallback(renderRooms);
  setConnectionStatusCallback(updateConnectionStatus);
  setErrorCallback(showRoomsError);

  initPublicRooms().catch(err => {
    showToast(t('feature.publicRooms.initFailed'), 'error');
    console.error('[PublicRooms] init failed', err);
  });

  // Debug hook: open inspector by playerId directly (no room required)
  if (!(window as any).QPM_INSPECT_PLAYER) {
    (window as any).QPM_INSPECT_PLAYER = (playerId: string, playerName?: string): void => openInspectorDirect(playerId, playerName);
  }
}
