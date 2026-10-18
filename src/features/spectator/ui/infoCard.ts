import { formatRelativeTime, t } from '../../../i18n';
import { createButton, createCurrencyAmount, createProgressBar, createSectionHeader } from '../../../ui/components';
import { openFloatingCard, type FloatingCardEntry } from '../../../ui/components/floatingCard';
import { isRecord } from '../../../utils/typeGuards';
import { pixelsToPct } from '../../../utils/windowPosition';
import type { SeatedPlayer } from '../players';
import type { SpectatorState, SpectatorStore } from '../state';
import { agoParts, msUntilAgoChanges } from './barModel';
import { cardModel, type ActivityLine, type CardNames, type HeldItem, type LinesMemo, type PetTile } from './infoCardModel';
import { playerAvatar } from './playerList';
import { acquireSpectatorStyles, CARD_COMPACT_WIDTH, CARD_WIDTH, COMPACT_QUERY } from './styles';

const CARD_KEY = 'spectator-info';
const PERSIST_KEY = 'qpm.spectator.infoCard.v1';
// Plan Task 6: at most 4 updates per second.
const MIN_RENDER_MS = 250;
const LINES = 3;
const MAX_ABILITIES = 4;
// PS2 spot until dragged: left of the game's right rail, under its currency counter (live 1448 at 1278×632: rail
// x 1227–1272 from y 61, counter bottom 53). The height is a first-open guess; the shell re-clamps to the real one.
const RIGHT_GAP = 56;
const TOP_GAP = 64;
const GUESS_HEIGHT = 250;

/** Catalog names plus the sprite-v2 data URLs ('' while sprites are not ready) and catalog ability colours. */
export interface CardCatalog extends CardNames {
  /** Sprites and catalogs both loaded: until then names and pictures are stand-ins. */
  ready(): boolean;
  onReady(cb: () => void): () => void;
  petSprite(species: string, mutations: readonly string[]): string;
  cropSprite(species: string, mutations: readonly string[]): string;
  /** A potted plant as it grows in the garden, one mutation list per fruit slot. */
  plantSprite(species: string, slotMutations: readonly (readonly string[])[]): string;
  itemSprite(id: string): string;
  abilityColour(id: string): string;
}

export interface InfoCardSource {
  player(id: string): SeatedPlayer | null;
  /** That player's userSlots entry. */
  slot(id: string): unknown;
  /** Game-state changes (and sprite readiness) that can change the card; only watched while it is open. */
  watch(cb: () => void): () => void;
  catalog: CardCatalog;
  closeKey(): string;
  /** I or ×: kept by the caller, so it outlives one spectating session. */
  hidden(): boolean;
  setHidden(hidden: boolean): void;
}

export interface InfoCard { toggle(): void; destroy(): void }

interface Parts { av: HTMLElement; name: HTMLElement; sub: HTMLElement; pets: HTMLElement; held: HTMLElement; lines: HTMLElement; cur: HTMLElement }

interface Open {
  id: string;
  entry: FloatingCardEntry;
  parts: Parts;
  lineCount: number;
  offs: Array<() => void>;
  sigs: Partial<Record<'av' | 'sub' | 'pets' | 'held' | 'cur' | 'lines', string>>;
  /** What the last render read; the same again (userSlots shares unchanged sub-objects, live 1448) skips the work. */
  inputs: readonly unknown[] | null;
  memo: LinesMemo | null;
  lines: ActivityLine[];
  whens: HTMLElement[];
  lastRender: number;
  renderTimer: ReturnType<typeof setTimeout> | null;
  timeTimer: ReturnType<typeof setTimeout> | null;
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function spriteBox(url: string): HTMLElement {
  const box = el('span', 'qpm-spec-card-sprite');
  if (url) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = url;
    box.append(img);
  }
  return box;
}

// PS2 cut-offs, in the design system's hunger colours.
const hungerColour = (pct: number): string =>
  (pct < 30 ? 'var(--qpm-hunger-low)' : pct < 60 ? 'var(--qpm-hunger-mid)' : 'var(--qpm-hunger-full)');

function petEl(p: PetTile, cat: CardCatalog): HTMLElement {
  const tile = el('div', 'qpm-spec-card-pet');
  const pct = p.hungerPct === null ? null : Math.round(p.hungerPct);
  tile.title = pct === null ? p.label : t('feature.spectator.card.petHunger', { name: p.label, pct });
  const abs = el('span', 'qpm-spec-card-abs');
  for (const id of p.abilities.slice(0, MAX_ABILITIES)) {
    const sq = el('span', 'qpm-spec-card-ab');
    sq.style.background = cat.abilityColour(id);
    sq.title = cat.abilityName(id) ?? id;
    abs.append(sq);
  }
  tile.append(abs, spriteBox(cat.petSprite(p.species, p.mutations)));
  if (pct !== null) tile.append(createProgressBar({ value: pct, max: 100, height: 4, color: hungerColour(pct), className: 'qpm-spec-card-hunger' }).root);
  return tile;
}

function heldSprite(h: Exclude<HeldItem, { kind: 'none' | 'unknown' }>, cat: CardCatalog): string {
  switch (h.kind) {
    case 'catalog': return cat.itemSprite(h.id);
    case 'pet': return cat.petSprite(h.species, h.mutations);
    case 'crop': return cat.cropSprite(h.species, h.mutations);
    case 'plant': return cat.plantSprite(h.species, h.slotMutations);
  }
}

function heldParts(h: HeldItem, cat: CardCatalog): HTMLElement[] {
  if (h.kind === 'none') return [el('span', '', t('feature.spectator.card.empty'))];
  if (h.kind === 'unknown') return [el('span', '', t('feature.spectator.card.holdingUnknown'))];
  return [spriteBox(heldSprite(h, cat)), el('span', '', t('feature.spectator.card.holding', { item: h.name }))];
}

function lineEl(l: ActivityLine): { row: HTMLElement; when: HTMLElement } {
  const row = el('div', 'qpm-spec-card-line');
  const what = el('span', 'qpm-spec-card-what', l.title ?? t('feature.spectator.card.activity'));
  if (l.detail) what.append(el('span', 'qpm-spec-muted', ` · ${l.detail}`));
  what.title = what.textContent ?? '';
  const when = el('span', 'qpm-spec-card-when');
  row.append(what, when);
  return { row, when };
}

const agoText = (at: number, now: number): string => {
  const { value, unit } = agoParts(at, now);
  return formatRelativeTime(value, unit, { numeric: 'auto', style: 'narrow' });
};

const compactQuery = (): MediaQueryList | null => (typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null);

/** The followed player's floating card (S §6.2, PS2). Open only while it shows; destroy is idempotent. */
export function mountInfoCard(store: SpectatorStore, src: InfoCardSource): InfoCard {
  const releaseStyles = acquireSpectatorStyles();
  let open: Open | null = null;
  let destroyed = false;

  // Following, with the spectator UI up; the I/× choice is separate so I can tell what it would change.
  const eligible = (s: Readonly<SpectatorState>): string | null =>
    (s.active && s.mode === 'follow' && !s.uiHidden && s.paused !== 'ui' ? s.targetId : null);

  function patch(o: Open, key: keyof Open['sigs'], sig: string, build: () => void): boolean {
    if (o.sigs[key] === sig) return false;
    o.sigs[key] = sig;
    build();
    return true;
  }

  // The time labels change on their own: only their text is rewritten, at the first moment one reads differently.
  function refreshTimes(o: Open): void {
    if (o.timeTimer !== null) clearTimeout(o.timeTimer);
    o.timeTimer = null;
    if (o.lines.length === 0) return;
    const now = Date.now();
    o.lines.forEach((l, i) => {
      const w = o.whens[i];
      const text = agoText(l.at, now);
      if (w && w.textContent !== text) w.textContent = text;
    });
    const wait = Math.min(...o.lines.map((l) => msUntilAgoChanges(l.at, now)));
    o.timeTimer = setTimeout(() => { if (open === o) refreshTimes(o); }, Math.max(1, wait));
  }

  function render(): void {
    const o = open;
    if (!o) return;
    if (o.renderTimer !== null) clearTimeout(o.renderTimer);
    o.renderTimer = null;
    o.lastRender = Date.now();
    const slot = src.slot(o.id);
    const p = src.player(o.id);
    const s = isRecord(slot) ? slot : null;
    const ready = src.catalog.ready();
    const inputs = [s?.data, s?.heldItem, s?.riddenPetId, p && [p.name, p.online, p.seat, p.discordAvatarUrl, p.colour].join('|'), ready];
    if (o.inputs && inputs.every((v, i) => Object.is(v, o.inputs?.[i]))) return;
    o.inputs = inputs;
    const m = cardModel(slot, src.catalog, o.lineCount, o.memo);
    // Lines named before the catalogs loaded are stand-ins: never reused.
    o.memo = ready ? { logs: m.logs, lines: m.lines, max: o.lineCount } : null;
    const { parts } = o;

    const name = p?.name ?? o.id;
    if (parts.name.textContent !== name) parts.name.textContent = name;
    const sub = [p?.online ? t('feature.spectator.card.online') : t('feature.spectator.list.offline')];
    if (p) sub.push(t('feature.spectator.list.seat', { n: p.seat }));
    if (m.riding) sub.push(t('feature.spectator.card.riding', { name: m.riding }));
    patch(o, 'sub', JSON.stringify([p?.online === true, sub]), () => {
      parts.sub.replaceChildren(el('span', p?.online ? 'qpm-spec-card-on' : '', sub[0]), ...sub.slice(1).map((x) => ` · ${x}`));
    });
    patch(o, 'av', p ? `${p.discordAvatarUrl ?? ''}|${p.colour ?? ''}` : '', () => { parts.av.replaceChildren(...(p ? [playerAvatar(p)] : [])); });

    let moved = patch(o, 'pets', JSON.stringify([ready, m.pets.map((x) => [x.id, x.label, x.mutations, x.abilities, x.hungerPct === null ? null : Math.round(x.hungerPct)])]), () => {
      parts.pets.replaceChildren(...(m.pets.length > 0 ? m.pets.map((x) => petEl(x, src.catalog)) : [el('span', 'qpm-spec-muted', t('feature.spectator.card.noPets'))]));
    });
    moved = patch(o, 'held', JSON.stringify([ready, m.held]), () => { parts.held.replaceChildren(...heldParts(m.held, src.catalog)); }) || moved;
    moved = patch(o, 'cur', `${m.coins}|${m.dust}`, () => {
      parts.cur.replaceChildren();
      if (m.coins !== null) parts.cur.append(createCurrencyAmount('coins', m.coins, { compact: true }));
      if (m.dust !== null) parts.cur.append(createCurrencyAmount('magicDust', m.dust, { compact: true }));
    }) || moved;
    moved = patch(o, 'lines', JSON.stringify(m.lines), () => {
      const rows = m.lines.map(lineEl);
      o.whens = rows.map((r) => r.when);
      parts.lines.replaceChildren(...(rows.length > 0 ? rows.map((r) => r.row) : [el('span', 'qpm-spec-muted', t('feature.spectator.list.noActivity'))]));
    }) || moved;
    o.lines = m.lines;
    refreshTimes(o);
    if (moved) o.entry.refresh();
  }

  function schedule(): void {
    const o = open;
    if (!o || o.renderTimer !== null) return;
    const wait = o.lastRender + MIN_RENDER_MS - Date.now();
    if (wait <= 0) { render(); return; }
    o.renderTimer = setTimeout(() => { if (open === o) { o.renderTimer = null; render(); } }, wait);
  }

  function openFor(id: string): void {
    const header = el('div', 'qpm-spec-card-hd');
    const parts: Parts = {
      av: el('span', ''), name: el('span', 'qpm-spec-card-name'), sub: el('span', 'qpm-spec-card-sub'),
      pets: el('div', 'qpm-spec-card-pets'), held: el('div', 'qpm-spec-card-held'), lines: el('div', 'qpm-spec-card-lines'),
      cur: el('div', 'qpm-spec-card-cur'),
    };
    const who = el('div', 'qpm-spec-card-who');
    who.append(parts.name, parts.sub);
    const closeBtn = createButton('×', { variant: 'ghost', size: 'sm', className: 'qpm-spec-card-x', onClick: () => { src.setHidden(true); sync(); } });
    const label = t('feature.spectator.card.close', { key: src.closeKey() });
    closeBtn.title = label;
    closeBtn.setAttribute('aria-label', label);
    header.append(parts.av, who, closeBtn);
    const section = (key: string): HTMLElement => {
      const h = createSectionHeader(t(key), { size: 'compact' }).root;
      h.classList.add('qpm-spec-card-label');
      return h;
    };
    const body = el('div', 'qpm-spec-card-body');
    body.append(section('feature.spectator.card.pets'), parts.pets, parts.held, section('feature.spectator.card.recent'), parts.lines, parts.cur);
    const mql = compactQuery();
    const width = mql?.matches ? CARD_COMPACT_WIDTH : CARD_WIDTH;
    const entry = openFloatingCard({
      key: CARD_KEY, persistKey: PERSIST_KEY, header, body, className: 'qpm-spec-card', baseWidth: width,
      defaultPosition: pixelsToPct(window.innerWidth - width - RIGHT_GAP, TOP_GAP, width, GUESS_HEIGHT),
      dragExcludeSelectors: ['.qpm-spec-card-x'], retainPosition: true,
    });
    const o: Open = {
      id, entry, parts, lineCount: mql?.matches ? 1 : LINES, offs: [], sigs: {}, inputs: null, memo: null, lines: [], whens: [],
      lastRender: 0, renderTimer: null, timeTimer: null,
    };
    open = o;
    // Crossing the compact breakpoint changes the width the shell clamps with and the line count: open it afresh.
    const onBreakpoint = (): void => { if (open === o) { close(); sync(); } };
    mql?.addEventListener('change', onBreakpoint);
    o.offs.push(() => { mql?.removeEventListener('change', onBreakpoint); });
    // A subscription that delivers its current value on registration renders here; otherwise render once now.
    o.offs.push(src.watch(schedule));
    if (!src.catalog.ready()) o.offs.push(src.catalog.onReady(schedule));
    if (o.lastRender === 0) render();
  }

  function close(): void {
    const o = open;
    if (!o) return;
    open = null;
    if (o.renderTimer !== null) clearTimeout(o.renderTimer);
    if (o.timeTimer !== null) clearTimeout(o.timeTimer);
    for (const off of o.offs.splice(0)) {
      try { off(); } catch { /* isolate */ }
    }
    o.entry.destroy();
  }

  function sync(): void {
    if (destroyed) return;
    const id = src.hidden() ? null : eligible(store.get());
    if (!id) { close(); return; }
    if (!open) { openFor(id); return; }
    if (open.id !== id) {
      open.id = id;
      open.sigs = {};
      open.inputs = null;
      render();
    }
  }

  const offStore = store.on(sync);
  sync();

  return {
    // I hides only a card that is on screen; any time it brings a hidden card back (for the next follow, if not now).
    toggle() {
      if (!src.hidden() && !eligible(store.get())) return;
      src.setHidden(!src.hidden());
      sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offStore();
      close();
      releaseStyles();
    },
  };
}
