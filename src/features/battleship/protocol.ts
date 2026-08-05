import type { Coord, FleetLayout, GameMsg } from './types';
import { CHAT_PREFIX } from './constants.ts';
import { shipCells } from './board.ts';

// All lines must fit the 100-char server truncation limit (spike findings §3).
// The compact layout string doubles as the commit-hash preimage.

export function coordLabel(c: Coord): string {
  return `${String.fromCharCode(65 + c.col)}${c.row + 1}`;
}

export function parseCoordLabel(s: string): Coord | null {
  const m = /^([A-J])(10|[1-9])$/.exec(s);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { col: m[1].charCodeAt(0) - 65, row: parseInt(m[2], 10) - 1 };
}

/** 's5:A1h s4:C3v ...' — ships in FLEET_SPECS order, origin + orientation. */
export function layoutToCompact(layout: FleetLayout): string {
  return layout
    .map(ship => {
      const first = ship.cells[0];
      const second = ship.cells[1];
      const horizontal = ship.cells.length < 2 || (first && second && first.row === second.row);
      return `${ship.spec.id}:${first ? coordLabel(first) : '??'}${horizontal ? 'h' : 'v'}`;
    })
    .join(' ');
}

export function compactToLayout(
  compact: string,
  speciesFor: (shipId: string) => string,
): FleetLayout | null {
  const layout: FleetLayout = [];
  const tokens = compact.trim().split(/\s+/);
  if (tokens.length === 0) return null;
  for (const token of tokens) {
    const m = /^(s\d[ab]?):([A-J](?:10|[1-9]))([hv])$/.exec(token);
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
    const id = m[1];
    const origin = parseCoordLabel(m[2]);
    if (!origin) return null;
    const lengthFromId = parseInt(id.slice(1), 10);
    if (!Number.isFinite(lengthFromId) || lengthFromId < 1) return null;
    const cells = shipCells(origin, lengthFromId, m[3] === 'h');
    if (!cells) return null;
    layout.push({ spec: { id, length: lengthFromId }, species: speciesFor(id), cells });
  }
  return layout;
}

const P = CHAT_PREFIX;

// Compact chat format — one glyph per verdict keeps the play-by-play
// scannable in the game's chat pane. All lines still fit the 100-char cap
// and stay human-readable to spectators.
const G_MISS = '💦';
const G_HIT = '💥';
const G_SUNK = '🌾';
const G_WIN = '🏆';

export function encodeLine(msg: GameMsg, senderName: string): string {
  switch (msg.kind) {
    case 'challenge':
      // <sender> → <targetName>: Battleship? (QPM)
      // Recipient filters by name match to gate the accept card. mpSession
      // cross-verifies the accept sender's playerId later.
      return `${P} ${senderName} → ${msg.to}: Battleship? (QPM)`;
    case 'accept':
      return `${P} accepted`;
    case 'decline':
      return `${P} declined`;
    case 'ready':
      return `${P} ready ${msg.hash8}${msg.grid === 0 ? 'L' : 'R'}`;
    case 'shot':
      return `${P} →${coordLabel(msg.at)}`;
    case 'verdict': {
      const at = coordLabel(msg.at);
      const { verdict, species } = msg.result;
      if (verdict === 'miss') return `${P} ${at}${G_MISS}`;
      if (verdict === 'hit') return `${P} ${at}${G_HIT} ${species ?? '?'}`;
      if (verdict === 'sunk') return `${P} ${at}${G_SUNK} ${species ?? '?'}`;
      return `${P} ${at}${G_WIN} ${species ?? '?'}`;
    }
    case 'reveal':
      return `${P} reveal ${msg.layoutCompact} salt:${msg.salt}`;
    case 'resign':
      return `${P} resigned`;
    case 'rematch':
      return `${P} rematch?`;
  }
}

// `to` can be any display name (unicode allowed); everything up to the final
// `: Battleship? (QPM)` sentinel is name material. Use a lazy `→ ` separator
// so names with `→` characters (unlikely) still parse the first arrow.
const RE_CHALLENGE = /^⚓ (.+?) → (.+): Battleship\? \(QPM\)$/;
const RE_READY = /^⚓ ready ([0-9a-f]{8})([LR])$/;
const RE_SHOT = /^⚓ →([A-J](?:10|[1-9]))$/;
const RE_MISS = new RegExp(`^⚓ ([A-J](?:10|[1-9]))${G_MISS}$`);
const RE_HIT = new RegExp(`^⚓ ([A-J](?:10|[1-9]))${G_HIT} ([A-Za-z0-9]+)$`);
const RE_SUNK = new RegExp(`^⚓ ([A-J](?:10|[1-9]))${G_SUNK} ([A-Za-z0-9]+)$`);
const RE_WIN = new RegExp(`^⚓ ([A-J](?:10|[1-9]))${G_WIN} ([A-Za-z0-9]+)$`);
const RE_REVEAL = /^⚓ reveal (.+) salt:([0-9a-f]{16})$/;

export function parseLine(text: string): GameMsg | null {
  if (!text.startsWith(`${P} `)) return null;

  if (text === `${P} accepted`) return { kind: 'accept' };
  if (text === `${P} declined`) return { kind: 'decline' };
  if (text === `${P} resigned`) return { kind: 'resign' };
  if (text === `${P} rematch?`) return { kind: 'rematch' };

  let m = RE_CHALLENGE.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined) return { kind: 'challenge', from: m[1], to: m[2] };

  m = RE_READY.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    return { kind: 'ready', hash8: m[1], grid: m[2] === 'L' ? 0 : 1 };
  }

  m = RE_SHOT.exec(text);
  if (m && m[1] !== undefined) {
    const at = parseCoordLabel(m[1]);
    return at ? { kind: 'shot', at } : null;
  }

  m = RE_WIN.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    const at = parseCoordLabel(m[1]);
    return at ? { kind: 'verdict', at, result: { verdict: 'win', species: m[2] } } : null;
  }

  m = RE_SUNK.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    const at = parseCoordLabel(m[1]);
    return at ? { kind: 'verdict', at, result: { verdict: 'sunk', species: m[2] } } : null;
  }

  m = RE_HIT.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    const at = parseCoordLabel(m[1]);
    return at ? { kind: 'verdict', at, result: { verdict: 'hit', species: m[2] } } : null;
  }

  m = RE_MISS.exec(text);
  if (m && m[1] !== undefined) {
    const at = parseCoordLabel(m[1]);
    return at ? { kind: 'verdict', at, result: { verdict: 'miss' } } : null;
  }

  m = RE_REVEAL.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    return { kind: 'reveal', layoutCompact: m[1], salt: m[2] };
  }

  return null;
}

export function makeSalt(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of `${layoutCompact}|${salt}`. */
export async function hashLayout(layoutCompact: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${layoutCompact}|${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic and symmetric — both clients compute the same answer. */
export function firstTurnFromHashes(challengerHash8: string, opponentHash8: string): 'challenger' | 'opponent' {
  let sum = 0;
  const combined = challengerHash8 + opponentHash8;
  for (let i = 0; i < combined.length; i++) sum += combined.charCodeAt(i);
  return sum % 2 === 0 ? 'challenger' : 'opponent';
}
