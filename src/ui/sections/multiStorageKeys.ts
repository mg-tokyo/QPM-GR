import { assignKeybind, clearKeybindAction, listKeybindActions, onKeybindsChange, type AssignResult } from '../../features/input/keybinds';
import { t } from '../../i18n';
import { createSectionHeader } from '../components';
import { createKeybindButton, formatKeybind } from '../pets/petsWindow/helpers';
import { muted } from './sectionLayout';

/** A registry action id and the i18n key of its row label. */
export interface KeyRowSpec { actionId: string; label: string }

const BTN = 'min-width:88px;text-align:center;background:var(--qpm-surface-2);border:1px solid var(--qpm-accent-border);' +
  'border-radius:4px;color:var(--qpm-text);font-family:inherit;font-size:12px;padding:4px 8px;outline:none;cursor:pointer;white-space:nowrap;';
const NOTE = 'grid-column:1 / -1;font-size:12px;line-height:1.4;margin-top:-4px;color:var(--qpm-warning);';

export function readActionCombo(actionId: string): string {
  return listKeybindActions().find(a => a.id === actionId)?.combo ?? '';
}

function refusalText(result: AssignResult): string | null {
  if (result.ok) {
    if (result.movedFrom.length > 0) return t('feature.multiStorage.card.keyMoved');
    return result.gameKeysUnread ? t('feature.multiStorage.card.keyGameUnread') : null;
  }
  if (result.reason === 'gameKey') return t('feature.multiStorage.card.keyGame');
  if (result.reason === 'panelKey') return t('feature.multiStorage.card.keyPanel');
  return null;
}

// `kept`: a note that outlives recording (a moved key) while the row keeps that key; a refusal clears when recording ends.
interface KeyRow { btn: HTMLButtonElement; note: HTMLElement; recording: boolean; kept: string | null; keptFor: string }

export interface PanelKeys { root: HTMLElement; setEnabled(on: boolean): void; destroy(): void }

/**
 * One recorder per action; binds go through the shared registry, so clashes move and game keys are refused there.
 * `attr` is the data attribute stem of the card (`mstore` gives `data-mstore-key`).
 */
export function createPanelKeys(specs: readonly KeyRowSpec[], attr: string): PanelKeys {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:6px 12px;align-items:center;';
  const rows: KeyRow[] = [];
  let enabled = true;

  const setNote = (row: KeyRow, text: string | null): void => {
    row.note.textContent = text ?? '';
    row.note.style.display = text ? '' : 'none';
    row.btn.style.borderColor = row.recording ? 'var(--qpm-accent)' : text ? 'var(--qpm-warning)' : 'var(--qpm-accent-border)';
  };

  for (const { actionId, label } of specs) {
    const name = document.createElement('div');
    name.style.cssText = 'font-size:12px;color:var(--qpm-text);';
    name.textContent = t(label);
    const note = document.createElement('div');
    note.style.cssText = NOTE;
    const row: KeyRow = { btn: document.createElement('button'), note, recording: false, kept: null, keptFor: '' };
    row.btn = createKeybindButton({
      readCurrent: () => readActionCombo(actionId),
      onSet: () => { /* assigned in accept, which needs the registry's answer */ },
      onClear: () => { clearKeybindAction(actionId); row.kept = null; },
      accept: (combo) => {
        const result = assignKeybind(actionId, combo);
        row.kept = result.ok ? refusalText(result) : null;
        row.keptFor = result.ok ? result.combo : '';
        setNote(row, refusalText(result));
        return result.ok;
      },
      onRecording: (on) => {
        row.recording = on;
        if (on) row.kept = null;
        setNote(row, on ? null : row.kept);
      },
    });
    row.btn.style.cssText = BTN;
    row.btn.dataset[`${attr}Key`] = actionId;
    grid.append(name, row.btn, note);
    setNote(row, null);
    rows.push(row);
  }

  root.append(createSectionHeader(t('feature.multiStorage.card.keysTitle'), { size: 'compact' }).root, grid, muted(t('feature.multiStorage.card.keysHelp')));

  const endRecording = (row: KeyRow): void => {
    if (row.recording) row.btn.dispatchEvent(new FocusEvent('blur'));
  };
  const paint = (): void => {
    specs.forEach(({ actionId }, i) => {
      const row = rows[i];
      if (!row) return;
      if (!enabled) endRecording(row);
      if (!row.recording) {
        const combo = readActionCombo(actionId);
        row.btn.textContent = combo ? formatKeybind(combo) : '—';
        if (row.kept && combo !== row.keptFor) {
          row.kept = null;
          setNote(row, null);
        }
      }
      row.btn.disabled = !enabled;
      row.btn.style.opacity = enabled ? '' : '0.5';
      row.btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    });
  };
  paint();
  const off = onKeybindsChange(paint);

  return {
    root,
    setEnabled(on) { enabled = on; paint(); },
    destroy() {
      off();
      for (const row of rows) endRecording(row);
    },
  };
}
