import {
  findKeyClashes, getSpectatorSettings, holdKeyOf, isHoldAction, refuseKey, setSpectatorSetting, SPECTATOR_DEFAULTS,
  type KeyClash, type KeyRefusal, type OtherKeybind, type SpectatorAction, type SpectatorSettings,
} from '../../features/spectator';
import { getPanelToggleKeybind, onPanelToggleKeybindChange } from '../../features/input/panelHotkey';
import { getAllFeedKeybinds } from '../../features/pets/feedKeybinds';
import { getSellAllPetsKeybind } from '../../features/pets/sellAll';
import { getAllShopKeybinds, isShopKeybindsEnabled } from '../../features/shop/keybinds';
import { t } from '../../i18n';
import { getKeybinds, getTeamsConfig } from '../../store/petTeams';
import { createSectionHeader } from '../components';
import { getKeybind as getHutchKeybind } from '../pets/hutchWindow';
import { createKeybindButton, formatKeybind, normalizeKeybind } from '../pets/petsWindow/helpers';
import { muted } from './sectionLayout';

// PS4 (2026-10-10): the rows and groups the card shows. V, C and auto-start arrive with Tasks 13 and 16.
const GROUPS: ReadonlyArray<{ label: string | null; actions: readonly SpectatorAction[] }> = [
  { label: null, actions: ['toggle'] },
  { label: 'feature.spectator.keys.group.move', actions: ['forward', 'left', 'back', 'right', 'up', 'down', 'fast'] },
  { label: 'feature.spectator.keys.group.players', actions: ['prevPlayer', 'nextPlayer', 'detach', 'director'] },
  { label: 'feature.spectator.bar.waypoints', actions: ['saveWaypoint', 'prevWaypoint', 'nextWaypoint'] },
  { label: 'feature.spectator.keys.group.screen', actions: ['infoCard', 'hideUi', 'photo'] },
];
const SHOWN: readonly SpectatorAction[] = GROUPS.flatMap((g) => g.actions);
const REUSED_LABEL: Partial<Record<SpectatorAction, string>> = {
  prevPlayer: 'feature.spectator.bar.prev', nextPlayer: 'feature.spectator.bar.next', photo: 'feature.spectator.photo.label',
};
const labelOf = (a: SpectatorAction): string => t(REUSED_LABEL[a] ?? `feature.spectator.keys.${a}`);

const BTN = 'min-width:88px;text-align:center;background:var(--qpm-surface-2);border:1px solid var(--qpm-accent-border);' +
  'border-radius:4px;color:var(--qpm-text);font-family:inherit;font-size:12px;padding:4px 8px;outline:none;cursor:pointer;white-space:nowrap;';
const NOTE = 'grid-column:1 / -1;font-size:12px;line-height:1.4;margin-top:-4px;';

/** Every other QPM keybind, read fresh: only the panel shortcut has a change event. */
function otherKeybinds(): OtherKeybind[] {
  const out: OtherKeybind[] = [];
  const add = (name: string, combo: string, loose = false): void => {
    if (combo) out.push(loose ? { name, combo, loose } : { name, combo });
  };
  if (isShopKeybindsEnabled()) {
    for (const [id, combo] of Object.entries(getAllShopKeybinds())) {
      add(t('feature.spectator.keys.other.shop', { shop: t(`feature.shopKeybinds.${id}`) }), combo);
    }
  }
  add(t('hub.config.panelShortcut.label'), getPanelToggleKeybind());
  for (const [i, combo] of Object.entries(getAllFeedKeybinds())) add(t('feature.spectator.keys.other.feed', { n: Number(i) + 1 }), combo);
  add(t('feature.spectator.keys.other.sellAll'), getSellAllPetsKeybind());
  const teams = getTeamsConfig().teams;
  for (const [combo, id] of Object.entries(getKeybinds())) {
    const team = teams.find((x) => x.id === id);
    if (team) add(t('feature.spectator.keys.other.team', { name: team.name }), combo);
  }
  // The Hutch matches event.key with any modifiers held (hutchWindow.ts:374).
  add(t('feature.spectator.keys.other.hutch'), getHutchKeybind(), true);
  return out;
}

function clashText(a: SpectatorAction, c: KeyClash): string {
  if (c.kind === 'spectator') return t('feature.spectator.keys.clash', { action: labelOf(c.action) });
  return t(a === 'toggle' ? 'feature.spectator.keys.clashOtherToggle' : 'feature.spectator.keys.clashOther', { name: c.name });
}

const refusalText = (r: KeyRefusal, combo: string): string =>
  (r === 'fixed' ? t('feature.spectator.keys.fixedKey', { key: formatKeybind(combo) }) : t('feature.spectator.keys.holdModifier'));

// Shift alone is Faster's default (normalizeKeybind skips it). On a movement row Shift is ignored, so Shift then W
// records W.
const holdNormalize = (shiftAlone: boolean) => (e: KeyboardEvent): string =>
  (e.key === 'Shift' ? (shiftAlone ? 'shift' : '') : holdKeyOf(normalizeKeybind(e)));

const setKey = (a: SpectatorAction, combo: string): void => {
  setSpectatorSetting('keys', { ...getSpectatorSettings().keys, [a]: combo });
};

interface KeyRow { action: SpectatorAction; btn: HTMLButtonElement; note: HTMLElement; refusal: string | null; recording: boolean }

export interface SpectatorKeys { root: HTMLElement; render(s: SpectatorSettings): void; destroy(): void }

/** The Keys block (PS4): one recorder per shown action, clash and refusal notes under the row. */
export function createSpectatorKeys(): SpectatorKeys {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:6px 12px;align-items:center;';
  const rows: KeyRow[] = [];
  let clashes = new Map<SpectatorAction, KeyClash[]>();

  const paintRow = (row: KeyRow): void => {
    const list = clashes.get(row.action) ?? [];
    const warn = row.refusal !== null || list.length > 0;
    row.btn.style.borderColor = row.recording ? 'var(--qpm-accent)' : warn ? 'var(--qpm-warning)' : 'var(--qpm-accent-border)';
    const parts: HTMLElement[] = [];
    if (row.action === 'toggle') parts.push(muted(t('feature.spectator.keys.toggleNote')));
    const alert = row.refusal ?? list.map((c) => clashText(row.action, c)).join(' ');
    if (alert) {
      const el = document.createElement('div');
      el.style.color = 'var(--qpm-warning)';
      el.textContent = alert;
      parts.push(el);
    }
    row.note.replaceChildren(...parts);
    row.note.style.display = parts.length > 0 ? '' : 'none';
  };

  const buildRow = (a: SpectatorAction): KeyRow => {
    const label = document.createElement('div');
    label.style.cssText = 'font-size:12px;color:var(--qpm-text);';
    label.textContent = labelOf(a);
    const note = document.createElement('div');
    note.style.cssText = NOTE;
    note.dataset.specNote = a;
    const row: KeyRow = { action: a, btn: document.createElement('button'), note, refusal: null, recording: false };
    row.btn = createKeybindButton({
      readCurrent: () => getSpectatorSettings().keys[a],
      onSet: (combo) => { setKey(a, combo); },
      onClear: () => { setKey(a, SPECTATOR_DEFAULTS.keys[a]); },
      ...(isHoldAction(a) ? { normalize: holdNormalize(a === 'fast') } : {}),
      accept: (combo) => {
        const r = refuseKey(a, combo);
        row.refusal = r ? refusalText(r, combo) : null;
        paintRow(row);
        return r === null;
      },
      onRecording: (on) => {
        row.recording = on;
        if (!on) row.refusal = null;
        paintRow(row);
      },
    });
    row.btn.style.cssText = BTN;
    row.btn.dataset.specKey = a;
    grid.append(label, row.btn, note);
    return row;
  };

  for (const g of GROUPS) {
    if (g.label) {
      const head = muted(t(g.label));
      head.style.gridColumn = '1 / -1';
      head.style.marginTop = '4px';
      grid.append(head);
    }
    for (const a of g.actions) rows.push(buildRow(a));
  }
  root.append(
    createSectionHeader(t('feature.spectator.keys.title'), { size: 'compact' }).root, muted(t('feature.spectator.keys.help')),
    grid, muted(t('feature.spectator.keys.fixed')),
  );

  // Removing or disabling a focused recorder fires no blur everywhere (bar.ts:90): end it so its window listener goes.
  const endRecording = (row: KeyRow): void => {
    if (row.recording) row.btn.dispatchEvent(new FocusEvent('blur'));
  };

  const render = (s: SpectatorSettings): void => {
    clashes = findKeyClashes(s.keys, SHOWN, otherKeybinds());
    for (const row of rows) {
      if (!s.enabled) endRecording(row);
      if (!row.recording) row.btn.textContent = formatKeybind(s.keys[row.action]);
      row.btn.disabled = !s.enabled;
      row.btn.style.opacity = s.enabled ? '' : '0.5';
      row.btn.style.cursor = s.enabled ? 'pointer' : 'not-allowed';
      paintRow(row);
    }
  };
  const offPanel = onPanelToggleKeybindChange(() => { render(getSpectatorSettings()); });

  return {
    root,
    render,
    destroy() {
      offPanel();
      for (const row of rows) endRecording(row);
    },
  };
}
