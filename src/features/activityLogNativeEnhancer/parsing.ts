import type {
  UnknownRecord,
  ActivityLogEntry,
  ActionKey,
  TypeFilter,
  HistoryEnvelope,
  StringField,
  SpeciesLookupEntry,
} from './types';
import {
  HISTORY_LIMIT,
  ACTION_MAP,
  ACTION_MAP_LOWER,
  ACTION_ORDER,
  ACTION_LABELS,
  PATTERNS,
  TOOLBAR_ATTR,
  RARITY_ORDER,
} from './constants';
import { isRecord } from '../../utils/typeGuards';

export { isRecord };

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeToken(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function normalizeSpeciesKey(value: string): string {
  return normalizeToken(value).replace(/[^a-z0-9]/g, '');
}

export function titleizeSpecies(value: string): string {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return '';
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeTimestamp(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return null;
  if (numeric < 1_000_000_000_000) {
    return Math.round(numeric * 1000);
  }
  return Math.round(numeric);
}

export function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const walk = (input: unknown): unknown => {
    if (input === null) return null;
    if (typeof input !== 'object') return input;
    if (seen.has(input as object)) return '__CYCLE__';
    seen.add(input as object);
    if (Array.isArray(input)) {
      return input.map((entry) => walk(entry));
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(input as UnknownRecord).sort();
    for (const key of keys) {
      out[key] = walk((input as UnknownRecord)[key]);
    }
    return out;
  };

  try {
    return JSON.stringify(walk(value));
  } catch {
    return '';
  }
}

export function extractActivityArray(value: unknown): unknown[] {
  if (!isRecord(value)) return [];

  const state = isRecord(value.state) ? value.state : null;
  const user = isRecord(value.user) ? value.user : null;
  const candidates = [
    value.activityLogs,
    value.activityLog,
    state?.activityLogs,
    state?.activityLog,
    user?.activityLogs,
    user?.activityLog,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

export function normalizeEntry(raw: unknown): ActivityLogEntry | null {
  if (!isRecord(raw)) return null;
  const timestamp = normalizeTimestamp(
    raw.timestamp
    ?? raw.performedAt
    ?? raw.createdAt
    ?? raw.loggedAt
    ?? raw.time,
  );
  if (!timestamp) return null;

  const action = readString(raw.action) ?? readString(raw.type) ?? readString(raw.event) ?? null;
  const base: ActivityLogEntry = {
    ...raw,
    timestamp,
  };
  if (action) {
    base.action = action;
  }

  const parameters = isRecord(raw.parameters) ? raw.parameters : null;
  if (parameters) {
    const pet = isRecord(parameters.pet) ? parameters.pet : null;
    const petId = readString(parameters.petId) ?? readString(pet?.id);
    if (petId && !readString(parameters.petId)) {
      base.parameters = {
        ...parameters,
        petId,
      };
    }
  }

  return base;
}

export function normalizeList(logs: unknown): ActivityLogEntry[] {
  if (!Array.isArray(logs)) return [];
  const out: ActivityLogEntry[] = [];
  for (const entry of logs) {
    const normalized = normalizeEntry(entry);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function readEntryMessage(entry: ActivityLogEntry): string {
  const direct = readString(entry.message) ?? readString(entry.text) ?? readString(entry.description);
  if (direct) return direct;
  const parameters = isRecord(entry.parameters) ? entry.parameters : null;
  return readString(parameters?.message) ?? '';
}

export function entryIdentity(entry: ActivityLogEntry): string | null {
  const parameters = isRecord(entry.parameters) ? entry.parameters : null;
  const pet = isRecord(parameters?.pet) ? parameters.pet : null;
  const candidates = [
    parameters?.id,
    pet?.id,
    parameters?.petId,
    parameters?.playerId,
    parameters?.userId,
    parameters?.objectId,
    parameters?.slotId,
    parameters?.itemId,
    parameters?.cropId,
    parameters?.seedId,
    parameters?.decorId,
    parameters?.toolId,
    parameters?.targetId,
    parameters?.abilityId,
  ];
  for (const candidate of candidates) {
    const id = readString(candidate);
    if (id) return id;
  }
  return null;
}

export function entryKey(entry: ActivityLogEntry): string {
  const ts = normalizeTimestamp(entry.timestamp) ?? 0;
  const action = readString(entry.action) ?? '';
  const identity = entryIdentity(entry);
  const message = normalizeToken(readEntryMessage(entry));
  return `${ts}|${action}|${identity ?? `msg:${message || '__none__'}`}`;
}

export function entriesEqual(a: ActivityLogEntry, b: ActivityLogEntry): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function isReplaySafeEntry(entry: ActivityLogEntry): boolean {
  const timestamp = normalizeTimestamp(entry.timestamp);
  if (!timestamp) return false;

  const action = readString(entry.action);
  if (!action) return false;

  const parameters = entry.parameters;
  if (!isRecord(parameters)) return false;

  if (parameters.qpmMigrated === true) return false;

  return true;
}

export function trimAndSortHistory(entries: ActivityLogEntry[]): ActivityLogEntry[] {
  const sorted = entries
    .slice()
    .sort((a, b) => (a.timestamp - b.timestamp));
  if (sorted.length > HISTORY_LIMIT) {
    sorted.splice(0, sorted.length - HISTORY_LIMIT);
  }
  return sorted;
}

export function computeHistoryChecksum(entries: ActivityLogEntry[]): number {
  let hash = 2166136261 >>> 0;
  for (const entry of entries) {
    const key = entryKey(entry);
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= entry.timestamp >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function buildHistoryEnvelope(entries: ActivityLogEntry[]): HistoryEnvelope {
  const normalized = trimAndSortHistory(entries);
  return {
    version: 1,
    savedAt: Date.now(),
    count: normalized.length,
    firstTimestamp: normalized[0]?.timestamp ?? 0,
    lastTimestamp: normalized[normalized.length - 1]?.timestamp ?? 0,
    checksum: computeHistoryChecksum(normalized),
    entries: normalized,
  };
}

export function parseHistoryEnvelope(raw: unknown): HistoryEnvelope | null {
  if (!isRecord(raw)) return null;
  if (Number(raw.version) !== 1) return null;
  if (!Array.isArray(raw.entries)) return null;
  const entries = trimAndSortHistory(normalizeList(raw.entries));
  const count = Number(raw.count);
  const checksum = Number(raw.checksum);
  const firstTimestamp = Number(raw.firstTimestamp);
  const lastTimestamp = Number(raw.lastTimestamp);
  if (!Number.isFinite(count) || count !== entries.length) return null;
  if (!Number.isFinite(firstTimestamp) || firstTimestamp !== (entries[0]?.timestamp ?? 0)) return null;
  if (!Number.isFinite(lastTimestamp) || lastTimestamp !== (entries[entries.length - 1]?.timestamp ?? 0)) return null;
  if (!Number.isFinite(checksum) || checksum !== computeHistoryChecksum(entries)) return null;
  const savedAt = Number(raw.savedAt);
  return {
    version: 1,
    savedAt: Number.isFinite(savedAt) ? savedAt : 0,
    count: entries.length,
    firstTimestamp: entries[0]?.timestamp ?? 0,
    lastTimestamp: entries[entries.length - 1]?.timestamp ?? 0,
    checksum: checksum >>> 0,
    entries,
  };
}

export function parseHistorySource(raw: unknown): HistoryEnvelope | null {
  if (Array.isArray(raw)) {
    const entries = trimAndSortHistory(normalizeList(raw));
    return buildHistoryEnvelope(entries);
  }
  return parseHistoryEnvelope(raw);
}

export function normalizeAbilityAction(raw: string): ActionKey | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  let key = trimmed.replace(/^Snowy/i, '');
  key = key.replace(/_NEW$/i, '');
  key = key.replace(/(?:[_-]?(?:I|II|III|IV|V|VI|VII|VIII|IX|X)|\d+)$/i, '');
  key = key.replace(/[_-]+$/g, '');
  return key ? (key as ActionKey) : null;
}

export function normalizeAction(raw: string): ActionKey {
  const lowered = raw.toLowerCase();
  const mapped = ACTION_MAP[raw];
  const mappedLower = ACTION_MAP_LOWER[lowered];
  const abilityKey = normalizeAbilityAction(raw);
  if (mapped) {
    if (mapped === 'boost' && abilityKey) return abilityKey;
    return mapped;
  }
  if (mappedLower) {
    if (mappedLower === 'boost' && abilityKey) return abilityKey;
    return mappedLower;
  }
  if (abilityKey) return abilityKey;
  for (const { key, re } of PATTERNS) {
    if (re.test(lowered)) return key;
  }
  return lowered || 'other';
}

export function inferActionFromMessage(message: string): ActionKey {
  for (const { key, re } of PATTERNS) {
    if (re.test(message)) return key;
  }
  return 'other';
}

export function actionToType(action: ActionKey, text: string): TypeFilter {
  switch (action) {
    case 'buy':
      return 'purchase';
    case 'sell':
      return 'sell';
    case 'feed':
      return 'feed';
    case 'plant':
      return 'plant';
    case 'harvest':
      return 'harvest';
    case 'hatch':
      return 'hatch';
    case 'travel':
      return 'travel';
    case 'storage':
      return 'storage';
    case 'water':
    case 'coinFinder':
    case 'seedFinder':
    case 'double':
    case 'eggGrowth':
    case 'plantGrowth':
    case 'granter':
    case 'kisser':
    case 'refund':
    case 'boost':
    case 'remove':
      return 'boost';
    default:
      break;
  }

  if (/\b(travel|teleport)\b/i.test(text)) return 'travel';
  if (/\b(storage|stored|retrieve|retrieved)\b/i.test(text)) return 'storage';
  return 'other';
}

export function getEntryElements(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement)) return false;
    if (child.tagName.toLowerCase() === 'button') return false;
    if (child.getAttribute(TOOLBAR_ATTR) === '1') return false;
    const text = child.textContent || '';
    return /\bago\b/i.test(text) || !!child.querySelector('p.chakra-text, p');
  });
}

export function classifyEntry(row: HTMLElement): ActionKey {
  const cachedAction = readString(row.dataset.qpmAction);
  if (cachedAction) return cachedAction;

  const preset =
    row.dataset.action
    || row.getAttribute('data-action')
    || row.getAttribute('data-activity')
    || row.getAttribute('data-mg-action');

  if (preset) {
    const normalized = normalizeAction(String(preset).trim());
    row.dataset.qpmAction = normalized;
    return normalized;
  }

  const text = normalizeWhitespace(row.textContent || '');
  const action = inferActionFromMessage(text);
  row.dataset.qpmAction = action;
  return action;
}

export function classifyType(row: HTMLElement): TypeFilter {
  const cachedType = readString(row.dataset.qpmType) as TypeFilter | null;
  if (cachedType) return cachedType;

  const action = classifyEntry(row);
  const text = normalizeWhitespace(row.textContent || '');
  const type = actionToType(action, text);
  row.dataset.qpmType = type;
  return type;
}

export function mergeActions(actions: ActionKey[]): ActionKey[] {
  const seen = new Set<ActionKey>();
  const ordered: ActionKey[] = [];

  for (const key of ACTION_ORDER) {
    if (key === 'all') continue;
    if (actions.includes(key) && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }

  for (const action of actions) {
    if (action === 'all') continue;
    if (!seen.has(action)) {
      seen.add(action);
      ordered.push(action);
    }
  }

  return ordered;
}

export function getActionLabel(action: ActionKey): string {
  const preset = ACTION_LABELS[action];
  if (preset) return preset;
  const spaced = String(action || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return String(action || '');
  return spaced
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function toPascalCase(value: string): string {
  return value
    .replace(/\(s\)/gi, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function formatDisplayLabel(raw: string): string {
  const cleaned = normalizeWhitespace(raw);
  if (!cleaned) return '';
  const withSpaces = cleaned
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return titleizeSpecies(withSpaces);
}

export function toNumberOr(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function getRarityRank(value: unknown): number {
  const normalized = normalizeToken(String(value ?? ''));
  return RARITY_ORDER[normalized] ?? 99;
}

export function findAtomReadKey(atom: unknown): string | null {
  if (!isRecord(atom)) return null;
  if (typeof (atom as Record<string, unknown>).read === 'function') return 'read';
  for (const key of Object.keys(atom)) {
    const value = (atom as Record<string, unknown>)[key];
    if (typeof value !== 'function') continue;
    if (key === 'write' || key === 'onMount' || key === 'toString') continue;
    const arity = (value as Function).length;
    if (arity === 1 || arity === 2) {
      return key;
    }
  }
  return null;
}

export function getRowMessageText(row: HTMLElement): string {
  const fullText = normalizeWhitespace(row.textContent || '');
  if (!fullText) return '';
  const timeText = normalizeWhitespace(row.querySelector('p')?.textContent || '');
  if (!timeText) return fullText;
  if (!fullText.endsWith(timeText)) return fullText;
  return normalizeWhitespace(fullText.slice(0, Math.max(0, fullText.length - timeText.length)));
}

export function normalizePetNameKey(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

export function extractFeedPetAlias(message: string): string | null {
  const match = message.match(/\byou\s+fed\s+(.+?)\s+\d+\s+/i);
  if (!match || !match[1]) return null;
  const normalized = normalizePetNameKey(match[1]);
  return normalized || null;
}

export function collectStringFields(
  input: unknown,
  path: string,
  out: StringField[],
  seen: WeakSet<object>,
): void {
  if (out.length >= 320) return;
  if (typeof input === 'string') {
    const value = readString(input);
    if (value) {
      out.push({ path, value });
    }
    return;
  }
  if (!isRecord(input) && !Array.isArray(input)) return;
  if (typeof input === 'object' && input !== null) {
    if (seen.has(input)) return;
    seen.add(input);
  }

  if (Array.isArray(input)) {
    for (let index = 0; index < input.length; index += 1) {
      collectStringFields(input[index], `${path}[${index}]`, out, seen);
      if (out.length >= 320) return;
    }
    return;
  }

  for (const [key, value] of Object.entries(input)) {
    collectStringFields(value, path ? `${path}.${key}` : key, out, seen);
    if (out.length >= 320) return;
  }
}

export function diffSnapshots(prev: ActivityLogEntry[], next: ActivityLogEntry[]): {
  added: ActivityLogEntry[];
  updated: ActivityLogEntry[];
} {
  const prevBuckets = new Map<string, ActivityLogEntry[]>();
  for (const entry of prev) {
    const key = entryKey(entry);
    const bucket = prevBuckets.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      prevBuckets.set(key, [entry]);
    }
  }

  const added: ActivityLogEntry[] = [];
  const updated: ActivityLogEntry[] = [];

  for (const entry of next) {
    const key = entryKey(entry);
    const bucket = prevBuckets.get(key);
    const prevEntry = bucket?.shift();
    if (!prevEntry) {
      added.push(entry);
    } else if (!entriesEqual(prevEntry, entry)) {
      updated.push(entry);
    }
    if (bucket && bucket.length === 0) {
      prevBuckets.delete(key);
    }
  }

  return { added, updated };
}

export function visibleRowSignature(row: HTMLElement): string {
  const message = normalizeWhitespace(row.querySelector('div')?.textContent || row.textContent || '');
  const time = normalizeWhitespace(row.querySelector('p')?.textContent || '');
  return `${message}|${time}`;
}

export function buildMatchKeys(...values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const key = normalizeSpeciesKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function compareSpeciesLookupEntry(a: SpeciesLookupEntry, b: SpeciesLookupEntry): number {
  if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
  if (a.rarityRank !== b.rarityRank) return a.rarityRank - b.rarityRank;
  if (a.priceRank !== b.priceRank) return a.priceRank - b.priceRank;
  if (a.shopRank !== b.shopRank) return a.shopRank - b.shopRank;
  return a.label.localeCompare(b.label);
}

export function detectSpeciesKeyFromText(
  text: string,
  lookup: SpeciesLookupEntry[],
): string | null {
  if (!text || !lookup.length) return null;
  const normalized = normalizeSpeciesKey(text);
  if (!normalized) return null;

  let best: { entry: SpeciesLookupEntry; keyLength: number } | null = null;
  for (const candidate of lookup) {
    const keys = candidate.matchKeys?.length ? candidate.matchKeys : [candidate.matchKey];
    for (const key of keys) {
      if (!key) continue;
      if (!normalized.includes(key)) continue;
      if (!best || key.length > best.keyLength) {
        best = { entry: candidate, keyLength: key.length };
      }
    }
  }

  return best?.entry.value ?? null;
}
