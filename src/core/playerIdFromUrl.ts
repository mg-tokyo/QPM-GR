// src/core/playerIdFromUrl.ts — Atom-free WS-URL playerId fallback.
//
// Carved out of slotOwner.ts (Task B3 Step 0 deviation) so that pure slot
// helpers can be imported in vitest's node env without transitively loading
// websocket/api → pageContext (which references `window` at module scope).

import { getRoomConnection } from '../websocket/api';

/**
 * Atom-free playerId fallback for the WEB build only.
 *
 * On `magicgarden.gg` (web/webview), the WS connect URL includes a
 * `?playerId="..."` query param — the value is JSON-encoded (has literal
 * double-quotes around the string; empirically verified 2026-07-03). We
 * `JSON.parse` to strip them.
 *
 * On Discord Activity (`discordsays.com`), the URL has NO `playerId` param —
 * it uses a `jwt` with the Discord snowflake instead, which is NOT the
 * server-assigned player.id used in room state. There is no sync client-side
 * fallback for Discord; that surface still requires `playerAtom` /
 * `playerIdAtom` to be present. If those get deprecated, a Discord-specific
 * path (Discord SDK subscription or async /me lookup) will be needed.
 *
 * Returns null if the WS is missing, the URL is unparseable, the surface is
 * Discord, or the param is empty.
 */
export function getPlayerIdFromUrl(): string | null {
  const rc = getRoomConnection();
  const ws = rc?.currentWebSocket ?? rc?.ws ?? rc?.socket ?? null;
  const rawUrl = ws?.url;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
  try {
    const parsed = new URL(rawUrl);
    const raw = parsed.searchParams.get('playerId');
    if (!raw || raw.length === 0) return null;
    // Values in this URL are JSON-encoded strings. `raw` = `"p_juEzJpS13rS946jH"`
    // (literal quotes included). JSON.parse strips them; if that fails, fall
    // back to a manual quote strip so an unexpected format still works.
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = raw.replace(/^"(.*)"$/, '$1');
    }
    if (typeof decoded !== 'string') return null;
    const trimmed = decoded.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
