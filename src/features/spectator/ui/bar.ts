import { t } from '../../../i18n';
import type { SeatedPlayer } from '../players';
import type { SpectatorStore } from '../state';
import { barBottomPx, barVisible, chipState, switcherState, type SwitcherState } from './barModel';
import { barButton, setEnabled, setLabel, span, toolButton } from './buttons';
import { playerAvatar, renderPlayerList } from './playerList';
import { acquireSpectatorStyles } from './styles';

// The hotbar springs into place over ~360 ms after a resize or when the expanded inventory closes (live 1448: top
// 772 → 491 → 504, and 170 → 520 → 504), so it is measured once that has settled.
const SETTLE_MS = 500;
const EDGE = 8;
const POP_GAP = 8;
const POP_MIN_H = 80;

export interface BarActions {
  players(): readonly SeatedPlayer[];
  onPlayers(cb: (list: readonly SeatedPlayer[]) => void): () => void;
  follow(id: string): void;
  cycle(dir: 1 | -1): void;
  exit(): void;
  /** The toggle key as the player reads it, e.g. "G". */
  exitKey(): string;
  /** Fires after a rebind, so Exit's key label follows it. */
  onKeys?(cb: () => void): () => void;
  /** The top of the game's hotbar in CSS px, null when unreadable. */
  hotbarTop(): number | null;
  /** Tasks 7 and 9: no handler, no button. */
  director?(): void;
  photo?(): void;
}

export interface SpectatorBar {
  /** Task 8: the menu the Waypoints button opens; null takes the button away. onClose runs before the popover goes,
   * however it closes. */
  setWaypointsMenu(el: HTMLElement | null, onClose?: () => void): void;
  /** True when a popover was open: Esc closes it before it leaves spectating. */
  closePopover(): boolean;
  destroy(): void;
}

interface Popover { el: HTMLElement; anchor: HTMLElement; fill(el: HTMLElement): void; onClose?: () => void }

/** The bottom-centre bar (S §6.1, PS1). Lives for one spectating session; destroy is idempotent. */
export function mountBar(store: SpectatorStore, actions: BarActions): SpectatorBar {
  const releaseStyles = acquireSpectatorStyles();
  const offs: Array<() => void> = [];
  let roster: readonly SeatedPlayer[] = actions.players();
  let pop: Popover | null = null;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let whoSig = '';
  let menu: HTMLElement | null = null;
  let menuClose: (() => void) | null = null;
  let waypoints: HTMLButtonElement | null = null;
  let placed = false;
  let destroyed = false;

  const bar = document.createElement('div');
  bar.className = 'qpm-spec-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('feature.spectator.bar.label'));
  const chip = span('qpm-spec-chip');
  const prev = barButton('‹', 'ghost', () => { actions.cycle(-1); });
  const who = barButton('', 'ghost', () => { toggleList(); });
  const next = barButton('›', 'ghost', () => { actions.cycle(1); });
  setLabel(prev, t('feature.spectator.bar.prev'));
  setLabel(next, t('feature.spectator.bar.next'));
  setLabel(who, t('feature.spectator.bar.players'));
  who.setAttribute('aria-haspopup', 'true');
  const runDirector = (): void => { actions.director?.(); };
  let director = actions.director ? toolButton('director', t('feature.spectator.bar.director'), 'secondary', runDirector) : null;
  director?.setAttribute('aria-pressed', 'false');
  const photo = actions.photo ? toolButton('photo', t('feature.spectator.bar.photo'), 'secondary', () => { actions.photo?.(); }) : null;
  const exit = toolButton('exit', '', 'ghost', () => { actions.exit(); });
  bar.append(chip, span('qpm-spec-sep'), prev, who, next, span('qpm-spec-sep'));
  for (const b of [director, photo, exit]) if (b) bar.append(b);
  document.body.append(bar);

  const listSource = {
    players: () => roster,
    targetId: () => store.get().targetId,
    follow: (id: string) => { actions.follow(id); closePopover(); },
  };

  const onOutside = (e: PointerEvent): void => {
    const target = e.target;
    if (!pop || (target instanceof Node && (pop.el.contains(target) || pop.anchor.contains(target)))) return;
    closePopover();
  };

  // onClose runs while the content is still in place: a waypoint rename being typed commits there. A blur can't be relied
  // on: browsers differ on removing a focused field, and a CDP-driven Chrome window fires none at all (live 1448).
  function closePopover(): boolean {
    const p = pop;
    if (!p) return false;
    pop = null;
    window.removeEventListener('pointerdown', onOutside, true);
    p.anchor.setAttribute('aria-expanded', 'false');
    try { p.onClose?.(); } catch { /* isolate */ }
    p.el.remove();
    return true;
  }

  // Opens upward from the anchor, inside the window, never taller than the space above the bar.
  function openPopover(anchor: HTMLElement, fill: (el: HTMLElement) => void, onClose?: () => void): void {
    closePopover();
    const el = document.createElement('div');
    el.className = 'qpm-spec-pop';
    fill(el);
    document.body.append(el);
    const barTop = bar.getBoundingClientRect().top;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.left = `${Math.round(Math.max(EDGE, Math.min(window.innerWidth - w - EDGE, a.left + a.width / 2 - w / 2)))}px`;
    el.style.bottom = `${Math.round(window.innerHeight - barTop + POP_GAP)}px`;
    el.style.maxHeight = `${Math.max(POP_MIN_H, Math.round(barTop - POP_GAP - EDGE))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    window.addEventListener('pointerdown', onOutside, true);
    pop = onClose ? { el, anchor, fill, onClose } : { el, anchor, fill };
  }

  function toggleList(): void {
    if (pop?.anchor === who) { closePopover(); return; }
    openPopover(who, (el) => { renderPlayerList(el, listSource); });
  }

  function toggleMenu(): void {
    if (!waypoints || !menu) return;
    if (pop?.anchor === waypoints) { closePopover(); return; }
    openPopover(waypoints, (el) => { if (menu) el.replaceChildren(menu); }, () => { menuClose?.(); });
  }

  function renderWho(s: SwitcherState): void {
    const sig = s.kind === 'follow' ? `${s.player.id}|${s.player.name}|${s.player.discordAvatarUrl ?? ''}|${s.player.colour ?? ''}` : s.kind;
    if (sig !== whoSig) {
      whoSig = sig;
      if (s.kind === 'follow') who.replaceChildren(playerAvatar(s.player), span('qpm-spec-name', s.player.name));
      else who.replaceChildren(span('qpm-spec-name qpm-spec-muted', t(s.kind === 'choose' ? 'feature.spectator.bar.choose' : 'feature.spectator.bar.nobody')));
    }
    const canCycle = s.kind === 'follow' || (s.kind === 'choose' && s.canCycle);
    setEnabled(prev, canCycle);
    setEnabled(next, canCycle);
  }

  // store.director is the only source (T, the button, your own camera input). Rebuilt rather than restyled:
  // createButton bakes the variant's colours in at creation.
  function showDirector(on: boolean): void {
    if (!director || director.getAttribute('aria-pressed') === String(on)) return;
    const nb = toolButton('director', t('feature.spectator.bar.director'), on ? 'primary' : 'secondary', runDirector);
    nb.setAttribute('aria-pressed', String(on));
    director.replaceWith(nb);
    director = nb;
  }

  function place(): void {
    if (bar.hidden) return;
    bar.style.bottom = `${barBottomPx(actions.hotbarTop(), window.innerHeight, bar.offsetHeight)}px`;
    placed = true;
  }

  function placeWhenSettled(): void {
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => { settle = null; place(); }, SETTLE_MS);
  }

  function render(): void {
    if (destroyed) return;
    const s = store.get();
    const show = barVisible(s);
    if (bar.hidden === show) {
      bar.hidden = !show;
      if (!show) closePopover();
      else {
        // Back from a game window, the last resting spot still holds (only a resize moves the hotbar at rest).
        if (!placed) place();
        placeWhenSettled();
      }
    }
    const c = chipState(s);
    const mode = c.kind === 'mode' && c.mode === 'follow' ? t('feature.spectator.bar.follow') : t('feature.spectator.bar.free');
    chip.textContent = c.kind === 'paused' ? t('feature.spectator.bar.paused') : `${mode} · ${c.view}`;
    chip.toggleAttribute('data-paused', c.kind === 'paused');
    chip.title = c.kind === 'paused' ? t('feature.spectator.bar.pausedHint') : '';
    renderWho(switcherState(s.targetId, roster));
    showDirector(s.director);
    setLabel(exit, t('feature.spectator.bar.exit', { key: actions.exitKey() }));
    if (pop?.anchor === who) pop.fill(pop.el);
  }

  const onResize = (): void => {
    closePopover();
    placeWhenSettled();
  };
  window.addEventListener('resize', onResize);
  offs.push(() => {
    window.removeEventListener('resize', onResize);
    if (settle !== null) clearTimeout(settle);
    settle = null;
  });
  offs.push(store.on(render));
  offs.push(actions.onPlayers((list) => { roster = list; render(); }));
  if (actions.onKeys) offs.push(actions.onKeys(render));
  render();

  return {
    setWaypointsMenu(el, onClose) {
      if (!el) {
        if (waypoints && pop?.anchor === waypoints) closePopover();
        menu = null;
        menuClose = null;
        waypoints?.remove();
        waypoints = null;
        return;
      }
      menu = el;
      menuClose = onClose ?? null;
      if (!waypoints) {
        waypoints = toolButton('waypoints', t('feature.spectator.bar.waypoints'), 'secondary', toggleMenu, true);
        (photo ?? exit).before(waypoints);
      }
      if (pop?.anchor === waypoints) pop.fill(pop.el);
    },
    closePopover,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closePopover();
      for (const off of offs.splice(0)) {
        try { off(); } catch { /* isolate */ }
      }
      bar.remove();
      releaseStyles();
    },
  };
}
