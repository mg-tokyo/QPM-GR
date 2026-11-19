// Aries player/friends API client using GM_xmlhttpRequest (no auth required)

import type { ApiResponse, PlayerView } from '../types/publicRooms';
import { gmHttpRequest, type GmHttpOptions } from '../utils/gm';

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

function authHeaders(): Record<string, string> {
  return {};
}

async function request<T>(url: string, options: GmHttpOptions): Promise<ApiResponse<T>> {
  const res = await gmHttpRequest(url, options);
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

function httpGet<T>(path: string, query: Record<string, string | number | undefined> | undefined): Promise<ApiResponse<T>> {
  return request<T>(buildUrl(path, query), { headers: authHeaders() });
}

function httpPost<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return request<T>(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    data: JSON.stringify(body),
  });
}

// ---------------- Player view ----------------

export async function getPlayerView(playerId: string): Promise<ApiResponse<PlayerView>> {
  if (!playerId) return { status: 0, data: null, error: 'Missing playerId' };
  const res = await httpGet<PlayerView>('get-player-view', { playerId });
  if (res.status === 404) return { status: 404, data: null, error: 'Player not found' };
  return res;
}

export type PlayerViewSection = 'profile' | 'garden' | 'inventory' | 'stats' | 'activityLog' | 'journal' | 'room';

export interface GetPlayersViewOptions {
  sections?: PlayerViewSection[] | PlayerViewSection;
}

export async function getPlayersView(playerIds: string[], options?: GetPlayersViewOptions): Promise<ApiResponse<PlayerView[]>> {
  const ids = Array.from(new Set((playerIds ?? []).map(x => String(x).trim()).filter(x => x.length >= 3)));
  if (ids.length === 0) return { status: 200, data: [] };

  const body: Record<string, unknown> = { playerIds: ids };
  if (options?.sections) body.sections = Array.isArray(options.sections) ? options.sections : [options.sections];

  const res = await httpPost<PlayerView[]>('get-players-view', body);
  if (res.status !== 200 || !Array.isArray(res.data)) {
    return { status: res.status, data: null, error: res.error ?? 'Bad response' };
  }
  return res;
}

// ---------------- Friends ----------------

export async function listFriends(playerId: string): Promise<ApiResponse<string[]>> {
  if (!playerId) return { status: 0, data: null, error: 'Missing playerId' };
  const res = await httpGet<{ playerId: string; friends: string[] }>('list-friends', { playerId });
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.friends)) {
    return { status: res.status, data: null, error: res.error ?? 'Bad response' };
  }
  return { status: res.status, data: res.data.friends };
}

// Friends helpers for gating detail
let cachedFriends: { playerId: string; friends: Set<string> } | null = null;

export async function getCachedFriendsSet(myPlayerId: string): Promise<Set<string>> {
  if (!myPlayerId) return new Set();
  if (cachedFriends && cachedFriends.playerId === myPlayerId) return cachedFriends.friends;
  const res = await listFriends(myPlayerId);
  const set = new Set<string>(res.data ?? []);
  cachedFriends = { playerId: myPlayerId, friends: set };
  return set;
}

export function resetFriendsCache(): void {
  cachedFriends = null;
}
