import { createNamedLogger } from '../../diagnostics/logger';
import { healthBus } from '../../diagnostics/healthBus';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';
import { storage } from '../../utils/storage';
import type {
  PublicRoomsConfig,
  PublicRoomsState,
  RoomsMap,
  PlayerFilter,
  SortOption,
  RoomsUpdateCallback,
  ErrorCallback,
  Room,
  RoomSearchResult,
  PlayerRoomResult,
  PlayerView,
} from '../../types/publicRooms';
import { listRooms } from '../../services/ariesRooms';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:publicRooms';
const FEATURE_NAME = 'publicRooms';
const diag = createNamedLogger(FEATURE_SUBSYSTEM);
let busRegistered = false;

function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(FEATURE_SUBSYSTEM, { category: 'feature', status: 'starting' });
}

function publishOk(message: string, metrics?: Record<string, number | string>): void {
  ensureBusRegistered();
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

function warnFeature(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

type ConnectionStatus = PublicRoomsState['connectionStatus'];

const DEFAULT_CONFIG: PublicRoomsConfig = {
  refreshIntervalSeconds: 0,
};

const MIN_REFRESH_SECONDS = 0;
const MAX_REFRESH_SECONDS = 0;

let config: PublicRoomsConfig = { ...DEFAULT_CONFIG };
let state: PublicRoomsState = {
  connectionStatus: 'connecting',
  allRooms: {},
  currentSearchTerm: '',
  currentPlayerFilter: 'all',
  currentSortBy: 'players-desc',
  lastUpdatedAt: null,
};

let filteredRooms: RoomsMap = {};
let initStarted = false;
let roomsUpdateCallback: RoomsUpdateCallback | null = null;
let errorCallback: ErrorCallback | null = null;
let connectionStatusCallback: ((status: ConnectionStatus) => void) | null = null;

function loadConfig(): void {
  const saved = storage.get('publicRooms:refreshInterval', DEFAULT_CONFIG.refreshIntervalSeconds);
  config.refreshIntervalSeconds = clampRefreshInterval(saved);
}

function clampRefreshInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIG.refreshIntervalSeconds;
  if (value <= 0) return 0;
  // Auto-refresh is disabled; clamp to 0.
  return 0;
}

function updateConnectionStatus(status: ConnectionStatus): void {
  if (state.connectionStatus === status) return;
  state.connectionStatus = status;
  connectionStatusCallback?.(status);
}

function emitError(message: string): void {
  errorCallback?.(message);
}

function filterAndSortRooms(rooms: RoomsMap): RoomsMap {
  const entries = Object.entries(rooms || {});
  if (entries.length === 0) return {};

  const search = state.currentSearchTerm.trim().toLowerCase();

  const filtered = entries.filter(([code, room]) => {
    const playerCount = room.playersCount || 0;
    if (state.currentPlayerFilter !== 'all') {
      if (state.currentPlayerFilter === 'empty' && playerCount !== 0) return false;
      if (state.currentPlayerFilter === 'low' && (playerCount < 1 || playerCount > 2)) return false;
      if (state.currentPlayerFilter === 'medium' && (playerCount < 3 || playerCount > 4)) return false;
      if (state.currentPlayerFilter === 'high' && playerCount < 5) return false;
    }

    if (!search) return true;
    const codeMatch = code.toLowerCase().includes(search);
    const slotMatch = room.userSlots?.some(slot => slot.name?.toLowerCase().includes(search));
    return codeMatch || Boolean(slotMatch);
  });

  filtered.sort(([, a], [, b]) => {
    switch (state.currentSortBy) {
      case 'name':
        return a.id.localeCompare(b.id);
      case 'players-asc':
        return (a.playersCount || 0) - (b.playersCount || 0);
      case 'players-desc':
      default:
        return (b.playersCount || 0) - (a.playersCount || 0);
    }
  });

  return filtered.reduce<RoomsMap>((acc, [code, room]) => {
    acc[code] = room;
    return acc;
  }, {});
}

function applyRoomsSnapshot(rooms: Room[]): void {
  const mapped: RoomsMap = {};
  for (const room of rooms) {
    mapped[room.id] = room;
  }
  state.allRooms = mapped;
  state.lastUpdatedAt = new Date().toISOString();
  filteredRooms = filterAndSortRooms(state.allRooms);
  roomsUpdateCallback?.({ ...filteredRooms });
}

function scheduleRefresh(): void {
  // Auto-refresh disabled by requirement.
}

async function fetchRoomsInternal(): Promise<void> {
  updateConnectionStatus('connecting');
  const response = await listRooms(200);
  const rooms = response.data ?? [];
  if (!rooms || rooms.length === 0) {
    updateConnectionStatus('retrying');
    return;
  }
  applyRoomsSnapshot(rooms);
  updateConnectionStatus('connected');
}

// ---------------- Public API ----------------

export async function initPublicRooms(): Promise<void> {
  if (initStarted) return;
  initStarted = true;
  ensureBusRegistered();
  loadConfig();
  await fetchRoomsInternal();
  publishOk('Started', { rooms: Object.keys(state.allRooms).length });
}

export async function fetchRooms(): Promise<void> {
  try {
    await fetchRoomsInternal();
  } catch (error) {
    warnFeature('QPM-FEATURE-004', { what: 'fetchRooms' }, error);
    updateConnectionStatus('retrying');
    emitError('Unable to refresh rooms');
  }
}

export function setRefreshInterval(seconds: number): void {
  config.refreshIntervalSeconds = clampRefreshInterval(seconds);
  storage.set('publicRooms:refreshInterval', config.refreshIntervalSeconds);
}

export function setSearchTerm(term: string): void {
  state.currentSearchTerm = term;
  filteredRooms = filterAndSortRooms(state.allRooms);
  roomsUpdateCallback?.({ ...filteredRooms });
}

export function setPlayerFilter(filter: PlayerFilter): void {
  state.currentPlayerFilter = filter;
  filteredRooms = filterAndSortRooms(state.allRooms);
  roomsUpdateCallback?.({ ...filteredRooms });
}

export function setSortBy(sort: SortOption): void {
  state.currentSortBy = sort;
  filteredRooms = filterAndSortRooms(state.allRooms);
  roomsUpdateCallback?.({ ...filteredRooms });
}

export function setRoomsUpdateCallback(callback: RoomsUpdateCallback): void {
  roomsUpdateCallback = callback;
  callback({ ...filteredRooms });
}

export function setErrorCallback(callback: ErrorCallback): void {
  errorCallback = callback;
}

export function setConnectionStatusCallback(callback: (status: ConnectionStatus) => void): void {
  connectionStatusCallback = callback;
  callback(state.connectionStatus);
}

export function getState(): Readonly<PublicRoomsState> {
  return { ...state };
}

export function getConfig(): Readonly<PublicRoomsConfig> {
  return { ...config };
}

// Pass-through searches and player lookups
export async function searchRoomsByPlayerName(query: string): Promise<RoomSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const lower = q.toLowerCase();
  const res = await listRooms(200);
  const rooms = res.data ?? [];
  const results: RoomSearchResult[] = [];
  for (const room of rooms) {
    if (!room.userSlots || room.userSlots.length === 0) continue;
    const matchedSlots = room.userSlots.filter(slot => slot.name?.toLowerCase().includes(lower));
    if (matchedSlots.length > 0) results.push({ room, matchedSlots });
  }
  return results;
}

export async function searchPlayersByName(query: string): Promise<PlayerRoomResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const lower = q.toLowerCase();
  const res = await listRooms(200);
  const rooms = res.data ?? [];
  const map = new Map<string, PlayerRoomResult>();
  for (const room of rooms) {
    if (!room.userSlots || room.userSlots.length === 0) continue;
    for (const slot of room.userSlots) {
      if (!slot.name || !slot.name.toLowerCase().includes(lower)) continue;
      const key = `${room.id}::${slot.name}`;
      if (map.has(key)) continue;
      map.set(key, {
        playerName: slot.name,
        avatarUrl: slot.avatarUrl,
        roomId: room.id,
        roomPlayersCount: room.playersCount,
      });
    }
  }
  return Array.from(map.values());
}

export async function fetchPlayerView(playerId: string): Promise<PlayerView | null> {
  // Aries API does not provide player view data; return null for now.
  return null;
}
