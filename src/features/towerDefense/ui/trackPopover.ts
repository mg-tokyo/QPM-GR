import { t } from '../../../i18n';
import { getMatchSnapshot, onMatchChange } from '../state';
import type { MatchSnapshot } from '../types';
import { renderBoardThumbnail } from '../saves/thumbnail';
import { canSwitchTrack, switchTrack } from '../tracks/active';
import {
  getDifficultyLabel,
  getTrackDifficulty,
  getTrackDisplayName,
  getTrackLength,
  listTracks,
} from '../tracks/registry';
import type { TrackDef } from '../tracks/types';

const THUMB_WIDTH = 92;

export interface TrackPopoverHandle {
  readonly root: HTMLElement;
  toggle(): void;
  close(): void;
  destroy(): void;
  refresh(): void;
}

export function createTrackPopover(): TrackPopoverHandle {
  const root = document.createElement('div');
  root.className = 'qpm-td-tracks-popover';
  root.hidden = true;

  const title = document.createElement('div');
  title.className = 'qpm-td-tracks-title';
  title.textContent = t('feature.towerDefense.tracks.title');

  const hint = document.createElement('div');
  hint.className = 'qpm-td-tracks-hint';

  const list = document.createElement('div');
  list.className = 'qpm-td-tracks-list';
  root.append(title, hint, list);

  let outsideHandler: ((e: MouseEvent) => void) | null = null;
  // Rebuild rows only when something the rows show has changed — the snapshot
  // notifies every sim tick once a round is running.
  let lastKey = '';

  function rowKey(snap: MatchSnapshot): string {
    return `${snap.trackId}|${canSwitchTrack(snap) ? 1 : 0}|${listTracks().length}`;
  }

  function buildRow(track: TrackDef, snap: MatchSnapshot, locked: boolean): HTMLElement {
    const isActive = track.id === snap.trackId;
    const row = document.createElement('div');
    row.className = 'qpm-td-track-row';
    if (isActive) row.classList.add('qpm-td-track-row--active');
    if (!locked) {
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const pick = (): void => {
        void switchTrack(track.id).then((res) => { if (res.ok) close(); });
      };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    }

    const thumb = renderBoardThumbnail({ corners: track.corners, towers: [], width: THUMB_WIDTH });
    if (thumb) { thumb.className = 'qpm-td-track-thumb'; row.appendChild(thumb); }

    const body = document.createElement('div');
    body.className = 'qpm-td-track-body';
    const head = document.createElement('div');
    head.className = 'qpm-td-track-head';
    const name = document.createElement('span');
    name.className = 'qpm-td-track-name';
    name.textContent = getTrackDisplayName(track);
    head.appendChild(name);
    if (isActive) {
      const badge = document.createElement('span');
      badge.className = 'qpm-td-track-badge';
      badge.textContent = t('feature.towerDefense.tracks.active');
      head.appendChild(badge);
    }
    const meta = document.createElement('div');
    meta.className = 'qpm-td-track-meta';
    const difficulty = getTrackDifficulty(track);
    const chip = document.createElement('span');
    chip.className = `qpm-td-track-chip qpm-td-track-chip--${difficulty}`;
    chip.textContent = getDifficultyLabel(difficulty);
    const tiles = document.createElement('span');
    tiles.textContent = t('feature.towerDefense.tracks.tiles', { n: getTrackLength(track) });
    meta.append(chip, tiles);
    body.append(head, meta);
    row.appendChild(body);
    return row;
  }

  function render(): void {
    const snap = getMatchSnapshot();
    const locked = !canSwitchTrack(snap);
    root.classList.toggle('qpm-td-tracks-popover--locked', locked);
    hint.textContent = locked
      ? t('feature.towerDefense.tracks.locked')
      : t('feature.towerDefense.tracks.hint');
    list.replaceChildren(...listTracks().map((tr) => buildRow(tr, snap, locked)));
    lastKey = rowKey(snap);
  }

  function open(): void {
    render();
    root.hidden = false;
    if (outsideHandler) return;
    outsideHandler = (e) => {
      const target = e.target;
      if (target instanceof Node && root.contains(target)) return;
      close();
    };
    // Deferred one frame so the click that opened it doesn't immediately close it.
    requestAnimationFrame(() => {
      if (outsideHandler) document.addEventListener('mousedown', outsideHandler, true);
    });
  }

  function close(): void {
    root.hidden = true;
    if (outsideHandler) {
      document.removeEventListener('mousedown', outsideHandler, true);
      outsideHandler = null;
    }
  }

  function toggle(): void {
    if (root.hidden) open(); else close();
  }

  const unsub = onMatchChange((snap) => {
    if (root.hidden) return;
    if (rowKey(snap) !== lastKey) render();
  });

  function destroy(): void {
    unsub();
    close();
    try { root.remove(); } catch { /* already gone */ }
  }

  return { root, toggle, close, destroy, refresh: render };
}
