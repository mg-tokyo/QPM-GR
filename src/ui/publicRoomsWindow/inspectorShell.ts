import type { RoomUserSlot, Room } from '../../types/publicRooms';
import { getPlayerView, getCachedFriendsSet } from '../../services/ariesPlayers';
import { inspectorState, inspectorDragCleanups } from './state';
import {
  sanitizeImageUrl,
  setAllPanes,
  formatUpdatedAgo,
  avatarInitials,
  showToast,
  inferSelfPlayerId,
} from './helpers';
import { renderInspectorPanes } from './inspectorPanes';
import { t } from '../../i18n';

export function destroyPublicRoomsInspector(): void {
  for (const cleanup of inspectorDragCleanups) {
    cleanup();
  }
  inspectorDragCleanups.length = 0;
  const shell = document.getElementById('pr-inspector-shell');
  shell?.remove();
}

function ensureInspectorShell(): HTMLDivElement {
  let shell = document.getElementById('pr-inspector-shell') as HTMLDivElement | null;
  if (shell) return shell;

  shell = document.createElement('div');
  shell.id = 'pr-inspector-shell';
  shell.className = 'pr-inspector hidden';
  shell.innerHTML = `
    <div class="pr-inspector-overlay"></div>
    <div class="pr-inspector-panel">
      <div class="pr-inspector-header" id="pr-drag-handle">
        <div class="pr-drag-indicator">⋮</div>
        <div class="pr-inspector-identity">
          <div id="pr-inspector-avatar" class="pr-inspector-avatar">👤</div>
          <div>
            <div id="pr-inspector-name" class="pr-inspector-name">${t('feature.publicRooms.playerLabel')}</div>
            <div id="pr-inspector-sub" class="pr-inspector-sub">${t('feature.publicRooms.roomDefault')}</div>
          </div>
        </div>
        <div class="pr-inspector-actions">
          <button id="pr-inspector-refresh" class="qpm-button qpm-button--primary" title="${t('feature.publicRooms.refreshPlayerData')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
          </button>
          <button id="pr-inspector-close" class="qpm-button qpm-button--negative" title="${t('feature.publicRooms.closeInspector')}">✕</button>
        </div>
      </div>
      <div class="pr-inspector-tabs">
        <button class="pr-inspector-tab active" data-tab="player">${t('feature.publicRooms.playerLabel')}</button>
        <button class="pr-inspector-tab" data-tab="compare">${t('feature.publicRooms.compareTab')}</button>
      </div>
      <div class="pr-inspector-body">
        <div id="pr-tab-player" class="pr-inspector-pane active">
          <div class="pr-pane-card">
            <div class="pr-pane-title">${t('feature.publicRooms.overviewTitle')}</div>
            <div id="pr-overview-content" class="pr-pane-placeholder">${t('feature.publicRooms.overviewPlaceholder')}</div>
          </div>
          <div class="pr-pane-card collapsible">
            <div class="pr-pane-title">${t('feature.publicRooms.gardenTitle')}</div>
            <div id="pr-pets-content" class="pr-pane-placeholder">${t('feature.publicRooms.gardenPlaceholder')}</div>
          </div>
          <div class="pr-pane-card collapsible">
            <div class="pr-pane-title">${t('feature.publicRooms.inventoryTitle')}</div>
            <div id="pr-inventory-content" class="pr-pane-placeholder">${t('feature.publicRooms.inventoryPlaceholder')}</div>
          </div>
          <div class="pr-pane-card collapsible">
            <div class="pr-pane-title">${t('feature.publicRooms.activityTitle')}</div>
            <div id="pr-activity-content" class="pr-pane-placeholder">${t('feature.publicRooms.activityPlaceholder')}</div>
          </div>
        </div>

        <div id="pr-tab-compare" class="pr-inspector-pane">
          <div class="pr-pane-card">
            <div class="pr-pane-title">${t('feature.publicRooms.compareTitle')}</div>
            <div class="pr-pane-placeholder">${t('feature.publicRooms.comparePlaceholder')}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(shell);

  const close = (): void => shell?.classList.add('hidden');
  shell.querySelector('#pr-inspector-close')?.addEventListener('click', close);
  shell.querySelector('.pr-inspector-overlay')?.addEventListener('click', close);

  shell.querySelectorAll('.pr-inspector-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab');
      shell?.querySelectorAll('.pr-inspector-tab').forEach(t => t.classList.remove('active'));
      shell?.querySelectorAll('.pr-inspector-pane').forEach(p => p.classList.remove('active'));
      (e.currentTarget as HTMLElement).classList.add('active');
      const pane = tab ? shell?.querySelector(`#pr-tab-${tab}`) : null;
      pane?.classList.add('active');
    });
  });

  if (!shell.dataset.prRefreshBound) {
    shell.querySelector('#pr-inspector-refresh')?.addEventListener('click', () => refreshInspectorData(true));
    shell.dataset.prRefreshBound = '1';
  }

  // Make inspector draggable
  if (!shell.dataset.prDraggableBound) {
    const dragHandle = shell.querySelector('#pr-drag-handle') as HTMLElement | null;
    const panel = shell.querySelector('.pr-inspector-panel') as HTMLElement | null;

    if (dragHandle && panel) {
      let isDragging = false;
      let currentX = 0;
      let currentY = 0;
      let initialX = 0;
      let initialY = 0;

      dragHandle.addEventListener('mousedown', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('.pr-inspector-actions') || target.closest('button')) return;

        isDragging = true;
        const rect = panel.getBoundingClientRect();
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;

        panel.style.transition = 'none';
        dragHandle.style.cursor = 'grabbing';
      });

      const onMouseMove = (e: MouseEvent): void => {
        if (!isDragging) return;

        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        const panelRect = panel.getBoundingClientRect();
        const maxX = window.innerWidth - panelRect.width;
        const maxY = window.innerHeight - panelRect.height;

        currentX = Math.max(0, Math.min(currentX, maxX));
        currentY = Math.max(0, Math.min(currentY, maxY));

        panel.style.left = `${currentX}px`;
        panel.style.top = `${currentY}px`;
        panel.style.transform = 'none';
      };

      const onMouseUp = (): void => {
        if (isDragging) {
          isDragging = false;
          panel.style.transition = '';
          dragHandle.style.cursor = '';
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      inspectorDragCleanups.push(
        () => document.removeEventListener('mousemove', onMouseMove),
        () => document.removeEventListener('mouseup', onMouseUp),
      );
    }

    shell.dataset.prDraggableBound = '1';
  }

  return shell;
}

export function openInspector(slot: RoomUserSlot | null, room: Room): void {
  const shell = ensureInspectorShell();
  const avatarEl = shell.querySelector('#pr-inspector-avatar') as HTMLElement | null;
  const nameEl = shell.querySelector('#pr-inspector-name') as HTMLElement | null;
  const subEl = shell.querySelector('#pr-inspector-sub') as HTMLElement | null;

  if (avatarEl) {
    const safeAvatar = sanitizeImageUrl(slot?.avatarUrl);
    if (safeAvatar) {
      avatarEl.style.backgroundImage = `url("${safeAvatar}")`;
      avatarEl.textContent = '';
      avatarEl.classList.add('has-img');
    } else {
      avatarEl.style.backgroundImage = 'none';
      avatarEl.textContent = avatarInitials(slot?.name ?? '');
      avatarEl.classList.remove('has-img');
    }
  }

  if (nameEl) nameEl.textContent = slot?.name || t('feature.publicRooms.unknownPlayer');
  if (subEl) subEl.textContent = t('feature.publicRooms.roomSub', { roomId: room.id, ago: formatUpdatedAgo(room.lastUpdatedAt) });

  inspectorState.targetPlayerId = slot?.playerId ?? null;
  inspectorState.targetPlayerName = slot?.name || '';
  inspectorState.targetRoomId = room.id;

  if (!inspectorState.targetPlayerId) {
    setAllPanes(t('feature.publicRooms.noPlayerId'));
  } else {
    setAllPanes(t('feature.publicRooms.loadingPlayerView'));
    refreshInspectorData(false).catch(err => {
      console.error('[PublicRooms] Inspector refresh failed', err);
      setAllPanes(t('feature.publicRooms.unableToLoadView'));
    });
  }

  shell.classList.remove('hidden');
}

export function openInspectorDirect(playerId: string, playerName?: string | null): void {
  const pid = (playerId || '').trim();
  if (!pid) {
    console.warn('[PublicRooms] Missing playerId for inspector');
    return;
  }

  const shell = ensureInspectorShell();
  const avatarEl = shell.querySelector('#pr-inspector-avatar') as HTMLElement | null;
  const nameEl = shell.querySelector('#pr-inspector-name') as HTMLElement | null;
  const subEl = shell.querySelector('#pr-inspector-sub') as HTMLElement | null;

  if (avatarEl) {
    avatarEl.style.backgroundImage = 'none';
    avatarEl.textContent = avatarInitials(playerName ?? pid);
    avatarEl.classList.remove('has-img');
  }
  if (nameEl) nameEl.textContent = playerName || pid;
  if (subEl) subEl.textContent = t('feature.publicRooms.inspectorDirect');

  inspectorState.targetPlayerId = pid;
  inspectorState.targetPlayerName = playerName || pid;
  inspectorState.targetRoomId = 'debug';

  setAllPanes(t('feature.publicRooms.loadingPlayerView'));
  shell.classList.remove('hidden');
  refreshInspectorData(false).catch(err => {
    console.error('[PublicRooms] Inspector direct refresh failed', err);
    setAllPanes(t('feature.publicRooms.unableToLoadView'));
  });
}

async function refreshInspectorData(notify = false): Promise<void> {
  const targetId = inspectorState.targetPlayerId;

  if (!targetId) {
    setAllPanes(t('feature.publicRooms.noPlayerIdShort'));
    return;
  }

  setAllPanes(t('feature.publicRooms.loadingPlayerView'));

  let friends: Set<string> | null = null;
  const myPlayerId = inferSelfPlayerId();
  if (myPlayerId) {
    try {
      friends = await getCachedFriendsSet(myPlayerId);
    } catch (err) {
      console.warn('[PublicRooms] Friends lookup failed', err);
    }
  }

  const res = await getPlayerView(targetId);
  if (!res || res.error || !res.data) {
    const msg = res?.status === 401 ? t('feature.publicRooms.unauthorized') : (res?.error || t('feature.publicRooms.unableToLoadView'));
    setAllPanes(msg);
    return;
  }

  const isFriend = true;
  await renderInspectorPanes(res.data, isFriend);
  if (notify) showToast(t('feature.publicRooms.inspectorRefreshed'), 'success');
}
