import type { RoomsMap, Room, RoomUserSlot, PublicRoomsState } from '../../../types/publicRooms';
import { escapeHtml } from '../../core/panelHelpers';
import { getState, fetchRooms, setSearchTerm } from '../../../features/standalone/publicRooms';
import {
  sanitizeImageUrl,
  clearNode,
  formatUpdatedAgo,
  formatRoomLabel,
  roomOriginLabel,
  avatarInitials,
  showToast,
} from './helpers';
import { openInspector } from './inspectorShell';
import { createEmptyState } from '../../components/emptyState';
import { t } from '../../../i18n';

export function setRoomStatPills(totalRooms: number, visibleRooms: number, lastUpdatedAt?: string | null): void {
  const totalEl = document.getElementById('pr-total-rooms-pill');
  const visibleEl = document.getElementById('pr-visible-rooms-pill');
  const updatedEl = document.getElementById('pr-last-updated-pill');
  if (totalEl) totalEl.textContent = t('feature.publicRooms.roomsCount', { count: totalRooms });
  if (visibleEl) visibleEl.textContent = t('feature.publicRooms.showingCount', { count: visibleRooms });
  if (updatedEl) {
    if (lastUpdatedAt) {
      const d = new Date(lastUpdatedAt);
      updatedEl.textContent = t('feature.publicRooms.updatedAt', { time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    } else {
      updatedEl.textContent = t('feature.publicRooms.updatedDefault');
    }
  }
}

export function createAppContainer(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'pr-app';

  container.innerHTML = `
    <div class="pr-hero">
      <div>
        <div style="font-size: 12px; letter-spacing: 0.3px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">${t('feature.publicRooms.liveDirectory')}</div>
        <h3 style="display: flex; align-items: center; gap: 8px;">
          🌐 ${t('feature.publicRooms.title')}
        </h3>
        <p>${t('feature.publicRooms.heroDesc')}</p>
        <div class="pr-hero-badges">
          <span class="pr-badge pr-badge-ghost">${t('feature.publicRooms.poweredByAries')}</span>
          <span id="pr-connection-status" class="pr-badge pr-badge-status pr-status-connecting">🔄 ${t('feature.publicRooms.statusConnecting')}</span>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button id="pr-refresh-btn" class="qpm-button qpm-button--positive" style="padding: 10px 16px; font-weight: 700;">🔄 ${t('feature.publicRooms.refresh')}</button>
      </div>
    </div>

    <div class="pr-stats" data-tour="pr-stats">
      <div class="pr-stat">
        <div class="pr-stat-label">${t('feature.publicRooms.roomsLabel')}</div>
        <div id="pr-total-rooms-pill" class="pr-stat-value">${t('feature.publicRooms.roomsDefault')}</div>
      </div>
      <div class="pr-stat">
        <div class="pr-stat-label">${t('feature.publicRooms.visibleLabel')}</div>
        <div id="pr-visible-rooms-pill" class="pr-stat-value">${t('feature.publicRooms.showingDefault')}</div>
      </div>
      <div class="pr-stat">
        <div class="pr-stat-label">${t('feature.publicRooms.lastUpdateLabel')}</div>
        <div id="pr-last-updated-pill" class="pr-stat-value">${t('feature.publicRooms.updatedDefault')}</div>
      </div>
    </div>

    <div class="pr-controls" data-tour="pr-controls">
      <div class="pr-control">
        <label>🔎 ${t('feature.publicRooms.searchLabel')}</label>
        <input type="text" id="pr-search-input" class="qpm-input" placeholder="${t('feature.publicRooms.searchPlaceholder')}" />
      </div>
      <div class="pr-control">
        <label>👥 ${t('feature.publicRooms.playerCountLabel')}</label>
        <select id="pr-player-filter" class="qpm-select">
          <option value="all">${t('feature.publicRooms.allRooms')}</option>
          <option value="low">${t('feature.publicRooms.fewPlayers')}</option>
          <option value="medium">${t('feature.publicRooms.somePlayers')}</option>
          <option value="high">${t('feature.publicRooms.manyPlayers')}</option>
        </select>
      </div>
      <div class="pr-control">
        <label>📊 ${t('feature.publicRooms.sortByLabel')}</label>
        <select id="pr-sort-by" class="qpm-select">
          <option value="name">${t('feature.publicRooms.sortRoomCode')}</option>
          <option value="players-desc" selected>${t('feature.publicRooms.sortMostPlayers')}</option>
          <option value="players-asc">${t('feature.publicRooms.sortLeastPlayers')}</option>
        </select>
      </div>
    </div>

    <div style="margin-top: 18px; display: flex; align-items: center; gap: 10px; color: #cbd5e1; font-weight: 700; letter-spacing: 0.2px;">
      <span style="font-size: 18px;">🎮</span> <span>${t('feature.publicRooms.availableRooms')}</span>
    </div>
    <div id="pr-rooms-list" class="pr-grid" data-tour="pr-rooms-grid">
      <p style="text-align: center; color: #aaa; grid-column: 1/-1; font-size: 14px;">${t('feature.publicRooms.loadingRooms')}</p>
    </div>
  `;

  return container;
}

export function playerChip(slot: RoomUserSlot): string {
  const avatarUrl = sanitizeImageUrl(slot.avatarUrl);
  const safeAvatarUrl = avatarUrl ? `url("${avatarUrl}")` : '';
  const avatar = safeAvatarUrl
    ? `<span style="width: 20px; height: 20px; border-radius: 50%; background-image: ${safeAvatarUrl}; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,0.15);"></span>`
    : '<span style="font-size: 12px; opacity: 0.7;">User</span>';
  return `
    <span class="pr-player-chip" data-player-name="${escapeHtml(slot.name || '')}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: #fff; font-size: 12px; font-weight: 600;">
      ${avatar}
      ${escapeHtml(slot.name || 'Unknown')}
    </span>
  `;
}

export function openPlayersModal(room: Room): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;';

  const card = document.createElement('div');
  card.style.cssText = 'width: min(520px, 100%); max-height: 80vh; overflow: auto; background: #111827; border: 2px solid rgba(66,165,245,0.35); border-radius: 10px; padding: 18px; color: #fff; box-shadow: 0 12px 32px rgba(0,0,0,0.4);';

  const players = room.userSlots || [];
  const close = (): void => overlay.remove();

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';

  const headerText = document.createElement('div');
  const title = document.createElement('div');
  title.style.cssText = 'font-size: 18px; font-weight: 700;';
  title.textContent = t('feature.publicRooms.playersInRoom', { roomId: room.id });
  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'font-size: 12px; color: #9CA3AF;';
  subtitle.textContent = players.length === 1 ? t('feature.publicRooms.visiblePlayerCount', { count: players.length }) : t('feature.publicRooms.visiblePlayerCounts', { count: players.length });
  headerText.append(title, subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'qpm-button qpm-button--neutral';
  closeBtn.style.cssText = 'padding: 6px 12px;';
  closeBtn.textContent = t('common.close');
  closeBtn.addEventListener('click', close);
  header.append(headerText, closeBtn);

  const body = document.createElement('div');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

  if (players.length === 0) {
    body.appendChild(createEmptyState(t('feature.publicRooms.noPlayersModal')));
  } else {
    players.forEach((slot) => {
      const row = document.createElement('div');
      row.className = 'qpm-card';
      row.style.cssText = 'padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; gap: 10px;';

      const safeAvatar = sanitizeImageUrl(slot.avatarUrl);
      if (safeAvatar) {
        const avatar = document.createElement('img');
        avatar.src = safeAvatar;
        avatar.alt = 'avatar';
        avatar.style.cssText = 'width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); object-fit: cover;';
        row.appendChild(avatar);
      } else {
        const fallback = document.createElement('div');
        fallback.style.cssText = 'width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.08); display: grid; place-items: center; color: #9CA3AF;';
        fallback.textContent = avatarInitials(slot.name);
        row.appendChild(fallback);
      }

      const info = document.createElement('div');
      info.style.cssText = 'flex: 1;';
      const playerName = document.createElement('div');
      playerName.style.cssText = 'font-size: 14px; font-weight: 700;';
      playerName.textContent = slot.name || t('feature.publicRooms.unknownPlayer');
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size: 12px; color: #9CA3AF;';
      hint.textContent = t('feature.publicRooms.tapToSearch');
      info.append(playerName, hint);
      row.appendChild(info);

      const searchBtn = document.createElement('button');
      searchBtn.className = 'qpm-button qpm-button--neutral';
      searchBtn.style.cssText = 'padding: 6px 10px; font-size: 12px;';
      searchBtn.textContent = t('common.search');
      searchBtn.addEventListener('click', () => {
        const searchInput = document.getElementById('pr-search-input') as HTMLInputElement | null;
        const name = slot.name || '';
        if (searchInput) searchInput.value = name;
        setSearchTerm(name);
        close();
      });
      row.appendChild(searchBtn);

      body.appendChild(row);
    });
  }

  card.append(header, body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

export function renderRooms(rooms: RoomsMap): void {
  const roomsList = document.getElementById('pr-rooms-list');
  if (!roomsList) return;

  clearNode(roomsList);
  const roomKeys = Object.keys(rooms);
  const totalRooms = Object.keys(getState().allRooms || {}).length;
  setRoomStatPills(totalRooms, roomKeys.length, getState().lastUpdatedAt);

  if (roomKeys.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'text-align: center; color: #aaa; grid-column: 1/-1; font-size: 14px;';
    empty.textContent = t('feature.publicRooms.noRoomsFound');
    roomsList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  roomKeys.forEach((roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    const playerCount = room.playersCount || 0;
    let playerBadgeColor = '#666';
    let playerBgColor = 'rgba(102, 102, 102, 0.2)';
    const isFull = playerCount >= 6;
    if (isFull) {
      playerBadgeColor = '#f44336';
      playerBgColor = 'rgba(244, 67, 54, 0.25)';
    } else if (playerCount >= 5) {
      playerBadgeColor = '#4fd18b';
      playerBgColor = 'rgba(79, 209, 139, 0.2)';
    } else if (playerCount >= 3) {
      playerBadgeColor = '#ffb347';
      playerBgColor = 'rgba(255, 179, 71, 0.2)';
    } else if (playerCount >= 1) {
      playerBadgeColor = '#8f82ff';
      playerBgColor = 'rgba(143, 130, 255, 0.2)';
    }

    const roomLabel = formatRoomLabel(room.id);
    const origin = roomOriginLabel(room.id);
    const originBadgeColor = origin === 'Discord' ? '#7289DA' : '#26A69A';
    const originBgColor = origin === 'Discord' ? 'rgba(114, 137, 218, 0.2)' : 'rgba(38, 166, 154, 0.2)';

    const roomCard = document.createElement('div');
    roomCard.className = 'pr-room-card';

    const headerEl = document.createElement('div');
    headerEl.className = 'pr-room-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'pr-room-title';

    const privacyPill = document.createElement('span');
    privacyPill.className = `pr-pill ${room.isPrivate ? 'pr-pill-private' : 'pr-pill-public'}`;
    privacyPill.textContent = room.isPrivate ? t('feature.publicRooms.private') : t('feature.publicRooms.public');

    const roomLabelEl = document.createElement('span');
    roomLabelEl.style.cssText = 'font-size: 18px;';
    roomLabelEl.title = room.id;
    roomLabelEl.textContent = roomLabel;

    const originPill = document.createElement('span');
    originPill.className = 'pr-pill';
    originPill.style.cssText = `background: ${originBgColor}; border: 1px solid ${originBadgeColor}; color: ${originBadgeColor};`;
    originPill.textContent = origin;

    titleWrap.append(privacyPill, roomLabelEl, originPill);

    const count = document.createElement('div');
    count.className = 'pr-player-count';
    count.style.cssText = `background: ${playerBgColor}; border-color: ${playerBadgeColor}; color: ${playerBadgeColor};`;
    const countIcon = document.createElement('span');
    countIcon.textContent = t('feature.publicRooms.players');
    const countValue = document.createElement('span');
    countValue.textContent = String(playerCount);
    count.append(countIcon, countValue);

    headerEl.append(titleWrap, count);
    roomCard.appendChild(headerEl);

    const metaLine = document.createElement('div');
    metaLine.className = 'pr-meta-line';
    const updated = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = 'pr-dot';
    updated.append(dot, document.createTextNode(` ${t('feature.publicRooms.updatedAgo', { ago: formatUpdatedAgo(room.lastUpdatedAt) })}`));

    const code = document.createElement('span');
    code.textContent = t('feature.publicRooms.codeLabel');
    const codeEl = document.createElement('code');
    codeEl.style.color = '#e2e8f0';
    codeEl.textContent = room.id;
    code.appendChild(codeEl);
    metaLine.append(updated, code);
    roomCard.appendChild(metaLine);

    if (room.userSlots && room.userSlots.length > 0) {
      const stack = document.createElement('div');
      stack.className = 'pr-avatar-stack';
      stack.dataset.tour = 'pr-avatar-stack';

      room.userSlots.slice(0, 6).forEach((slot) => {
        const avatarWrap = document.createElement('span');
        avatarWrap.className = 'pr-avatar';
        const safeAvatar = sanitizeImageUrl(slot.avatarUrl);
        if (safeAvatar) {
          const avatar = document.createElement('img');
          avatar.src = safeAvatar;
          avatar.alt = 'avatar';
          avatarWrap.appendChild(avatar);
        } else {
          avatarWrap.textContent = avatarInitials(slot.name);
        }
        avatarWrap.addEventListener('click', () => {
          openInspector(slot ?? null, room);
        });
        stack.appendChild(avatarWrap);
      });

      if (room.userSlots.length > 6) {
        const extra = document.createElement('span');
        extra.className = 'pr-avatar';
        extra.style.cssText = 'background: rgba(148,163,184,0.2); color: #fff;';
        extra.textContent = `+${room.userSlots.length - 6}`;
        stack.appendChild(extra);
      }

      roomCard.appendChild(stack);
    } else {
      const emptyPlayers = document.createElement('div');
      emptyPlayers.className = 'pr-players-empty';
      emptyPlayers.textContent = t('feature.publicRooms.noVisiblePlayers');
      roomCard.appendChild(emptyPlayers);
    }

    const hintLine = document.createElement('div');
    hintLine.className = 'pr-hint-line';
    hintLine.textContent = t('feature.publicRooms.tapAvatarHint');
    roomCard.appendChild(hintLine);

    const actions = document.createElement('div');
    actions.className = 'pr-room-actions';

    const joinBtn = document.createElement('button');
    joinBtn.className = `qpm-button ${isFull ? 'qpm-button--negative' : 'qpm-button--positive'} pr-join-btn`;
    joinBtn.style.cssText = `flex: 1; padding: 10px; font-size: 14px; font-weight: 700; ${isFull ? 'background: linear-gradient(135deg, rgba(229,57,53,0.85), rgba(183,28,28,0.9)); border: 2px solid rgba(229,57,53,0.9); color: #fff;' : ''}`;
    joinBtn.textContent = isFull ? t('feature.publicRooms.fullBtn') : t('feature.publicRooms.joinBtn');
    joinBtn.addEventListener('click', () => {
      if (/^[a-zA-Z0-9_-]{1,64}$/.test(roomCode)) {
        window.location.href = `/r/${roomCode}`;
      }
    });

    const viewBtn = document.createElement('button');
    viewBtn.className = 'qpm-button qpm-button--neutral pr-view-btn';
    viewBtn.style.cssText = 'padding: 10px; font-size: 14px; font-weight: 700;';
    viewBtn.textContent = t('feature.publicRooms.players');
    viewBtn.addEventListener('click', () => {
      if (!room.userSlots || room.userSlots.length === 0) {
        showToast(t('feature.publicRooms.noPlayersInRoom'), 'info');
        return;
      }
      openPlayersModal(room);
    });

    actions.append(joinBtn, viewBtn);
    roomCard.appendChild(actions);
    fragment.appendChild(roomCard);
  });

  roomsList.appendChild(fragment);
}

export function showRoomsError(message: string): void {
  const roomsList = document.getElementById('pr-rooms-list');
  if (!roomsList) return;

  clearNode(roomsList);
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'text-align: center; color: var(--qpm-danger); grid-column: 1/-1; padding: 40px;';

  const icon = document.createElement('div');
  icon.style.cssText = 'font-size: 32px; margin-bottom: 16px;';
  icon.textContent = '!';

  const text = document.createElement('p');
  text.style.cssText = 'font-size: 14px; margin-bottom: 16px;';
  text.textContent = message;

  const retryBtn = document.createElement('button');
  retryBtn.id = 'pr-retry-fetch-btn';
  retryBtn.style.cssText = 'padding: 10px 20px; background: var(--qpm-accent-subtle); border: 2px solid var(--qpm-accent); border-radius: 6px; color: var(--qpm-accent); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;';
  retryBtn.textContent = t('feature.publicRooms.retry');
  retryBtn.addEventListener('click', () => {
    clearNode(roomsList);
    const loading = document.createElement('p');
    loading.style.cssText = 'text-align: center; color: #aaa; grid-column: 1/-1; font-size: 14px;';
    loading.textContent = t('feature.publicRooms.loadingRooms');
    roomsList.appendChild(loading);
    fetchRooms();
  });

  wrapper.append(icon, text, retryBtn);
  roomsList.appendChild(wrapper);
}

export function updateConnectionStatus(status: PublicRoomsState['connectionStatus']): void {
  const statusEl = document.getElementById('pr-connection-status');
  const roomsList = document.getElementById('pr-rooms-list');

  const statusConfig = {
    connecting: { text: `🔄 ${t('feature.publicRooms.statusConnecting')}`, color: '#8f82ff' },
    connected: { text: `✅ ${t('feature.publicRooms.statusConnected')}`, color: '#4fd18b' },
    failed: { text: `❌ ${t('feature.publicRooms.statusFailed')}`, color: '#f44336' },
    retrying: { text: `🔄 ${t('feature.publicRooms.statusRetrying')}`, color: '#ffb347' },
  };

  if (statusEl) {
    const cfg = statusConfig[status];
    statusEl.textContent = cfg.text;
    statusEl.style.color = cfg.color;
  }

  if (roomsList && (status === 'connecting' || status === 'retrying')) {
    roomsList.innerHTML = `
      <div style="text-align: center; color: #aaa; grid-column: 1/-1; padding: 40px;">
        <div style="font-size: 32px; margin-bottom: 16px;">🔄</div>
        <p style="font-size: 14px; margin-bottom: 8px;">${status === 'connecting' ? t('feature.publicRooms.connectingMsg') : t('feature.publicRooms.retryingMsg')}</p>
        <p style="font-size: 12px; color: #666;">${t('feature.publicRooms.mayTakeSeconds')}</p>
      </div>
    `;
  }
}
