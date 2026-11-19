// Aries public rooms client using GM_xmlhttpRequest
import type { Room, RoomUserSlot, ApiResponse } from '../types/publicRooms';
import { gmHttpRequest } from '../utils/gm';

const API_BASE_URL = 'https://ariesmod-api.ariedam.fr/';

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function httpGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<ApiResponse<T>> {
  const res = await gmHttpRequest(buildUrl(path, query), { headers: {} });
  if (res.kind === 'unavailable') return { status: 0, data: null, error: 'GM_xmlhttpRequest unavailable' };
  if (res.kind === 'error') return { status: 0, data: null, error: String(res.error ?? 'Network error') };
  if (res.kind === 'timeout') return { status: 0, data: null, error: 'Timeout' };

  let parsed: T | null = null;
  let error: string | undefined;

  if (res.responseText) {
    try {
      parsed = JSON.parse(res.responseText) as T;
    } catch (e) {
      error = `Failed to parse JSON: ${(e as Error).message}`;
    }
  }

  if ((res.status < 200 || res.status >= 300) && !error) {
    error = `HTTP ${res.status}`;
  }

  return error ? { status: res.status, data: parsed, error } : { status: res.status, data: parsed };
}

export async function listRooms(limit = 50): Promise<ApiResponse<Room[]>> {
  const res = await httpGet<RoomDto[]>('rooms', { limit });

  if (!res.data || !Array.isArray(res.data)) {
    return res.error ? { status: res.status, data: null, error: res.error } : { status: res.status, data: null };
  }

  const rooms: Room[] = res.data.map(r => {
    const base = {
      id: r.id,
      isPrivate: r.is_private,
      playersCount: r.players_count ?? 0,
      lastUpdatedAt: r.last_updated_at,
      lastUpdatedByPlayerId: r.last_updated_by_player_id,
    } satisfies Omit<Room, 'userSlots'>;

    if (Array.isArray(r.user_slots)) {
      const slots: RoomUserSlot[] = r.user_slots.map(slot => ({
        name: slot.name,
        avatarUrl: slot.avatar_url ?? null,
        playerId: slot.player_id ?? null,
      }));
      return { ...base, userSlots: slots } satisfies Room;
    }
    return base as Room;
  });

  return res.error ? { status: res.status, data: rooms, error: res.error } : { status: res.status, data: rooms };
}

interface RoomDto {
  id: string;
  is_private: boolean;
  players_count: number | null;
  last_updated_at: string;
  last_updated_by_player_id: string | null;
  user_slots?: Array<{ name: string; avatar_url?: string | null; player_id?: string | null }>;
}

// Re-export for convenience
export type { Room, RoomUserSlot };
