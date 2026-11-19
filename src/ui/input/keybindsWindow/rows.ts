import type { AssignResult, KeybindActionInfo } from '../../../features/input/keybinds';
import { t } from '../../../i18n';
import { createButton } from '../../components';
import { createKeybindButton, formatKeybind } from '../../pets/petsWindow/helpers';
import type { RowLook } from './labels';

export const NOTE_MS = 4000;

const STYLE_ID = 'qpm-keybinds-row-style';
const CSS = [
  '.qpm-keybinds-row{display:grid;grid-template-columns:28px minmax(0,1fr) max-content 24px;gap:4px 8px;align-items:center;padding:4px 0;}',
  '.qpm-keybinds-row--removable{grid-template-columns:28px minmax(0,1fr) max-content 24px max-content;}',
  '.qpm-keybinds-row--off{opacity:0.5;}',
  '.qpm-keybinds-row--dim .qpm-keybinds-row__icon,.qpm-keybinds-row--dim .qpm-keybinds-row__text{opacity:0.5;}',
  '.qpm-keybinds-row__text{display:flex;flex-direction:column;min-width:0;}',
  '.qpm-keybinds-row__name{font-size:var(--qpm-font-body);color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.qpm-keybinds-row__hint{font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);}',
  '.qpm-keybinds-row__note{grid-column:2 / -1;font-size:var(--qpm-font-caption);line-height:1.4;color:var(--qpm-warning);}',
  '.qpm-keybinds-row .qpm-keybind-input{min-width:88px;text-align:center;background:var(--qpm-surface-2);border:1px solid var(--qpm-accent-border);' +
    'border-radius:4px;color:var(--qpm-text);font-family:inherit;font-size:12px;padding:4px 8px;cursor:pointer;white-space:nowrap;}',
  '.qpm-keybinds-row .qpm-keybind-input--recording{border-color:var(--qpm-accent);}',
].join('');

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface RowDeps {
  assign(actionId: string, combo: string): AssignResult;
  clear(actionId: string): void;
  /** The row name of another action, for "moved here from …". */
  nameOf(actionId: string): string;
  /** My items rows only: drops the row and its key (INP-4.5). */
  remove?(actionId: string): void;
}

export interface KeyRow {
  root: HTMLElement;
  iconSlot: HTMLElement;
  actionId: string;
  name: string;
  paint(info: KeybindActionInfo): void;
  /** The game's own keys for the same thing (INP-1.6b); [] hides the line. */
  setGameKeys(combos: readonly string[]): void;
  setEnabled(on: boolean): void;
  /** Note under the name; `faded` dims icon + name, key still bindable (INP-4 D2, INP-5 D7). */
  setBagNote(note: string | null, faded: boolean): void;
  destroy(): void;
}

/** What a recorded combo produced, as the note under the row; null = nothing to say. */
export function resultNote(result: AssignResult, combo: string, nameOf: (id: string) => string): string | null {
  const key = formatKeybind(combo);
  if (result.ok) {
    if (result.movedFrom.length > 0) return t('feature.keybinds.note.moved', { key, from: result.movedFrom.map(nameOf).join(', ') });
    return result.gameKeysUnread ? t('feature.keybinds.note.gameKeysUnread') : null;
  }
  if (result.reason === 'gameKey') return t('feature.keybinds.note.gameKey', { key });
  if (result.reason === 'panelKey') return t('feature.keybinds.note.panelKey', { key });
  return null;
}

export function createKeyRow(info: KeybindActionInfo, look: RowLook, deps: RowDeps): KeyRow {
  ensureStyles();
  const root = document.createElement('div');
  root.className = 'qpm-keybinds-row';
  root.dataset.qpmKeybindRow = info.id;
  const iconSlot = document.createElement('div');
  iconSlot.className = 'qpm-keybinds-row__icon';
  const text = document.createElement('div');
  text.className = 'qpm-keybinds-row__text';
  const name = document.createElement('span');
  name.className = 'qpm-keybinds-row__name';
  name.textContent = look.name;
  name.title = look.name;
  text.append(name);
  if (look.hint) {
    const hint = document.createElement('span');
    hint.className = 'qpm-keybinds-row__hint';
    hint.textContent = look.hint;
    text.append(hint);
  }
  const gameKey = document.createElement('span');
  gameKey.className = 'qpm-keybinds-row__hint';
  gameKey.dataset.qpmGameKey = '';
  gameKey.style.display = 'none';
  text.append(gameKey);
  const dimNote = document.createElement('span');
  dimNote.className = 'qpm-keybinds-row__hint';
  dimNote.dataset.qpmDimNote = '';
  dimNote.style.display = 'none';
  text.append(dimNote);
  const note = document.createElement('div');
  note.className = 'qpm-keybinds-row__note';
  note.setAttribute('role', 'status');
  note.style.display = 'none';

  let current = info;
  let recording = false;
  let noteTimer: ReturnType<typeof setTimeout> | null = null;
  const showNote = (msg: string | null): void => {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
    note.textContent = msg ?? '';
    note.style.display = msg ? '' : 'none';
    if (msg) noteTimer = setTimeout(() => { noteTimer = null; showNote(null); }, NOTE_MS);
  };

  const btn = createKeybindButton({
    readCurrent: () => current.combo,
    onSet: () => { /* assign runs in accept, which needs the registry's answer */ },
    onClear: () => deps.clear(info.id),
    accept: (combo) => {
      const result = deps.assign(info.id, combo);
      showNote(resultNote(result, combo, deps.nameOf));
      return result.ok;
    },
    onRecording: (on) => {
      recording = on;
      btn.classList.toggle('qpm-keybind-input--recording', on);
    },
  });
  btn.setAttribute('aria-label', t('feature.keybinds.keyAria', { name: look.name }));

  const clearBtn = createButton('×', { variant: 'ghost', size: 'sm', onClick: () => { showNote(null); deps.clear(info.id); } });
  const clearLabel = info.canUnbind ? t('feature.keybinds.clear') : t('hub.config.resetToDefault');
  clearBtn.title = clearLabel;
  clearBtn.setAttribute('aria-label', clearLabel);

  root.append(iconSlot, text, btn, clearBtn);
  const remove = deps.remove;
  if (remove) {
    root.classList.add('qpm-keybinds-row--removable');
    const removeBtn = createButton(t('feature.keybinds.removeItem'), { variant: 'ghost', size: 'sm', onClick: () => remove(info.id) });
    removeBtn.setAttribute('aria-label', t('feature.keybinds.removeItemAria', { name: look.name }));
    removeBtn.dataset.qpmKeybindRemove = '';
    root.append(removeBtn);
  }
  root.append(note);

  const paint = (next: KeybindActionInfo): void => {
    current = next;
    if (!recording) btn.textContent = next.combo ? formatKeybind(next.combo) : '—';
    clearBtn.style.visibility = next.combo ? '' : 'hidden';
  };
  paint(info);

  return {
    root,
    iconSlot,
    actionId: info.id,
    name: look.name,
    paint,
    setGameKeys(combos) {
      const text = combos.length ? t('feature.keybinds.gameKey', { key: combos.map(formatKeybind).join(', ') }) : '';
      if (gameKey.textContent === text) return;
      gameKey.textContent = text;
      gameKey.style.display = text ? '' : 'none';
    },
    setEnabled(on) {
      if (!on && recording) btn.dispatchEvent(new FocusEvent('blur'));
      root.classList.toggle('qpm-keybinds-row--off', !on);
      btn.disabled = !on;
      clearBtn.disabled = !on;
    },
    setBagNote(next, faded) {
      const text = next ?? '';
      root.classList.toggle('qpm-keybinds-row--dim', faded);
      if (dimNote.textContent === text) return;
      dimNote.textContent = text;
      dimNote.style.display = text ? '' : 'none';
    },
    destroy() {
      if (recording) btn.dispatchEvent(new FocusEvent('blur'));
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = null;
    },
  };
}
